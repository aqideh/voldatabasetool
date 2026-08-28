(function installEventLogRoundtrip(){
  const EVENT_LOG_EXPORT_FIELDS={
    'Event Log ID':'id',
    'Name':'name',
    'Email':'email',
    'Contact':'contact',
    'Attendance':'attendance',
    'Event Name':'eventName',
    'Event Date':'eventDate',
    'Hours':'hours',
    'Minutes':'minutes',
    'Decimal Hours':'decimalHours',
    'Duration Minutes':'durationMinutes',
    'Grab Voucher Code 1':'grabVoucherCode1',
    'Grab Voucher Code 2':'grabVoucherCode2',
    'Grab Voucher Code 3':'grabVoucherCode3'
  };

  function headerMap(headers){
    const map={};
    (headers||[]).forEach(function(header,index){
      const key=EVENT_LOG_EXPORT_FIELDS[cleanText(header)];
      if(key)map[key]=index;
    });
    return map;
  }

  function looksLikeMaklomEventLog(headers){
    if(!Array.isArray(headers))return false;
    const map=headerMap(headers);
    const hasIdentity=map.name!=null&&(map.email!=null||map.contact!=null);
    const hasEvent=map.eventName!=null&&map.eventDate!=null&&map.attendance!=null;
    const hasMaklomMarker=map.id!=null||map.decimalHours!=null||map.durationMinutes!=null;
    return hasIdentity&&hasEvent&&hasMaklomMarker;
  }

  function valueAt(row,map,key){return map[key]==null?'':row[map[key]];}

  function mapMaklomEventLogRow(row,rowNumber,map){
    const rawAttendance=cleanText(valueAt(row,map,'attendance'));
    const attendance=rawAttendance===''?'':(rawAttendance.toLowerCase()==='yes'?'yes':rawAttendance);
    let hours=cleanText(valueAt(row,map,'hours'));
    let minutes=cleanText(valueAt(row,map,'minutes'));
    const storedDuration=Number(valueAt(row,map,'durationMinutes'));
    if((hours===''&&minutes==='')&&Number.isFinite(storedDuration)&&storedDuration>=0){
      hours=String(Math.floor(storedDuration/60));
      minutes=String(Math.floor(storedDuration%60));
    }
    const rawId=safeText(valueAt(row,map,'id'),'id');
    return{
      id:rawId||makeId('evt'),
      rowNumber:rowNumber,
      name:safeText(valueAt(row,map,'name'),'name'),
      email:safeText(valueAt(row,map,'email'),'email'),
      contact:normaliseContact(valueAt(row,map,'contact')),
      attendance:attendance,
      eventName:safeText(valueAt(row,map,'eventName'),'eventName'),
      eventDate:safeDate(valueAt(row,map,'eventDate'),'eventDate'),
      hours:hours,
      minutes:minutes,
      durationMinutes:durationMinutesFromParts(hours,minutes,attendance),
      grabVoucherCode1:safeText(valueAt(row,map,'grabVoucherCode1'),'grabVoucherCode1'),
      grabVoucherCode2:safeText(valueAt(row,map,'grabVoucherCode2'),'grabVoucherCode2'),
      grabVoucherCode3:safeText(valueAt(row,map,'grabVoucherCode3'),'grabVoucherCode3'),
      _eventLogReimport:true,
      _eventLogHadStableId:rawId!==''
    };
  }

  function roundtripExportRows(){
    return (appData.attendanceLog||[]).map(function(row){
      return safeExportRow({
        'Event Log ID':row.id,
        Name:row.name,
        Email:row.email,
        Contact:row.contact,
        Attendance:row.attendance,
        'Event Name':row.eventName,
        'Event Date':row.eventDate,
        Hours:durationHoursPart(row),
        Minutes:durationMinutesPart(row),
        'Decimal Hours':durationDecimalHours(row),
        'Duration Minutes':row.durationMinutes,
        'Grab Voucher Code 1':row.grabVoucherCode1||'',
        'Grab Voucher Code 2':row.grabVoucherCode2||'',
        'Grab Voucher Code 3':row.grabVoucherCode3||''
      });
    });
  }

  function exportEventLog(){
    if(!confirm('Export the attendance event log? The file may contain volunteer contact details and voucher codes.'))return;
    writeWorkbook('attendance_event_log.xlsx',[['Attendance Event Log',roundtripExportRows()]]);
  }

  eventLogExportRows=roundtripExportRows;

  const previousReadExcelFile=readExcelFile;
  readExcelFile=function(file){
    uploadedType=document.getElementById('fileType').value;
    if(!file.name.toLowerCase().endsWith('.xlsx')&&!file.name.toLowerCase().endsWith('.xls')){
      showNotice('uploadStatus','bad','Please upload an Excel .xlsx or .xls file.');return;
    }
    if(file.size>MAX_FILE_BYTES){showNotice('uploadStatus','bad','File rejected. Maximum file size is 5 MB.');return;}
    const reader=new FileReader();
    reader.onload=function(e){
      try{
        const workbook=XLSX.read(e.target.result,{type:'array',cellDates:true});
        let preferred='';
        if(uploadedType==='attendance')preferred='Attendance Event Log';
        if(uploadedType==='roster')preferred='Volunteer Particulars';
        const sheetName=preferred&&workbook.SheetNames.indexOf(preferred)>-1?preferred:workbook.SheetNames[0];
        const sheet=workbook.Sheets[sheetName];
        validateAndPreviewRows(XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}));
      }catch(error){showNotice('uploadStatus','bad','The workbook could not be read as an Excel file.');}
    };
    reader.readAsArrayBuffer(file);
  };

  const previousValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    if(uploadedType!=='attendance'||!rows.length||!looksLikeMaklomEventLog(rows[0]))return previousValidateAndPreviewRows(rows);
    if(rows.length-1>MAX_IMPORT_ROWS){
      document.getElementById('previewCard').classList.add('hidden');
      showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');return;
    }
    const map=headerMap(rows[0]);
    uploadedRows=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      const mapped=mapMaklomEventLogRow(rows[i],i+1,map);
      mapped.issue=validateMappedRow(mapped,'attendance');
      mapped.valid=mapped.issue==='';
      uploadedRows.push(mapped);
    }
    renderPreview();
    const invalid=uploadedRows.filter(function(row){return !row.valid;}).length;
    const stable=map.id!=null;
    const message=stable
      ?'MakLom Event Log export detected. Existing rows will update by Event Log ID and new rows will be added after Merge Review.'
      :'Legacy MakLom Event Log export detected without Event Log ID. Valid rows will be treated as new rows; export again from the updated MakLom before making future round-trip edits.';
    showNotice('uploadStatus',invalid?'warn':'ok',invalid?message+' '+invalid+' row(s) are invalid and will not be imported.':message);
  };

  const previousPrepareMergeReview=prepareMergeReview;
  prepareMergeReview=function(){
    if(uploadedType!=='attendance'||!uploadedRows.some(function(row){return row._eventLogReimport;}))return previousPrepareMergeReview();
    const valid=uploadedRows.filter(function(row){return row.valid;});
    if(!valid.length){showNotice('uploadStatus','bad','No valid rows are available to import.');return;}
    pendingImport={
      type:'attendanceLogRoundtrip',
      clean:valid.map(function(row){
        const existing=row._eventLogHadStableId&&(appData.attendanceLog||[]).some(function(current){return current.id===row.id;});
        return{
          action:existing?'updateEventLog':'addEventLog',
          incoming:row,
          reason:existing?'Existing Event Log ID found; this row will be updated.':(row._eventLogHadStableId?'Event Log ID was not found; this row will be added as new.':'No Event Log ID; this row will be added as new.')
        };
      }),
      conflicts:[],suspects:[],autoMergeLog:[]
    };
    showView('mergeView');
  };

  const previousRenderCleanBucket=renderCleanBucket;
  renderCleanBucket=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLogRoundtrip')return previousRenderCleanBucket();
    const rows=pendingImport.clean.map(function(item){
      const r=item.incoming;
      return[item.action==='updateEventLog'?'Update':'Add',r.name,r.email,r.contact,r.attendance,r.eventName,r.eventDate,r.hours,r.minutes,r.grabVoucherCode1||'',r.grabVoucherCode2||'',r.grabVoucherCode3||'',item.reason];
    });
    document.getElementById('cleanBucket').innerHTML='<h3>Event Log Import Rows</h3>'+(rows.length?makeTable(['Action','Name','Email','Contact','Attendance','Event Name','Event Date','Hours','Minutes','Grab Voucher Code 1','Grab Voucher Code 2','Grab Voucher Code 3','Status'],rows):'<p class="muted">None.</p>');
  };

  const previousRenderBatchEditBucket=renderBatchEditBucket;
  renderBatchEditBucket=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLogRoundtrip')return previousRenderBatchEditBucket();
    document.getElementById('batchEditBucket').innerHTML='<h3>Event Log round-trip import</h3><p class="muted">Review the rows below before confirming. Existing Event Log IDs are updated in place; rows without a matching ID are added. Rows omitted from the workbook are not deleted.</p>';
  };

  const previousConfirmImport=confirmImport;
  confirmImport=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLogRoundtrip')return previousConfirmImport();
    let added=0,updated=0;
    pendingImport.clean.forEach(function(item){
      const incoming=item.incoming;
      if(item.action==='updateEventLog'){
        const index=(appData.attendanceLog||[]).findIndex(function(row){return row.id===incoming.id;});
        if(index>-1){
          const cleaned=validateEventLogRow(incoming);
          cleaned.id=incoming.id;
          appData.attendanceLog[index]=cleaned;
          ensureVolunteerForEventLogRow(cleaned);
          updated++;
          return;
        }
      }
      appendAttendanceLogRow(incoming);
      added++;
    });
    appData.mergeLog.push({date:new Date().toISOString(),level:'info',action:'event log round-trip imported',existingName:'',incomingName:'',reason:'Updated '+updated+' event log rows and added '+added+' new rows.'});
    pendingImport=null;
    saveData();
    showView('eventLogView');
  };

  function installUi(){
    const grid=document.querySelector('#eventLogView .card .grid');
    if(grid&&!document.getElementById('exportEventLogXlsx')){
      const controls=document.createElement('div');
      controls.innerHTML='<label>Event Log file</label><div class="row"><button id="exportEventLogXlsx" type="button">Export Event Log</button><button id="importEventLogXlsx" type="button">Import Event Log</button></div>';
      grid.appendChild(controls);
      document.getElementById('exportEventLogXlsx').addEventListener('click',exportEventLog);
      document.getElementById('importEventLogXlsx').addEventListener('click',function(){
        const select=document.getElementById('fileType');
        select.value='attendance';
        uploadedType='attendance';
        showView('uploadView');
        document.getElementById('fileInput').click();
      });
    }
    const exportCard=document.querySelector('#exportView .card');
    if(exportCard&&!document.getElementById('exportEventLogXlsxSecondary')){
      const button=document.createElement('button');
      button.id='exportEventLogXlsxSecondary';
      button.type='button';
      button.textContent='Export Event Log.xlsx';
      button.addEventListener('click',exportEventLog);
      exportCard.appendChild(button);
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUi);else installUi();
})();
