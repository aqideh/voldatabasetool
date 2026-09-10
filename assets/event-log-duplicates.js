(function installEventLogDuplicateDetection(){
  const NAME_DISTANCE_RATIO=0.24;
  const EVENT_DISTANCE_RATIO=0.18;
  const LEGACY_EVENT_LOG_HEADERS=['Name','Email','Contact','Attendance','Event Name','Event Date','Hours','Minutes'];
  const SHIFT_EVENT_LOG_HEADERS=['Name','Email','Contact','Attendance','Event Name','Event Date','Shift','Hours','Minutes'];

  function duplicateText(value){
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }

  function editDistance(a,b){
    if(a===b)return 0;
    if(!a)return b.length;
    if(!b)return a.length;
    if(a.length>b.length){const temp=a;a=b;b=temp;}
    let previous=[];
    for(let j=0;j<=a.length;j++)previous[j]=j;
    for(let i=1;i<=b.length;i++){
      const current=[i];
      for(let j=1;j<=a.length;j++){
        const cost=b.charAt(i-1)===a.charAt(j-1)?0:1;
        current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+cost);
      }
      previous=current;
    }
    return previous[a.length];
  }

  function textIsSimilar(left,right,maxRatio,normaliser){
    const a=normaliser(left),b=normaliser(right);
    if(!a||!b)return false;
    if(a===b)return true;
    const longest=Math.max(a.length,b.length);
    if(longest<5)return false;
    return editDistance(a,b)/longest<=maxRatio;
  }

  function duplicateName(value){return typeof normalizeName==='function'?normalizeName(value):duplicateText(value);}
  function duplicateEmail(value){return typeof normalizeEmail==='function'?normalizeEmail(value):duplicateText(value);}
  function namesAreSimilar(a,b){return textIsSimilar(a,b,NAME_DISTANCE_RATIO,duplicateName);}
  function eventNamesAreSimilar(a,b){return textIsSimilar(a,b,EVENT_DISTANCE_RATIO,duplicateText);}

  function explicitShiftFromName(value){
    const name=duplicateText(value);
    if(!name)return'';
    if(/\b(?:a\s*m|am|morning)\b/.test(name))return'AM';
    if(/\b(?:p\s*m|pm|afternoon)\b/.test(name))return'PM';
    if(/\bevening\b/.test(name))return'EVENING';
    if(/\bnight\b/.test(name))return'NIGHT';
    if(/\b(?:full\s*day|all\s*day)\b/.test(name))return'FULL_DAY';
    const numbered=name.match(/\bshift\s*(\d+)\b/);
    return numbered?'SHIFT_'+numbered[1]:'';
  }

  function shiftLabel(row){return duplicateText(row&&(row.shiftLabel||row.shift));}

  function rowsHaveDifferentExplicitShifts(a,b){
    const eventIdA=cleanText(a&&a.eventId),eventIdB=cleanText(b&&b.eventId);
    const shiftIdA=cleanText(a&&a.shiftId),shiftIdB=cleanText(b&&b.shiftId);
    if(eventIdA&&eventIdB&&eventIdA===eventIdB&&shiftIdA&&shiftIdB)return shiftIdA!==shiftIdB;

    const labelA=shiftLabel(a),labelB=shiftLabel(b);
    if(labelA&&labelB)return labelA!==labelB;
    if(labelA||labelB)return false;

    const shiftA=explicitShiftFromName(a&&a.eventName),shiftB=explicitShiftFromName(b&&b.eventName);
    return !!(shiftA&&shiftB&&shiftA!==shiftB);
  }

  function rowsAreSuspectedDuplicates(a,b){
    if(!a||!b)return false;
    if(a.id&&b.id&&a.id===b.id)return false;
    const dateA=cleanText(a.eventDate),dateB=cleanText(b.eventDate);
    if(!dateA||dateA!==dateB)return false;
    if(rowsHaveDifferentExplicitShifts(a,b))return false;
    if(!eventNamesAreSimilar(a.eventName,b.eventName))return false;
    const emailA=duplicateEmail(a.email),emailB=duplicateEmail(b.email);
    if(emailA&&emailB)return emailA===emailB;
    return namesAreSimilar(a.name,b.name);
  }

  function duplicateReason(a,b){
    const emailA=duplicateEmail(a&&a.email),emailB=duplicateEmail(b&&b.email);
    const hasShift=!!(shiftLabel(a)||shiftLabel(b)||explicitShiftFromName(a&&a.eventName)||explicitShiftFromName(b&&b.eventName));
    const shiftText=hasShift?' and same/ambiguous shift':'';
    return emailA&&emailB&&emailA===emailB?'same email, same event date, similar event name'+shiftText:'similar name, same event date, similar event name'+shiftText;
  }

  function detectDuplicatePairs(rows){
    const byDate={};
    (rows||[]).forEach(function(row){
      const date=cleanText(row&&row.eventDate);
      if(!date||!cleanText(row&&row.eventName))return;
      if(!byDate[date])byDate[date]=[];
      byDate[date].push(row);
    });
    const pairs=[];
    Object.keys(byDate).forEach(function(date){
      const group=byDate[date];
      for(let i=0;i<group.length;i++){
        for(let j=i+1;j<group.length;j++){
          if(rowsAreSuspectedDuplicates(group[i],group[j]))pairs.push({a:group[i],b:group[j],reason:duplicateReason(group[i],group[j])});
        }
      }
    });
    return pairs;
  }

  function duplicateKey(row){return row&&row.id?row.id:'row-'+String(row&&row.rowNumber||'');}

  function duplicateMap(rows){
    const map={};
    detectDuplicatePairs(rows).forEach(function(pair){
      [pair.a,pair.b].forEach(function(row){
        const key=duplicateKey(row);
        if(!map[key])map[key]=[];
        map[key].push(pair.reason);
      });
    });
    return map;
  }

  function appendIssue(row,message){
    const issues=row.issue?row.issue.split('; '):[];
    if(issues.indexOf(message)===-1)issues.push(message);
    row.issue=issues.join('; ');
    row.valid=false;
  }

  function markUploadedDuplicateRows(){
    const imported=(uploadedRows||[]).filter(function(row){return row&&row.valid;});
    if(!imported.length)return 0;
    const existing=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
    const importedKeys={};
    imported.forEach(function(row){importedKeys[duplicateKey(row)]=true;});
    const flagged={};
    detectDuplicatePairs(existing.concat(imported)).forEach(function(pair){
      const aKey=duplicateKey(pair.a),bKey=duplicateKey(pair.b);
      if(importedKeys[aKey])flagged[aKey]=pair.reason;
      if(importedKeys[bKey])flagged[bKey]=pair.reason;
    });
    imported.forEach(function(row){
      const reason=flagged[duplicateKey(row)];
      if(reason)appendIssue(row,'Suspected duplicate event log entry ('+reason+')');
    });
    return Object.keys(flagged).length;
  }

  const previousValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    previousValidateAndPreviewRows(rows);
    if(uploadedType!=='attendance')return;
    const preview=document.getElementById('previewCard');
    if(!preview||preview.classList.contains('hidden'))return;
    if(markUploadedDuplicateRows())renderPreview();
  };

  function pendingDuplicateRows(){
    if(!pendingImport||pendingImport.type!=='attendanceLog')return[];
    const pending=pendingImport.clean.map(function(item){return item.incoming;});
    const pendingKeys={};
    pending.forEach(function(row){pendingKeys[duplicateKey(row)]=true;});
    const flagged={};
    detectDuplicatePairs((appData.attendanceLog||[]).concat(pending)).forEach(function(pair){
      const aKey=duplicateKey(pair.a),bKey=duplicateKey(pair.b);
      if(pendingKeys[aKey])flagged[aKey]=pair.reason;
      if(pendingKeys[bKey])flagged[bKey]=pair.reason;
    });
    return pending.filter(function(row){return flagged[duplicateKey(row)];});
  }

  const previousConfirmImport=confirmImport;
  confirmImport=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLog')return previousConfirmImport();
    const duplicates=pendingDuplicateRows();
    if(duplicates.length){
      showNotice('mergeSummary','bad','Import blocked. '+duplicates.length+' suspected duplicate event log row'+(duplicates.length===1?' was':'s were')+' detected. Remove or correct the duplicate rows before importing.');
      return;
    }
    return previousConfirmImport();
  };

  function annotateEventLogDuplicates(){
    const target=document.getElementById('eventLogTable');
    const summary=document.getElementById('eventLogSummary');
    if(!target)return;
    const map=duplicateMap(appData.attendanceLog||[]);
    const duplicateKeys=Object.keys(map);
    if(summary&&duplicateKeys.length){
      summary.insertAdjacentHTML('beforeend',' <span class="pill warn">'+duplicateKeys.length+' suspected duplicate row'+(duplicateKeys.length===1?'':'s')+'</span>');
    }
    const table=target.querySelector('table');
    if(!table)return;
    const header=table.querySelector('thead tr');
    if(header&&!header.querySelector('[data-duplicate-column]')){
      const th=document.createElement('th');
      th.dataset.duplicateColumn='true';
      th.textContent='Duplicate check';
      header.insertBefore(th,header.lastElementChild);
    }
    table.querySelectorAll('tbody tr[data-event-log-row]').forEach(function(tr){
      const id=tr.getAttribute('data-event-log-row');
      if(tr.querySelector('[data-duplicate-status]'))return;
      const td=document.createElement('td');
      td.dataset.duplicateStatus='true';
      if(map[id]){
        const uniqueReasons=map[id].filter(function(reason,index,all){return all.indexOf(reason)===index;});
        td.innerHTML='<span class="pill warn" title="'+escapeHtml(uniqueReasons.join('; '))+'">Suspected duplicate</span>';
      }else{
        td.innerHTML='<span class="muted">—</span>';
      }
      tr.insertBefore(td,tr.lastElementChild);
    });
  }

  const previousRenderEventLogEditor=renderEventLogEditor;
  renderEventLogEditor=function(){
    previousRenderEventLogEditor();
    annotateEventLogDuplicates();
  };

  function headersEqual(actual,expected){
    if(!actual||actual.length!==expected.length)return false;
    for(let i=0;i<expected.length;i++)if(cleanText(actual[i])!==expected[i])return false;
    return true;
  }

  function installShiftFieldSupport(){
    if(window.__maklomAttendanceShiftSupportInstalled)return;
    window.__maklomAttendanceShiftSupportInstalled=true;

    const originalValidateEventLogRow=validateEventLogRow;
    validateEventLogRow=function(raw){
      const row=originalValidateEventLogRow(raw);
      row.shiftLabel=safeText(raw&&(raw.shiftLabel||raw.shift),'shiftLabel');
      return row;
    };

    mapAttendanceRow=function(row,rowNumber){
      const withShift=row.length>=9;
      const rawAttendance=cleanText(row[3]);
      const attendance=rawAttendance===''?'':(rawAttendance.toLowerCase()==='yes'?'yes':rawAttendance);
      const shiftIndex=withShift?6:-1;
      const hoursIndex=withShift?7:6;
      const minutesIndex=withShift?8:7;
      return{
        id:makeId('evt'),rowNumber:rowNumber,name:safeText(row[0],'name'),email:safeText(row[1],'email'),contact:normaliseContact(row[2]),attendance:attendance,
        eventName:safeText(row[4],'eventName'),eventDate:safeDate(row[5],'eventDate'),shiftLabel:shiftIndex>-1?safeText(row[shiftIndex],'shiftLabel'):'',
        hours:cleanText(row[hoursIndex]),minutes:cleanText(row[minutesIndex]),durationMinutes:durationMinutesFromParts(row[hoursIndex],row[minutesIndex],attendance)
      };
    };

    const wrappedValidateAndPreviewRows=validateAndPreviewRows;
    validateAndPreviewRows=function(rows){
      if(uploadedType!=='attendance')return wrappedValidateAndPreviewRows(rows);
      const hasLegacy=rows.length&&headersEqual(rows[0],LEGACY_EVENT_LOG_HEADERS);
      const hasShift=rows.length&&headersEqual(rows[0],SHIFT_EVENT_LOG_HEADERS);
      if(!hasLegacy&&!hasShift){
        document.getElementById('previewCard').classList.add('hidden');
        showNotice('uploadStatus','bad','Template rejected. Expected the standard attendance columns, with an optional Shift column after Event Date.');
        return;
      }
      if(rows.length-1>MAX_IMPORT_ROWS){
        document.getElementById('previewCard').classList.add('hidden');
        showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');
        return;
      }
      uploadedRows=[];
      for(let i=1;i<rows.length;i++){
        if(isBlankRow(rows[i]))continue;
        const mapped=mapAttendanceRow(rows[i],i+1);
        mapped.issue=validateMappedRow(mapped,'attendance');
        mapped.valid=mapped.issue==='';
        uploadedRows.push(mapped);
      }
      markUploadedDuplicateRows();
      renderPreview();
    };

    const wrappedRenderPreview=renderPreview;
    renderPreview=function(){
      if(uploadedType!=='attendance')return wrappedRenderPreview();
      const invalid=uploadedRows.filter(function(r){return !r.valid;}).length;
      const rows=uploadedRows.map(function(r){return[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.email,r.contact,r.attendance,r.eventName,r.eventDate,r.shiftLabel||'',r.hours,r.minutes,formatDuration(r)];});
      document.getElementById('previewCard').classList.remove('hidden');
      document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';
      document.getElementById('previewTable').innerHTML=makeTable(['Row','Status'].concat(SHIFT_EVENT_LOG_HEADERS).concat(['Duration']),rows);
      showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged and will not be imported.':'Preview created. Attendance event log rows are ready.');
    };

    const originalGetBatchEditableOptions=getBatchEditableOptions;
    getBatchEditableOptions=function(){
      if(pendingImport&&pendingImport.type==='attendanceLog')return[['attendance','Attendance'],['eventName','Event Name'],['eventDate','Event Date'],['shiftLabel','Shift'],['hours','Hours'],['minutes','Minutes']].map(function(f){return'<option value="'+f[0]+'">'+f[1]+'</option>';}).join('');
      return originalGetBatchEditableOptions();
    };

    const originalRenderCleanBucket=renderCleanBucket;
    renderCleanBucket=function(){
      if(!pendingImport||pendingImport.type!=='attendanceLog')return originalRenderCleanBucket();
      const rows=pendingImport.clean.map(function(item){return[item.incoming.name,item.incoming.email,item.incoming.contact,item.incoming.attendance,item.incoming.eventName,item.incoming.eventDate,item.incoming.shiftLabel||'',item.incoming.hours,item.incoming.minutes,formatDuration(item.incoming),item.reason];});
      document.getElementById('cleanBucket').innerHTML='<h3>Attendance Event Log Rows</h3>'+(rows.length?makeTable(['Name','Email','Contact','Attendance','Event Name','Event Date','Shift','Hours','Minutes','Duration','Status'],rows):'<p class="muted">None.</p>');
    };

    eventLogExportRows=function(){return(appData.attendanceLog||[]).map(function(row){return safeExportRow({Name:row.name,Email:row.email,Contact:row.contact,Attendance:row.attendance,'Event Name':row.eventName,'Event Date':row.eventDate,Shift:row.shiftLabel||'',Hours:durationHoursPart(row),Minutes:durationMinutesPart(row),'Decimal Hours':durationDecimalHours(row),'Duration Minutes':row.durationMinutes});});};

    downloadSampleAttendance=function(){
      const sheet=XLSX.utils.aoa_to_sheet([SHIFT_EVENT_LOG_HEADERS,['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15','Shift 1',4,30],['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15','Shift 2',3,0],['Ali Ahmad','ali@example.com','8123 4567','','Community Event','2026-01-15','Shift 1',0,0]]);
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Attendance Event Log');XLSX.writeFile(wb,'attendance_event_log.xlsx');
    };

    if(window.MaklomSharedDB){
      const S=window.MaklomSharedDB;
      if(typeof S.dbEventToLocal==='function'){
        const oldDbEventToLocal=S.dbEventToLocal;
        S.dbEventToLocal=function(row){const local=oldDbEventToLocal(row);local.shiftLabel=row&&row.shift_label||'';return local;};
      }
      if(typeof S.eventToDb==='function'){
        const oldEventToDb=S.eventToDb;
        S.eventToDb=function(row){const db=oldEventToDb(row);db.shift_label=S.nonBlank(row&&row.shiftLabel);return db;};
      }
    }

    function injectShiftEditors(){
      const rowsById={};(appData.attendanceLog||[]).forEach(function(row){rowsById[row.id]=row;});
      const table=document.querySelector('#eventLogTable .event-log-desktop table');
      if(table){
        const header=table.querySelector('thead tr');
        if(header&&!header.querySelector('[data-shift-label-column]')){
          const cells=Array.from(header.children);const dateIndex=cells.findIndex(function(cell){return cleanText(cell.textContent)==='Event Date';});
          if(dateIndex>-1){const th=document.createElement('th');th.dataset.shiftLabelColumn='true';th.textContent='Shift';header.insertBefore(th,cells[dateIndex].nextSibling);}
        }
        table.querySelectorAll('tbody tr[data-event-log-row]').forEach(function(tr){
          if(tr.querySelector('[data-shift-label-cell]'))return;
          const row=rowsById[tr.getAttribute('data-event-log-row')];if(!row)return;
          const headerCells=Array.from(table.querySelectorAll('thead th'));const dateIndex=headerCells.findIndex(function(cell){return cleanText(cell.textContent)==='Event Date';});
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
        label.appendChild(input);fields.insertBefore(label,fields.querySelector('label:nth-of-type(5)')||fields.firstChild);
      });
    }

    const currentRenderEventLogEditor=renderEventLogEditor;
    renderEventLogEditor=function(){currentRenderEventLogEditor();injectShiftEditors();};
    injectShiftEditors();
  }

  window.detectEventLogDuplicatePairs=detectDuplicatePairs;
  window.eventLogRowsAreSuspectedDuplicates=rowsAreSuspectedDuplicates;
  window.eventLogExplicitShiftFromName=explicitShiftFromName;

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installShiftFieldSupport);else installShiftFieldSupport();
})();
