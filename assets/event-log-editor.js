let eventLogSearchQuery='';
let eventLogAttendanceFilter='';

function installEventLogControls(){
  const search=document.getElementById('eventLogSearch');
  if(!search||search.dataset.wired==='true')return;
  search.dataset.wired='true';
  search.addEventListener('input',function(){eventLogSearchQuery=search.value.toLowerCase().trim();renderEventLogEditor();});
  const filter=document.getElementById('eventLogAttendanceFilter');
  filter.addEventListener('change',function(){eventLogAttendanceFilter=filter.value;renderEventLogEditor();});
  document.getElementById('clearEventLogFilters').addEventListener('click',clearEventLogFilters);
  document.getElementById('addEventLogRow').addEventListener('click',addEventLogRow);
}

function clearEventLogFilters(){
  eventLogSearchQuery='';
  eventLogAttendanceFilter='';
  const search=document.getElementById('eventLogSearch');
  const filter=document.getElementById('eventLogAttendanceFilter');
  if(search)search.value='';
  if(filter)filter.value='';
  renderEventLogEditor();
}

function getFilteredEventLogRows(){
  const rows=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  return rows.filter(function(row){
    const text=[row.name,row.email,row.contact,row.attendance,row.eventName,row.eventDate,row.hours].join(' ').toLowerCase();
    const attendanceMatch=!eventLogAttendanceFilter||(eventLogAttendanceFilter==='yes'&&attendanceWasCaptured(row))||(eventLogAttendanceFilter==='blank'&&!attendanceWasCaptured(row));
    return(!eventLogSearchQuery||text.indexOf(eventLogSearchQuery)>-1)&&attendanceMatch;
  }).sort(function(a,b){return(b.eventDate||'').localeCompare(a.eventDate||'')||(a.name||'').localeCompare(b.name||'');});
}

function renderEventLogSummary(rows,totalRows){
  const attended=(appData.attendanceLog||[]).filter(attendanceWasCaptured).length;
  const noShow=(appData.attendanceLog||[]).filter(function(row){return !attendanceWasCaptured(row);}).length;
  const hours=(appData.attendanceLog||[]).reduce(function(total,row){return total+(attendanceWasCaptured(row)?Number(row.hours)||0:0);},0);
  return '<p><span class="pill neutral">'+totalRows+' total rows</span> <span class="pill ok">'+attended+' attended</span> <span class="pill warn">'+noShow+' no-show / blank</span> <span class="pill neutral">'+rows.length+' visible</span> <span class="pill neutral">'+hours+' hours</span></p>';
}

function renderEventLogEditor(){
  installEventLogControls();
  const target=document.getElementById('eventLogTable');
  const summary=document.getElementById('eventLogSummary');
  if(!target||!summary)return;
  appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  const rows=getFilteredEventLogRows();
  summary.innerHTML=renderEventLogSummary(rows,appData.attendanceLog.length);
  if(!rows.length){target.innerHTML='<p class="muted">No event log rows match the current filters.</p>';return;}
  let html='<table><thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Attendance</th><th>Event Name</th><th>Event Date</th><th>Hours</th><th></th></tr></thead><tbody>';
  rows.forEach(function(row){
    html+='<tr>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.name)+'" oninput="editEventLogField(\''+row.id+'\',\'name\',this.value)"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.email)+'" oninput="editEventLogField(\''+row.id+'\',\'email\',this.value)"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.contact)+'" oninput="editEventLogField(\''+row.id+'\',\'contact\',this.value)"></td>'+
      '<td><select onchange="editEventLogField(\''+row.id+'\',\'attendance\',this.value)"><option value="" '+(attendanceWasCaptured(row)?'':'selected')+'>blank</option><option value="yes" '+(attendanceWasCaptured(row)?'selected':'')+'>yes</option></select></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventName)+'" oninput="editEventLogField(\''+row.id+'\',\'eventName\',this.value)"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventDate)+'" oninput="editEventLogField(\''+row.id+'\',\'eventDate\',this.value)"></td>'+
      '<td><input type="number" min="0" max="100" value="'+escapeHtml(row.hours)+'" oninput="editEventLogField(\''+row.id+'\',\'hours\',this.value)"></td>'+
      '<td><button class="small danger" onclick="deleteEventLogRow(\''+row.id+'\')">Delete</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  target.innerHTML=html;
}

function getEventLogRow(id){return(appData.attendanceLog||[]).find(function(row){return row.id===id;});}

function editEventLogField(id,key,value){
  const row=getEventLogRow(id);
  if(!row)return;
  if(key==='attendance'){
    row.attendance=normaliseAttendanceFlag(value);
    if(!attendanceWasCaptured(row))row.hours=0;
  }else if(key==='hours'){
    row.hours=normaliseEventLogHours(value,row.attendance);
  }else if(key==='eventDate'){
    row.eventDate=safeDate(value,key);
  }else if(key==='contact'){
    row.contact=normaliseContact(value);
  }else if(key==='email'){
    row.email=safeText(value,key).toLowerCase();
  }else{
    row[key]=safeText(value,key);
  }
  saveData();
  renderEventLogSummaryOnly();
  renderDatabase();
  renderDashboard();
}

function renderEventLogSummaryOnly(){
  const summary=document.getElementById('eventLogSummary');
  if(!summary)return;
  const rows=getFilteredEventLogRows();
  summary.innerHTML=renderEventLogSummary(rows,(appData.attendanceLog||[]).length);
}

function addEventLogRow(){
  appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  appData.attendanceLog.unshift(validateEventLogRow({name:'',email:'',contact:'',attendance:'',eventName:'',eventDate:'',hours:0}));
  saveData();
  renderEventLogEditor();
  renderDatabase();
  renderDashboard();
}

function deleteEventLogRow(id){
  const row=getEventLogRow(id);
  if(!row)return;
  if(!confirm('Delete this event log row?'))return;
  appData.attendanceLog=appData.attendanceLog.filter(function(item){return item.id!==id;});
  saveData();
  renderEventLogEditor();
  renderDatabase();
  renderDashboard();
}

const originalRenderAllForEventLogEditor=renderAll;
renderAll=function(){originalRenderAllForEventLogEditor();installEventLogControls();renderEventLogEditor();};

document.addEventListener('DOMContentLoaded',function(){installEventLogControls();renderEventLogEditor();});
