(function installFlexibleAttendanceImport(){
  'use strict';

  // The original Shift support in event-log-duplicates.js installs on
  // DOMContentLoaded. This final integration layer supersedes it so all
  // later-loaded Event Log extensions are wrapped consistently.
  window.__maklomAttendanceShiftSupportInstalled=true;

  const REQUIRED_HEADERS=['Name','Email','Contact','Attendance','Event Name','Event Date','Hours','Minutes'];
  const OPTIONAL_HEADERS=['Shift','Grab Voucher Code 1','Grab Voucher Code 2','Grab Voucher Code 3'];
  const TEMPLATE_HEADERS=['Name','Email','Contact','Attendance','Event Name','Event Date','Shift','Hours','Minutes','Grab Voucher Code 1','Grab Voucher Code 2','Grab Voucher Code 3'];
  const ROUNDTRIP_MARKERS=['Event Log ID','Decimal Hours','Duration Minutes'];

  function text(value){return String(value==null?'':value).trim();}
  function headerName(value){return text(value);}
  function trailingHeaderLength(headers){
    let end=(headers||[]).length;
    while(end>0&&!headerName(headers[end-1]))end--;
    return end;
  }
  function headerMap(headers){
    const end=trailingHeaderLength(headers);
    const map={};
    for(let i=0;i<end;i++){
      const label=headerName(headers[i]);
      if(label)map[label]=i;
    }
    return{map:map,end:end,headers:(headers||[]).slice(0,end).map(headerName)};
  }
  function isRoundtrip(headers){
    const names=headerMap(headers).headers;
    return ROUNDTRIP_MARKERS.some(function(label){return names.indexOf(label)>-1;});
  }
  function standardLayout(headers){
    if(!Array.isArray(headers)||!headers.length||isRoundtrip(headers))return null;
    const parsed=headerMap(headers);
    const allowed=REQUIRED_HEADERS.concat(OPTIONAL_HEADERS);
    const unknown=parsed.headers.filter(function(label){return allowed.indexOf(label)===-1;});
    if(unknown.length)return null;
    const missing=REQUIRED_HEADERS.filter(function(label){return parsed.map[label]==null;});
    if(missing.length)return null;
    return parsed;
  }
  function valueAt(row,layout,label){
    const index=layout.map[label];
    return index==null?'':row[index];
  }
  function duplicateKey(row){return row&&row.id?row.id:'row-'+String(row&&row.rowNumber||'');}
  function addIssue(row,message){
    const issues=row.issue?row.issue.split('; '):[];
    if(issues.indexOf(message)===-1)issues.push(message);
    row.issue=issues.join('; ');
    row.valid=false;
  }

  // Retain Shift through all local validation/normalisation paths. The current
  // validator already retains voucher codes and structured event/shift IDs.
  if(typeof validateEventLogRow==='function'){
    const previousValidateEventLogRow=validateEventLogRow;
    validateEventLogRow=function(raw){
      const row=previousValidateEventLogRow(raw);
      row.shiftLabel=safeText(raw&&(raw.shiftLabel||raw.shift),'shiftLabel');
      return row;
    };
  }

  // Retain Shift in the Supabase shared-store mapping.
  const S=window.MaklomSharedDB;
  if(S&&typeof S.dbEventToLocal==='function'&&typeof S.eventToDb==='function'){
    const previousDbEventToLocal=S.dbEventToLocal;
    const previousEventToDb=S.eventToDb;
    S.dbEventToLocal=function(row){
      const local=previousDbEventToLocal(row);
      local.shiftLabel=row&&row.shift_label||'';
      return local;
    };
    S.eventToDb=function(row){
      const db=previousEventToDb(row);
      db.shift_label=S.nonBlank(row&&row.shiftLabel);
      return db;
    };
  }

  function mapStandardRow(row,rowNumber,layout){
    const rawAttendance=text(valueAt(row,layout,'Attendance'));
    const attendance=rawAttendance===''?'':(rawAttendance.toLowerCase()==='yes'?'yes':rawAttendance);
    const hours=text(valueAt(row,layout,'Hours'));
    const minutes=text(valueAt(row,layout,'Minutes'));
    return{
      id:makeId('evt'),
      rowNumber:rowNumber,
      name:safeText(valueAt(row,layout,'Name'),'name'),
      email:safeText(valueAt(row,layout,'Email'),'email'),
      contact:normaliseContact(valueAt(row,layout,'Contact')),
      attendance:attendance,
      eventName:safeText(valueAt(row,layout,'Event Name'),'eventName'),
      eventDate:safeDate(valueAt(row,layout,'Event Date'),'eventDate'),
      shiftLabel:safeText(valueAt(row,layout,'Shift'),'shiftLabel'),
      hours:hours,
      minutes:minutes,
      durationMinutes:durationMinutesFromParts(hours,minutes,attendance),
      grabVoucherCode1:safeText(valueAt(row,layout,'Grab Voucher Code 1'),'grabVoucherCode1'),
      grabVoucherCode2:safeText(valueAt(row,layout,'Grab Voucher Code 2'),'grabVoucherCode2'),
      grabVoucherCode3:safeText(valueAt(row,layout,'Grab Voucher Code 3'),'grabVoucherCode3')
    };
  }

  function markDuplicateImports(rows){
    const detector=window.detectEventLogDuplicatePairs;
    if(typeof detector!=='function')return;
    const importedByKey={};
    rows.filter(function(row){return row.valid;}).forEach(function(row){importedByKey[duplicateKey(row)]=row;});
    detector((appData.attendanceLog||[]).concat(rows.filter(function(row){return row.valid;}))).forEach(function(pair){
      [pair.a,pair.b].forEach(function(row){
        const imported=importedByKey[duplicateKey(row)];
        if(imported)addIssue(imported,'Suspected duplicate event log entry ('+(pair.reason||'same volunteer, event, date and shift')+')');
      });
    });
  }

  const previousValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    if(uploadedType!=='attendance')return previousValidateAndPreviewRows(rows);
    const layout=rows.length?standardLayout(rows[0]):null;
    if(!layout)return previousValidateAndPreviewRows(rows);
    if(rows.length-1>MAX_IMPORT_ROWS){
      document.getElementById('previewCard').classList.add('hidden');
      showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');
      return;
    }
    uploadedRows=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      const mapped=mapStandardRow(rows[i],i+1,layout);
      mapped.issue=validateMappedRow(mapped,'attendance');
      mapped.valid=mapped.issue==='';
      const extra=(rows[i]||[]).slice(layout.end).filter(function(cell){return text(cell)!=='';});
      if(extra.length)addIssue(mapped,'Unexpected data found after the last recognised column');
      uploadedRows.push(mapped);
    }
    markDuplicateImports(uploadedRows);
    renderPreview();
  };

  // Standard attendance previews always show the new Shift field and optional
  // voucher fields, even when the uploaded legacy file left them blank.
  const previousRenderPreview=renderPreview;
  renderPreview=function(){
    if(uploadedType!=='attendance'||!uploadedRows.length||uploadedRows.some(function(row){return row._eventLogReimport;}))return previousRenderPreview();
    const invalid=uploadedRows.filter(function(row){return !row.valid;}).length;
    const previewRows=uploadedRows.map(function(row){
      return[row.rowNumber,row.valid?'Ready':row.issue,row.name,row.email,row.contact,row.attendance,row.eventName,row.eventDate,row.shiftLabel||'',row.hours,row.minutes,formatDuration(row),row.grabVoucherCode1||'',row.grabVoucherCode2||'',row.grabVoucherCode3||''];
    });
    document.getElementById('previewCard').classList.remove('hidden');
    document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';
    document.getElementById('previewTable').innerHTML=makeTable(['Row','Status'].concat(TEMPLATE_HEADERS).concat(['Duration']),previewRows.map(function(row){
      return row.slice(0,11).concat(row.slice(12),[row[11]]);
    }));
    showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged; valid rows remain available for import.':'Preview created. Attendance event log rows are ready.');
  };

  // Make Shift available to the existing pre-import batch editor. Its generic
  // text-field path already supports shiftLabel once the option is exposed.
  if(typeof getBatchEditableOptions==='function'){
    const previousGetBatchEditableOptions=getBatchEditableOptions;
    getBatchEditableOptions=function(){
      if(pendingImport&&pendingImport.type==='attendanceLog'){
        return[['attendance','Attendance'],['eventName','Event Name'],['eventDate','Event Date'],['shiftLabel','Shift'],['hours','Hours'],['minutes','Minutes']].map(function(field){return'<option value="'+field[0]+'">'+field[1]+'</option>';}).join('');
      }
      return previousGetBatchEditableOptions();
    };
  }

  if(typeof renderCleanBucket==='function'){
    const previousRenderCleanBucket=renderCleanBucket;
    renderCleanBucket=function(){
      if(!pendingImport||pendingImport.type!=='attendanceLog')return previousRenderCleanBucket();
      const rows=pendingImport.clean.map(function(item){const r=item.incoming;return[r.name,r.email,r.contact,r.attendance,r.eventName,r.eventDate,r.shiftLabel||'',r.hours,r.minutes,formatDuration(r),r.grabVoucherCode1||'',r.grabVoucherCode2||'',r.grabVoucherCode3||'',item.reason];});
      document.getElementById('cleanBucket').innerHTML='<h3>Attendance Event Log Rows</h3>'+(rows.length?makeTable(['Name','Email','Contact','Attendance','Event Name','Event Date','Shift','Hours','Minutes','Duration','Grab Voucher Code 1','Grab Voucher Code 2','Grab Voucher Code 3','Status'],rows):'<p class="muted">None.</p>');
    };
  }

  // Include Shift in portable/full-database Event Log exports while preserving
  // all existing round-trip and voucher columns.
  eventLogExportRows=function(){
    return(appData.attendanceLog||[]).map(function(row){return safeExportRow({
      'Event Log ID':row.id,
      Name:row.name,
      Email:row.email,
      Contact:row.contact,
      Attendance:row.attendance,
      'Event Name':row.eventName,
      'Event Date':row.eventDate,
      Shift:row.shiftLabel||'',
      Hours:durationHoursPart(row),
      Minutes:durationMinutesPart(row),
      'Decimal Hours':durationDecimalHours(row),
      'Duration Minutes':row.durationMinutes,
      'Grab Voucher Code 1':row.grabVoucherCode1||'',
      'Grab Voucher Code 2':row.grabVoucherCode2||'',
      'Grab Voucher Code 3':row.grabVoucherCode3||''
    });});
  };

  // This assignment happens before startApp wires the click listener, so the
  // visible template button now downloads the Shift-aware template.
  downloadSampleAttendance=function(){
    const sheet=XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15','Shift 1',4,30,'GRAB-001','',''],
      ['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15','Shift 2',3,0,'','',''],
      ['Ali Ahmad','ali@example.com','8123 4567','','Community Event','2026-01-15','Shift 1',0,0,'','','']
    ]);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,sheet,'Attendance Event Log');
    XLSX.writeFile(wb,'attendance_event_log.xlsx');
  };

  function injectShiftEditors(){
    const rowsById={};
    (appData.attendanceLog||[]).forEach(function(row){rowsById[row.id]=row;});

    const table=document.querySelector('#eventLogTable .event-log-desktop table');
    if(table){
      const header=table.querySelector('thead tr');
      if(header&&!header.querySelector('[data-shift-label-column]')){
        const cells=Array.from(header.children);
        const dateIndex=cells.findIndex(function(cell){return text(cell.textContent)==='Event Date';});
        if(dateIndex>-1){
          const th=document.createElement('th');th.dataset.shiftLabelColumn='true';th.textContent='Shift';
          header.insertBefore(th,cells[dateIndex].nextSibling);
        }
      }
      table.querySelectorAll('tbody tr[data-event-log-row]').forEach(function(tr){
        if(tr.querySelector('[data-shift-label-cell]'))return;
        const row=rowsById[tr.getAttribute('data-event-log-row')];if(!row)return;
        const headerCells=Array.from(table.querySelectorAll('thead th'));
        const dateIndex=headerCells.findIndex(function(cell){return text(cell.textContent)==='Event Date';});
        if(dateIndex<0)return;
        const dateCell=tr.children[dateIndex];if(!dateCell)return;
        const td=document.createElement('td');td.dataset.shiftLabelCell='true';
        const input=document.createElement('input');input.maxLength=120;input.value=row.shiftLabel||'';input.placeholder='e.g. Shift 1';
        input.addEventListener('input',function(){editEventLogField(row.id,'shiftLabel',input.value,input);});
        input.addEventListener('blur',function(){commitEventLogEdit();});
        td.appendChild(input);dateCell.insertAdjacentElement('afterend',td);
      });
    }

    document.querySelectorAll('#eventLogTable [data-event-log-card]').forEach(function(card){
      if(card.querySelector('[data-shift-label-mobile]'))return;
      const row=rowsById[card.getAttribute('data-event-log-card')];if(!row)return;
      const fields=card.querySelector('.event-log-card-fields');if(!fields)return;
      const label=document.createElement('label');label.dataset.shiftLabelMobile='true';label.textContent='Shift';
      const input=document.createElement('input');input.maxLength=120;input.value=row.shiftLabel||'';input.placeholder='e.g. Shift 1';
      input.addEventListener('input',function(){editEventLogField(row.id,'shiftLabel',input.value,input);});
      input.addEventListener('blur',function(){commitEventLogEdit();});
      label.appendChild(input);
      const dateLabel=Array.from(fields.querySelectorAll('label')).find(function(item){return text(item.childNodes[0]&&item.childNodes[0].textContent)==='Date';});
      if(dateLabel)dateLabel.insertAdjacentElement('afterend',label);else fields.appendChild(label);
    });
  }

  if(typeof renderEventLogEditor==='function'){
    const previousRenderEventLogEditor=renderEventLogEditor;
    renderEventLogEditor=function(){previousRenderEventLogEditor();injectShiftEditors();};
  }
})();
