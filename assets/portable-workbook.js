(function installPortableMaklomWorkbook(){
  const PORTABLE_VERSION='1';
  const VOLUNTEER_EXPORT_FIELDS=[
    ['Volunteer ID','id'],['Name','name'],['Volunteer NRIC','nric'],['Phone','phone'],['Email','email'],['Gender','gender'],['Address','address'],['Recruited Year','recruitedYear'],['Chat Session','chatSession'],['Chat Session Date Conducted','chatSessionDate'],['Interests','interests'],['Languages Spoken','languagesSpoken'],['Programmes Registered','programmesRegistered'],['Tags','tags'],['Emergency Contact Name','emergencyName'],['Emergency Contact Phone','emergencyPhone'],['T-Shirt Size','shirtSize'],['Dietary Requirements','dietary'],['Notes','notes']
  ];
  const REPORTING_EXPORT_FIELDS=[['Metric ID','id'],['Label','label'],['Value','value'],['Note','note']];

  function exportedVolunteerRows(){
    return (appData.volunteers||[]).map(function(v){
      const row={};
      VOLUNTEER_EXPORT_FIELDS.forEach(function(pair){
        const label=pair[0],key=pair[1];
        row[label]=key==='tags'?tagsToText(v.tags):v[key];
      });
      row['Total Hours']=getTotalHours(v);
      row['Last Active']=getLastActive(v);
      return safeExportRow(row);
    });
  }

  function exportedReportingRows(){
    return (Array.isArray(appData.reportingMetrics)?appData.reportingMetrics:[]).map(function(metric){
      return safeExportRow({'Metric ID':metric.id,'Label':metric.label,'Value':metric.value==null?'':metric.value,'Note':metric.note||''});
    });
  }

  function portableMetadataRows(){
    return[
      safeExportRow({Key:'Format',Value:'MakLom Portable Workbook'}),
      safeExportRow({Key:'Portable Version',Value:PORTABLE_VERSION}),
      safeExportRow({Key:'Exported At',Value:new Date().toISOString()}),
      safeExportRow({Key:'Volunteer Rows',Value:(appData.volunteers||[]).length}),
      safeExportRow({Key:'Event Log Rows',Value:(appData.attendanceLog||[]).length})
    ];
  }

  function exportPortableDatabase(){
    if(!confirm('Export the full MakLom portable database? This workbook contains volunteer personal data, attendance records, and may contain NRIC and voucher codes.'))return;
    writeWorkbook('maklom_portable_database.xlsx',[
      ['Volunteer Particulars',exportedVolunteerRows()],
      ['Attendance Event Log',typeof eventLogExportRows==='function'?eventLogExportRows():[]],
      ['Reporting Figures',exportedReportingRows()],
      ['MakLom Metadata',portableMetadataRows()]
    ]);
  }

  function sheetRows(workbook,name){
    const sheet=workbook.Sheets[name];
    return sheet?XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}):[];
  }

  function headerIndex(headers,label){
    for(let i=0;i<(headers||[]).length;i++)if(cleanText(headers[i])===label)return i;
    return -1;
  }

  function parseVolunteerSheet(rows){
    if(!rows.length)return{rows:[],issues:['Volunteer Particulars sheet is empty.']};
    const headers=rows[0];
    const map={};
    VOLUNTEER_EXPORT_FIELDS.forEach(function(pair){const index=headerIndex(headers,pair[0]);if(index>-1)map[pair[1]]=index;});
    const issues=[];
    if(map.name==null)issues.push('Volunteer Particulars is missing Name.');
    if(map.phone==null&&map.email==null)issues.push('Volunteer Particulars needs Phone or Email.');
    const out=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      const raw={rowNumber:i+1,tags:[],attendance:[]};
      Object.keys(map).forEach(function(key){
        const value=rows[i][map[key]];
        if(key==='tags')raw.tags=parseTags(value);else raw[key]=value;
      });
      const volunteer=sanitizeVolunteerRow(raw);
      volunteer.id=safeText(raw.id||'','id');
      volunteer._portableWorkbook=true;
      const issue=validateMappedRow(volunteer,'roster');
      volunteer.issue=issue;
      volunteer.valid=issue==='';
      out.push(volunteer);
    }
    return{rows:out,issues:issues};
  }

  function parseEventSheet(rows){
    if(!rows.length)return{rows:[],issues:['Attendance Event Log sheet is empty.']};
    const headers=rows[0];
    const labels={id:'Event Log ID',name:'Name',email:'Email',contact:'Contact',attendance:'Attendance',eventName:'Event Name',eventDate:'Event Date',hours:'Hours',minutes:'Minutes',durationMinutes:'Duration Minutes',grabVoucherCode1:'Grab Voucher Code 1',grabVoucherCode2:'Grab Voucher Code 2',grabVoucherCode3:'Grab Voucher Code 3'};
    const map={};Object.keys(labels).forEach(function(key){const index=headerIndex(headers,labels[key]);if(index>-1)map[key]=index;});
    const issues=[];
    if(map.name==null)issues.push('Attendance Event Log is missing Name.');
    if(map.email==null&&map.contact==null)issues.push('Attendance Event Log needs Email or Contact.');
    if(map.eventName==null)issues.push('Attendance Event Log is missing Event Name.');
    if(map.eventDate==null)issues.push('Attendance Event Log is missing Event Date.');
    const out=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      function at(key){return map[key]==null?'':rows[i][map[key]];}
      const rawAttendance=cleanText(at('attendance'));
      const attendance=rawAttendance===''?'':(rawAttendance.toLowerCase()==='yes'?'yes':rawAttendance);
      let hours=cleanText(at('hours')),minutes=cleanText(at('minutes'));
      const stored=Number(at('durationMinutes'));
      if(hours===''&&minutes===''&&Number.isFinite(stored)&&stored>=0){hours=String(Math.floor(stored/60));minutes=String(stored%60);}
      const event={
        id:safeText(at('id')||makeId('evt'),'id'),rowNumber:i+1,name:safeText(at('name'),'name'),email:safeText(at('email'),'email'),contact:normaliseContact(at('contact')),attendance:attendance,eventName:safeText(at('eventName'),'eventName'),eventDate:safeDate(at('eventDate'),'eventDate'),hours:hours,minutes:minutes,durationMinutes:durationMinutesFromParts(hours,minutes,attendance),
        grabVoucherCode1:safeText(at('grabVoucherCode1'),'grabVoucherCode1'),grabVoucherCode2:safeText(at('grabVoucherCode2'),'grabVoucherCode2'),grabVoucherCode3:safeText(at('grabVoucherCode3'),'grabVoucherCode3'),_portableWorkbook:true
      };
      const issue=validateMappedRow(event,'attendance');event.issue=issue;event.valid=issue==='';out.push(event);
    }
    return{rows:out,issues:issues};
  }

  function parseReportingSheet(rows){
    if(!rows.length)return[];
    const headers=rows[0],idIndex=headerIndex(headers,'Metric ID'),labelIndex=headerIndex(headers,'Label'),valueIndex=headerIndex(headers,'Value'),noteIndex=headerIndex(headers,'Note');
    const out=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      const label=cleanText(labelIndex>-1?rows[i][labelIndex]:'');
      if(!label)continue;
      const rawValue=valueIndex>-1?rows[i][valueIndex]:'';
      const numeric=cleanText(rawValue)===''?null:Number(rawValue);
      out.push({id:safeText(idIndex>-1?rows[i][idIndex]:'','id')||makeId('metric'),label:label.slice(0,80),value:Number.isFinite(numeric)&&numeric>=0?Math.floor(numeric):null,note:safeText(noteIndex>-1?rows[i][noteIndex]:'','notes').slice(0,180)});
    }
    return out;
  }

  function uniqueVolunteerMatch(row){
    const email=normalizeEmail(row.email),phone=normalizePhone(row.phone),nric=cleanText(row.nric).toUpperCase();
    if(row.id){const byId=(appData.volunteers||[]).filter(function(v){return v.id===row.id;});if(byId.length===1)return byId[0];}
    if(nric){const byNric=(appData.volunteers||[]).filter(function(v){return cleanText(v.nric).toUpperCase()===nric;});if(byNric.length===1)return byNric[0];}
    if(email){const byEmail=(appData.volunteers||[]).filter(function(v){return normalizeEmail(v.email)===email;});if(byEmail.length===1)return byEmail[0];}
    if(phone){const byPhone=(appData.volunteers||[]).filter(function(v){return normalizePhone(v.phone)===phone;});if(byPhone.length===1)return byPhone[0];}
    return null;
  }

  function applyVolunteer(existing,incoming){
    const target=existing||validateVolunteer({id:incoming.id||makeId('vol'),attendance:[]});
    if(!existing){target.id=incoming.id||target.id;appData.volunteers.push(target);}
    VOLUNTEER_SCHEMA.forEach(function(field){
      const key=field.key;
      if(key==='tags')target.tags=sanitiseTags(incoming.tags||[]);
      else target[key]=safeText(incoming[key],key);
    });
    if(incoming.nric!==undefined)target.nric=safeText(incoming.nric,'nric');
    target.id=target.id||incoming.id||makeId('vol');
    return target;
  }

  function applyEvent(incoming){
    appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
    const index=incoming.id?appData.attendanceLog.findIndex(function(row){return row.id===incoming.id;}):-1;
    const cleaned=validateEventLogRow(incoming);cleaned.id=incoming.id||cleaned.id;
    if(index>-1)appData.attendanceLog[index]=cleaned;else appData.attendanceLog.push(cleaned);
    ensureVolunteerForEventLogRow(cleaned);
    return index>-1?'updated':'added';
  }

  function renderPortablePreview(parsed){
    const volunteerInvalid=parsed.volunteers.filter(function(r){return !r.valid;}).length,eventInvalid=parsed.events.filter(function(r){return !r.valid;}).length;
    const summary=[['Volunteers',parsed.volunteers.length-volunteerInvalid,volunteerInvalid],['Event Log rows',parsed.events.length-eventInvalid,eventInvalid],['Reporting figures',parsed.reporting.length,0]];
    document.getElementById('previewCard').classList.remove('hidden');
    document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">Portable MakLom workbook</span></p>';
    document.getElementById('previewTable').innerHTML=makeTable(['Section','Ready','Invalid'],summary);
    showNotice('uploadStatus',(volunteerInvalid||eventInvalid)?'warn':'ok',(volunteerInvalid||eventInvalid)?'Portable workbook detected. Invalid rows will be skipped; valid rows can be imported.':'Portable MakLom workbook detected. Volunteers, events, and reporting figures are ready to import.');
  }

  let pendingPortableWorkbook=null;

  function readPortableWorkbook(file){
    if(!file.name.toLowerCase().endsWith('.xlsx')&&!file.name.toLowerCase().endsWith('.xls')){showNotice('uploadStatus','bad','Please upload an Excel .xlsx or .xls file.');return;}
    if(file.size>MAX_FILE_BYTES){showNotice('uploadStatus','bad','File rejected. Maximum file size is 5 MB.');return;}
    const reader=new FileReader();
    reader.onload=function(e){
      try{
        const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
        const required=['Volunteer Particulars','Attendance Event Log'];
        const missing=required.filter(function(name){return wb.SheetNames.indexOf(name)===-1;});
        if(missing.length){showNotice('uploadStatus','bad','Portable workbook rejected. Missing sheet(s): '+missing.join(', '));return;}
        const volunteers=parseVolunteerSheet(sheetRows(wb,'Volunteer Particulars'));
        const events=parseEventSheet(sheetRows(wb,'Attendance Event Log'));
        const structural=volunteers.issues.concat(events.issues);
        if(structural.length){showNotice('uploadStatus','bad','Portable workbook rejected. '+structural.join(' '));return;}
        pendingPortableWorkbook={volunteers:volunteers.rows,events:events.rows,reporting:parseReportingSheet(sheetRows(wb,'Reporting Figures'))};
        renderPortablePreview(pendingPortableWorkbook);
      }catch(error){showNotice('uploadStatus','bad','The portable MakLom workbook could not be read.');}
    };
    reader.readAsArrayBuffer(file);
  }

  function confirmPortableImport(){
    if(!pendingPortableWorkbook)return;
    const volunteers=pendingPortableWorkbook.volunteers.filter(function(row){return row.valid;});
    const events=pendingPortableWorkbook.events.filter(function(row){return row.valid;});
    let volunteerAdded=0,volunteerUpdated=0,eventAdded=0,eventUpdated=0;
    volunteers.forEach(function(row){const existing=uniqueVolunteerMatch(row);applyVolunteer(existing,row);if(existing)volunteerUpdated++;else volunteerAdded++;});
    events.forEach(function(row){if(applyEvent(row)==='updated')eventUpdated++;else eventAdded++;});
    if(pendingPortableWorkbook.reporting.length)appData.reportingMetrics=pendingPortableWorkbook.reporting;
    appData.mergeLog=Array.isArray(appData.mergeLog)?appData.mergeLog:[];
    appData.mergeLog.push({date:new Date().toISOString(),level:'info',action:'portable workbook imported',existingName:'',incomingName:'',reason:'Volunteers: '+volunteerUpdated+' updated, '+volunteerAdded+' added. Event log: '+eventUpdated+' updated, '+eventAdded+' added.'});
    pendingPortableWorkbook=null;saveData();renderAll();showView('databaseView');
    alert('Portable MakLom database imported. Volunteers: '+volunteerUpdated+' updated, '+volunteerAdded+' added. Event log: '+eventUpdated+' updated, '+eventAdded+' added.');
  }

  function installUi(){
    const fileType=document.getElementById('fileType');
    if(fileType&&!fileType.querySelector('option[value="portable"]')){
      const option=document.createElement('option');option.value='portable';option.textContent='Full MakLom portable database';fileType.appendChild(option);
    }
    const exportButton=document.getElementById('exportXlsx');
    if(exportButton){exportButton.textContent='Export portable database.xlsx';exportButton.onclick=exportPortableDatabase;}
    const exportCard=exportButton&&exportButton.closest('.card');
    if(exportCard&&!document.getElementById('portableImportInput')){
      const label=document.createElement('label');label.setAttribute('for','portableImportInput');label.textContent='Import portable database.xlsx';
      const input=document.createElement('input');input.id='portableImportInput';input.type='file';input.accept='.xlsx,.xls';
      exportCard.appendChild(label);exportCard.appendChild(input);
      input.addEventListener('change',function(e){if(e.target.files.length)readPortableWorkbook(e.target.files[0]);e.target.value='';});
    }
    const prepare=document.getElementById('prepareImport');
    if(prepare&&!prepare.dataset.portableHook){
      prepare.dataset.portableHook='true';
      prepare.addEventListener('click',function(event){if(pendingPortableWorkbook){event.stopImmediatePropagation();confirmPortableImport();}},true);
    }
  }

  const previousHandleFileInputChange=handleFileInputChange;
  handleFileInputChange=function(e){
    if(document.getElementById('fileType').value==='portable'){
      if(e.target.files.length)readPortableWorkbook(e.target.files[0]);e.target.value='';return;
    }
    return previousHandleFileInputChange(e);
  };
  const previousHandleDrop=handleDrop;
  handleDrop=function(e){
    if(document.getElementById('fileType').value!=='portable')return previousHandleDrop(e);
    e.preventDefault();document.getElementById('dropzone').classList.remove('drag');if(e.dataTransfer.files.length)readPortableWorkbook(e.dataTransfer.files[0]);
  };

  window.exportPortableDatabase=exportPortableDatabase;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUi);else installUi();
})();
