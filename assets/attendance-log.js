const EVENT_LOG_HEADERS=['Name','Email','Contact','Attendance','Event Name','Event Date','Hours'];

function normaliseAttendanceFlag(value){return cleanText(value).toLowerCase()==='yes'?'yes':'';}
function attendanceWasCaptured(row){return normaliseAttendanceFlag(row&&row.attendance)==='yes';}
function normaliseEventLogHours(value,attendance){return attendanceWasCaptured({attendance:attendance})?normaliseHours(value):0;}
function normaliseContact(value){return safeText(value,'phone');}
function eventLogVolunteerKeyFromVolunteer(v){return normalizeEmail(v.email)||normalizePhone(v.phone);}
function eventLogVolunteerKeyFromRow(row){return normalizeEmail(row.email)||normalizePhone(row.contact);}
function eventLogRowsForVolunteer(v){const key=eventLogVolunteerKeyFromVolunteer(v);if(!key)return[];return(appData.attendanceLog||[]).filter(function(row){return eventLogVolunteerKeyFromRow(row)===key;});}

function validateEventLogRow(raw){
  const attendance=normaliseAttendanceFlag(raw&&raw.attendance);
  return{
    id:safeText(raw&&raw.id||makeId('evt'),'id'),
    name:safeText(raw&&raw.name,'name'),
    email:safeText(raw&&raw.email,'email'),
    contact:normaliseContact(raw&&raw.contact),
    attendance:attendance,
    eventName:safeText(raw&&raw.eventName,'eventName'),
    eventDate:safeDate(raw&&raw.eventDate,'eventDate'),
    hours:normaliseEventLogHours(raw&&raw.hours,attendance)
  };
}

function migrateLegacyAttendanceRows(volunteers){
  const rows=[];
  volunteers.forEach(function(v){
    (v.attendance||[]).forEach(function(a){
      rows.push(validateEventLogRow({id:a.id||makeId('evt'),name:v.name,email:v.email,contact:v.phone,attendance:'yes',eventName:a.eventName,eventDate:a.date,hours:a.hours}));
    });
    v.attendance=[];
  });
  return rows;
}

const originalValidateJsonSaveForEventLog=validateJsonSave;
validateJsonSave=function(raw){
  const cleaned=originalValidateJsonSaveForEventLog(raw);
  const source=raw&&typeof raw==='object'?raw:{};
  const explicitLog=Array.isArray(source.attendanceLog)?source.attendanceLog.slice(0,MAX_IMPORT_ROWS).map(validateEventLogRow):[];
  const migrated=explicitLog.length?[]:migrateLegacyAttendanceRows(cleaned.volunteers);
  cleaned.attendanceLog=explicitLog.concat(migrated).slice(0,MAX_IMPORT_ROWS);
  return cleaned;
};

const originalClearLocalDataForEventLog=clearLocalData;
clearLocalData=function(){if(!confirm('Clear the local volunteer database in this browser?'))return;appData={volunteers:[],attendanceLog:[],suspectedDuplicates:[],mergeLog:[]};pendingImport=null;expandedVolunteerId=null;saveData();renderAll();};

mapAttendanceRow=function(row,rowNumber){
  const attendance=normaliseAttendanceFlag(row[3]);
  return validateEventLogRow({rowNumber:rowNumber,name:row[0],email:row[1],contact:row[2],attendance:attendance,eventName:row[4],eventDate:row[5],hours:row[6]});
};

const originalValidateMappedRowForEventLog=validateMappedRow;
validateMappedRow=function(row,type){
  if(type!=='attendance')return originalValidateMappedRowForEventLog(row,type);
  const issues=[];
  if(cleanText(row.name)==='')issues.push('Name is required');
  if(cleanText(row.email)===''&&cleanText(row.contact)==='')issues.push('Email or Contact is required');
  if(row.email&&!isValidEmail(row.email))issues.push('Email format is invalid');
  if(cleanText(row.attendance)!==''&&normaliseAttendanceFlag(row.attendance)!=='yes')issues.push('Attendance must be yes or blank');
  if(cleanText(row.eventName)==='')issues.push('Event Name is required');
  if(row.eventDate&&!/^\d{4}-\d{2}-\d{2}$/.test(row.eventDate))issues.push('Event Date should use YYYY-MM-DD');
  return issues.join('; ');
};

const originalValidateAndPreviewRowsForEventLog=validateAndPreviewRows;
validateAndPreviewRows=function(rows){
  if(uploadedType!=='attendance')return originalValidateAndPreviewRowsForEventLog(rows);
  if(!rows.length||!headersMatch(rows[0],EVENT_LOG_HEADERS)){
    document.getElementById('previewCard').classList.add('hidden');
    showNotice('uploadStatus','bad','Template rejected. Expected columns in this exact order: '+EVENT_LOG_HEADERS.join(', '));
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
    mapped.rowNumber=i+1;
    mapped.issue=validateMappedRow(mapped,'attendance');
    mapped.valid=mapped.issue==='';
    uploadedRows.push(mapped);
  }
  renderPreview();
};

const originalRenderPreviewForEventLog=renderPreview;
renderPreview=function(){
  if(uploadedType!=='attendance')return originalRenderPreviewForEventLog();
  const invalid=uploadedRows.filter(function(r){return !r.valid;}).length;
  const rows=uploadedRows.map(function(r){return[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.email,r.contact,r.attendance,r.eventName,r.eventDate,r.hours];});
  document.getElementById('previewCard').classList.remove('hidden');
  document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';
  document.getElementById('previewTable').innerHTML=makeTable(['Row','Status'].concat(EVENT_LOG_HEADERS),rows);
  showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged and will not be imported.':'Preview created. Attendance event log rows are ready.');
};

const originalPrepareMergeReviewForEventLog=prepareMergeReview;
prepareMergeReview=function(){
  if(uploadedType!=='attendance')return originalPrepareMergeReviewForEventLog();
  const valid=uploadedRows.filter(function(r){return r.valid;});
  if(!valid.length){showNotice('uploadStatus','bad','No valid rows are available to import.');return;}
  pendingImport={type:'attendanceLog',clean:valid.map(function(row){return{action:'addEventLog',incoming:row,reason:attendanceWasCaptured(row)?'Attendance captured.':'Confirmed/deployed but did not attend.'};}),conflicts:[],suspects:[],autoMergeLog:[]};
  showView('mergeView');
};

const originalGetBatchEditableOptionsForEventLog=getBatchEditableOptions;
getBatchEditableOptions=function(){
  if(pendingImport&&pendingImport.type==='attendanceLog')return[['attendance','Attendance'],['eventName','Event Name'],['eventDate','Event Date'],['hours','Hours']].map(function(f){return'<option value="'+f[0]+'">'+f[1]+'</option>';}).join('');
  return originalGetBatchEditableOptionsForEventLog();
};

const originalApplyBatchFieldEditForEventLog=applyBatchFieldEdit;
applyBatchFieldEdit=function(){
  if(!pendingImport||pendingImport.type!=='attendanceLog')return originalApplyBatchFieldEditForEventLog();
  const target=document.getElementById('batchTarget').value,field=document.getElementById('batchField').value,value=document.getElementById('batchValue').value;
  getPendingItemsByTarget(target).forEach(function(item){
    if(field==='hours')item.incoming.hours=normaliseEventLogHours(value,item.incoming.attendance);
    else if(field==='attendance')item.incoming.attendance=normaliseAttendanceFlag(value);
    else if(field==='eventDate')item.incoming.eventDate=safeDate(value,field);
    else item.incoming[field]=safeText(value,field);
    if(field==='attendance'&&item.incoming.attendance==='')item.incoming.hours=0;
  });
  renderMergeReview();
};

const originalRenderCleanBucketForEventLog=renderCleanBucket;
renderCleanBucket=function(){
  if(!pendingImport||pendingImport.type!=='attendanceLog')return originalRenderCleanBucketForEventLog();
  const rows=pendingImport.clean.map(function(item){return[item.incoming.name,item.incoming.email,item.incoming.contact,item.incoming.attendance,item.incoming.eventName,item.incoming.eventDate,item.incoming.hours,item.reason];});
  document.getElementById('cleanBucket').innerHTML='<h3>Attendance Event Log Rows</h3>'+(rows.length?makeTable(['Name','Email','Contact','Attendance','Event Name','Event Date','Hours','Status'],rows):'<p class="muted">None.</p>');
};

const originalRenderBatchEditBucketForEventLog=renderBatchEditBucket;
renderBatchEditBucket=function(){
  if(!pendingImport||pendingImport.type!=='attendanceLog')return originalRenderBatchEditBucketForEventLog();
  let html='<h3>Pre-import attendance log edit</h3><p class="muted">These changes apply only to staged attendance event log rows until Confirm Import is clicked.</p>';
  html+='<div class="grid"><div><label for="batchTarget">Apply to</label><select id="batchTarget"><option value="clean">All event log rows</option><option value="all">All event log rows</option></select></div><div><label for="batchField">Field to edit</label><select id="batchField">'+getBatchEditableOptions()+'</select></div><div><label for="batchValue">New value</label><input id="batchValue" maxlength="2000" placeholder="Use yes or blank for attendance"></div></div><div class="row"><button onclick="applyBatchFieldEdit()">Apply batch edit</button></div>';
  document.getElementById('batchEditBucket').innerHTML=html;
};

function appendAttendanceLogRow(row){appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];appData.attendanceLog.push(validateEventLogRow(row));}

const originalConfirmImportForEventLog=confirmImport;
confirmImport=function(){
  if(!pendingImport||pendingImport.type!=='attendanceLog')return originalConfirmImportForEventLog();
  pendingImport.clean.forEach(function(item){appendAttendanceLogRow(item.incoming);});
  appData.mergeLog.push({date:new Date().toISOString(),level:'info',action:'attendance event log imported',existingName:'',incomingName:'',reason:'Imported '+pendingImport.clean.length+' attendance event log rows.'});
  pendingImport=null;
  saveData();
  showView('databaseView');
};

renderAttendanceEditor=function(v){
  const rows=eventLogRowsForVolunteer(v).sort(function(a,b){return(a.eventDate||'').localeCompare(b.eventDate||'');});
  if(!rows.length)return '<p class="muted">No attendance event log rows recorded for this volunteer.</p>';
  return makeTable(['Attendance','Event Name','Event Date','Hours'],rows.map(function(row){return[row.attendance,row.eventName,row.eventDate,row.hours];}));
};

editAttendanceField=function(){};
addAttendance=function(){alert('Attendance is managed through the separate attendance event log import.');};
deleteAttendance=function(){alert('Attendance is managed through the separate attendance event log import.');};

getTotalHours=function(v){return eventLogRowsForVolunteer(v).reduce(function(total,row){return total+(attendanceWasCaptured(row)?Number(row.hours)||0:0);},0);};
getLastActive=function(v){const dates=eventLogRowsForVolunteer(v).filter(attendanceWasCaptured).map(function(row){return row.eventDate;}).filter(Boolean).sort();return dates.length?dates[dates.length-1]:'';};

function eventLogExportRows(){return(appData.attendanceLog||[]).map(function(row){return safeExportRow({Name:row.name,Email:row.email,Contact:row.contact,Attendance:row.attendance,'Event Name':row.eventName,'Event Date':row.eventDate,Hours:row.hours});});}

const originalDownloadSampleAttendanceForEventLog=downloadSampleAttendance;
downloadSampleAttendance=function(){const sheet=XLSX.utils.aoa_to_sheet([EVENT_LOG_HEADERS,['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15',4],['Ali Ahmad','ali@example.com','8123 4567','','Community Event','2026-01-15',0]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Attendance Event Log');XLSX.writeFile(wb,'attendance_event_log.xlsx');};
