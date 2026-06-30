let eventLogSearchQuery='';
let eventLogAttendanceFilter='';
let eventLogEditorDirty=false;

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
    const text=[row.name,row.email,row.contact,row.attendance,row.eventName,row.eventDate,durationHoursPart(row),durationMinutesPart(row),formatDuration(row)].join(' ').toLowerCase();
    const attendanceMatch=!eventLogAttendanceFilter||(eventLogAttendanceFilter==='yes'&&attendanceWasCaptured(row))||(eventLogAttendanceFilter==='blank'&&!attendanceWasCaptured(row));
    return(!eventLogSearchQuery||text.indexOf(eventLogSearchQuery)>-1)&&attendanceMatch;
  }).sort(function(a,b){return(b.eventDate||'').localeCompare(a.eventDate||'')||(a.name||'').localeCompare(b.name||'');});
}

function renderEventLogSummary(rows,totalRows){
  const attended=(appData.attendanceLog||[]).filter(attendanceWasCaptured).length;
  const noShow=(appData.attendanceLog||[]).filter(function(row){return !attendanceWasCaptured(row);}).length;
  const totalMinutes=(appData.attendanceLog||[]).reduce(function(total,row){return total+(attendanceWasCaptured(row)?Number(row.durationMinutes)||0:0);},0);
  return '<p><span class="pill neutral">'+totalRows+' total rows</span> <span class="pill ok">'+attended+' attended</span> <span class="pill warn">'+noShow+' no-show / blank</span> <span class="pill neutral">'+rows.length+' visible</span> <span class="pill neutral">'+formatDuration({durationMinutes:totalMinutes})+' total</span></p>';
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
  let html='<table><thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Attendance</th><th>Event Name</th><th>Event Date</th><th>Hours</th><th>Minutes</th><th>Duration</th><th></th></tr></thead><tbody>';
  rows.forEach(function(row){
    html+='<tr data-event-log-row="'+escapeHtml(row.id)+'">'+
      '<td><input maxlength="500" value="'+escapeHtml(row.name)+'" oninput="editEventLogField(\''+row.id+'\',\'name\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.email)+'" oninput="editEventLogField(\''+row.id+'\',\'email\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.contact)+'" oninput="editEventLogField(\''+row.id+'\',\'contact\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><select onchange="editEventLogField(\''+row.id+'\',\'attendance\',this.value,this);commitEventLogEdit(true)"><option value="" '+(attendanceWasCaptured(row)?'':'selected')+'>blank</option><option value="yes" '+(attendanceWasCaptured(row)?'selected':'')+'>yes</option></select></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventName)+'" oninput="editEventLogField(\''+row.id+'\',\'eventName\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventDate)+'" oninput="editEventLogField(\''+row.id+'\',\'eventDate\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input type="number" min="0" max="100" step="1" value="'+escapeHtml(durationHoursPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'hours\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input type="number" min="0" max="59" step="1" value="'+escapeHtml(durationMinutesPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'minutes\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td data-duration-for="'+escapeHtml(row.id)+'">'+escapeHtml(formatDuration(row))+'</td>'+
      '<td><button class="small danger" onclick="deleteEventLogRow(\''+row.id+'\')">Delete</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  target.innerHTML=html;
}

function getEventLogRow(id){return(appData.attendanceLog||[]).find(function(row){return row.id===id;});}

function updateEventLogRowDurationCell(id){
  const row=getEventLogRow(id);
  const cell=document.querySelector('[data-duration-for="'+CSS.escape(id)+'"]');
  if(row&&cell)cell.textContent=formatDuration(row);
}

function refreshEventLogDependents(){
  const summary=document.getElementById('eventLogSummary');
  if(summary){const rows=getFilteredEventLogRows();summary.innerHTML=renderEventLogSummary(rows,(appData.attendanceLog||[]).length);}
  renderDatabase();
  renderDashboard();
}

function commitEventLogEdit(forceRender){
  if(!eventLogEditorDirty&&!forceRender)return;
  eventLogEditorDirty=false;
  if(forceRender)renderEventLogEditor();
  refreshEventLogDependents();
}

function editEventLogField(id,key,value,el){
  const row=getEventLogRow(id);
  if(!row)return;
  if(key==='attendance'){
    const hours=durationHoursPart(row),minutes=durationMinutesPart(row);
    row.attendance=normaliseAttendanceFlag(value);
    row.durationMinutes=durationMinutesFromParts(hours,minutes,row.attendance);
    updateEventLogRowDurationCell(id);
  }else if(key==='hours'){
    row.durationMinutes=durationMinutesFromParts(value,durationMinutesPart(row),row.attendance);
    updateEventLogRowDurationCell(id);
  }else if(key==='minutes'){
    row.durationMinutes=durationMinutesFromParts(durationHoursPart(row),value,row.attendance);
    updateEventLogRowDurationCell(id);
  }else if(key==='eventDate'){
    row.eventDate=safeDate(value,key);
  }else if(key==='contact'){
    row.contact=normaliseContact(value);
  }else if(key==='email'){
    row.email=safeText(value,key).toLowerCase();
  }else{
    row[key]=safeText(value,key);
  }
  if(el)el.dataset.saved='true';
  eventLogEditorDirty=true;
  saveData();
}

function addEventLogRow(){
  appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  appData.attendanceLog.unshift(validateEventLogRow({name:'',email:'',contact:'',attendance:'',eventName:'',eventDate:'',hours:0,minutes:0}));
  saveData();
  renderEventLogEditor();
  refreshEventLogDependents();
}

function deleteEventLogRow(id){
  const row=getEventLogRow(id);
  if(!row)return;
  if(!confirm('Delete this event log row?'))return;
  appData.attendanceLog=appData.attendanceLog.filter(function(item){return item.id!==id;});
  saveData();
  renderEventLogEditor();
  refreshEventLogDependents();
}

const originalRenderAllForEventLogEditor=renderAll;
renderAll=function(){originalRenderAllForEventLogEditor();installEventLogControls();renderEventLogEditor();};

document.addEventListener('DOMContentLoaded',function(){installEventLogControls();renderEventLogEditor();});
