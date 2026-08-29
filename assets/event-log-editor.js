let eventLogSearchQuery='';
let eventLogAttendanceFilter='';
let eventLogEventFilter='';
let eventLogSort='newest';
let eventLogEditorDirty=false;

function eventLogViewIsActive(){
  const view=document.getElementById('eventLogView');
  return !!(view&&view.classList.contains('active'));
}

function installEventLogControls(){
  const search=document.getElementById('eventLogSearch');
  if(!search||search.dataset.wired==='true'){
    ensureEventLogFilterUi();
    updateEventLogFloatingUi();
    return;
  }
  search.dataset.wired='true';
  search.placeholder='Search volunteer, event, date or contact';
  search.addEventListener('input',function(){eventLogSearchQuery=search.value.toLowerCase().trim();renderEventLogEditor();});
  const filter=document.getElementById('eventLogAttendanceFilter');
  filter.addEventListener('change',function(){eventLogAttendanceFilter=filter.value;syncEventLogFilterControls();renderEventLogEditor();});
  document.getElementById('clearEventLogFilters').addEventListener('click',clearEventLogFilters);
  document.getElementById('addEventLogRow').addEventListener('click',addEventLogRow);
  ensureEventLogFilterUi();
  updateEventLogFloatingUi();
}

function ensureEventLogFilterUi(){
  if(document.getElementById('eventLogFilterFab'))return;
  const fab=document.createElement('button');
  fab.id='eventLogFilterFab';
  fab.type='button';
  fab.className='event-filter-fab';
  fab.setAttribute('aria-label','Open event log filters');
  fab.setAttribute('aria-expanded','false');
  fab.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.4 7.2v5.2l-3.2 1.6v-6.8L4 5z"></path></svg><span id="eventLogFilterBadge" class="event-filter-badge hidden">0</span>';
  fab.addEventListener('click',openEventLogFilterSheet);
  document.body.appendChild(fab);

  const sheet=document.createElement('div');
  sheet.id='eventLogFilterSheet';
  sheet.className='event-filter-sheet hidden';
  sheet.setAttribute('role','dialog');
  sheet.setAttribute('aria-modal','true');
  sheet.setAttribute('aria-labelledby','eventLogFilterTitle');
  sheet.innerHTML='<button type="button" class="event-filter-backdrop" data-event-filter-close aria-label="Close filters"></button><div class="event-filter-panel"><div class="event-filter-head"><div><h3 id="eventLogFilterTitle">Filters</h3><p class="muted">Narrow the roster without taking up screen space.</p></div><button type="button" class="small" data-event-filter-close>Close</button></div><div class="event-filter-fields"><div><label for="eventLogAttendanceFilterSheet">Attendance</label><select id="eventLogAttendanceFilterSheet"><option value="">All rows</option><option value="yes">Attended</option><option value="blank">No-show / blank</option></select></div><div><label for="eventLogEventFilterSheet">Event</label><select id="eventLogEventFilterSheet"><option value="">All events</option></select></div><div><label for="eventLogSortSheet">Sort</label><select id="eventLogSortSheet"><option value="newest">Newest event first</option><option value="name">Volunteer name A-Z</option><option value="event">Event name A-Z</option></select></div></div><div class="event-filter-actions"><button id="resetEventLogFiltersSheet" type="button">Reset</button><button id="applyEventLogFiltersSheet" class="primary" type="button">Apply</button></div></div>';
  sheet.querySelectorAll('[data-event-filter-close]').forEach(function(button){button.addEventListener('click',closeEventLogFilterSheet);});
  sheet.querySelector('#resetEventLogFiltersSheet').addEventListener('click',clearEventLogFilters);
  sheet.querySelector('#applyEventLogFiltersSheet').addEventListener('click',applyEventLogFilterSheet);
  document.body.appendChild(sheet);
}

function eventLogEventNames(){
  const seen={};
  return (appData.attendanceLog||[]).map(function(row){return cleanText(row.eventName);}).filter(function(name){const key=name.toLowerCase();if(!name||seen[key])return false;seen[key]=true;return true;}).sort(function(a,b){return a.localeCompare(b);});
}

function populateEventLogEventFilter(){
  const select=document.getElementById('eventLogEventFilterSheet');
  if(!select)return;
  const selected=eventLogEventFilter;
  select.innerHTML='<option value="">All events</option>'+eventLogEventNames().map(function(name){return '<option value="'+escapeHtml(name)+'">'+escapeHtml(name)+'</option>';}).join('');
  select.value=selected;
}

function syncEventLogFilterControls(){
  const primary=document.getElementById('eventLogAttendanceFilter');
  const sheetAttendance=document.getElementById('eventLogAttendanceFilterSheet');
  const sheetEvent=document.getElementById('eventLogEventFilterSheet');
  const sheetSort=document.getElementById('eventLogSortSheet');
  if(primary)primary.value=eventLogAttendanceFilter;
  if(sheetAttendance)sheetAttendance.value=eventLogAttendanceFilter;
  if(sheetEvent)sheetEvent.value=eventLogEventFilter;
  if(sheetSort)sheetSort.value=eventLogSort;
  updateEventLogFilterBadge();
}

function activeEventLogFilterCount(){
  return (eventLogAttendanceFilter?1:0)+(eventLogEventFilter?1:0);
}

function updateEventLogFilterBadge(){
  const badge=document.getElementById('eventLogFilterBadge');
  if(!badge)return;
  const count=activeEventLogFilterCount();
  badge.textContent=String(count);
  badge.classList.toggle('hidden',count===0);
}

function updateEventLogFloatingUi(){
  const fab=document.getElementById('eventLogFilterFab');
  if(fab)fab.classList.toggle('hidden',!eventLogViewIsActive());
  if(!eventLogViewIsActive())closeEventLogFilterSheet();
}

function openEventLogFilterSheet(){
  populateEventLogEventFilter();
  syncEventLogFilterControls();
  const sheet=document.getElementById('eventLogFilterSheet');
  const fab=document.getElementById('eventLogFilterFab');
  if(sheet)sheet.classList.remove('hidden');
  if(fab)fab.setAttribute('aria-expanded','true');
  document.body.classList.add('event-filter-open');
}

function closeEventLogFilterSheet(){
  const sheet=document.getElementById('eventLogFilterSheet');
  const fab=document.getElementById('eventLogFilterFab');
  if(sheet)sheet.classList.add('hidden');
  if(fab)fab.setAttribute('aria-expanded','false');
  document.body.classList.remove('event-filter-open');
}

function applyEventLogFilterSheet(){
  const attendance=document.getElementById('eventLogAttendanceFilterSheet');
  const event=document.getElementById('eventLogEventFilterSheet');
  const sort=document.getElementById('eventLogSortSheet');
  eventLogAttendanceFilter=attendance?attendance.value:'';
  eventLogEventFilter=event?event.value:'';
  eventLogSort=sort?sort.value:'newest';
  syncEventLogFilterControls();
  closeEventLogFilterSheet();
  renderEventLogEditor();
}

function clearEventLogFilters(){
  eventLogSearchQuery='';
  eventLogAttendanceFilter='';
  eventLogEventFilter='';
  eventLogSort='newest';
  const search=document.getElementById('eventLogSearch');
  if(search)search.value='';
  populateEventLogEventFilter();
  syncEventLogFilterControls();
  closeEventLogFilterSheet();
  renderEventLogEditor();
}

function getFilteredEventLogRows(){
  const rows=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  const filtered=rows.filter(function(row){
    const text=[row.name,row.email,row.contact,row.attendance,row.eventName,row.eventDate,durationHoursPart(row),durationMinutesPart(row),formatDuration(row)].join(' ').toLowerCase();
    const attendanceMatch=!eventLogAttendanceFilter||(eventLogAttendanceFilter==='yes'&&attendanceWasCaptured(row))||(eventLogAttendanceFilter==='blank'&&!attendanceWasCaptured(row));
    const eventMatch=!eventLogEventFilter||cleanText(row.eventName).toLowerCase()===eventLogEventFilter.toLowerCase();
    return(!eventLogSearchQuery||text.indexOf(eventLogSearchQuery)>-1)&&attendanceMatch&&eventMatch;
  });
  filtered.sort(function(a,b){
    if(eventLogSort==='name')return(a.name||'').localeCompare(b.name||'')||(b.eventDate||'').localeCompare(a.eventDate||'');
    if(eventLogSort==='event')return(a.eventName||'').localeCompare(b.eventName||'')||(b.eventDate||'').localeCompare(a.eventDate||'')||(a.name||'').localeCompare(b.name||'');
    return(b.eventDate||'').localeCompare(a.eventDate||'')||(a.name||'').localeCompare(b.name||'');
  });
  return filtered;
}

function renderEventLogSummary(rows,totalRows){
  const attended=(appData.attendanceLog||[]).filter(attendanceWasCaptured).length;
  const noShow=(appData.attendanceLog||[]).filter(function(row){return !attendanceWasCaptured(row);}).length;
  const totalMinutes=(appData.attendanceLog||[]).reduce(function(total,row){return total+(attendanceWasCaptured(row)?Number(row.durationMinutes)||0:0);},0);
  const visible=rows.length===totalRows?'':('<span class="event-summary-divider">·</span><strong>'+rows.length+'</strong> visible');
  return '<div class="event-log-summary-line"><span><strong>'+totalRows+'</strong> deployed</span><span class="event-summary-divider">·</span><span><strong>'+attended+'</strong> attended</span><span class="event-summary-divider">·</span><span><strong>'+noShow+'</strong> no-show</span><span class="event-summary-divider">·</span><span><strong>'+escapeHtml(formatDuration({durationMinutes:totalMinutes}))+'</strong> total</span>'+visible+'</div>';
}

function eventLogAttendanceSelect(row,compact){
  const cls=compact?'event-card-status '+(attendanceWasCaptured(row)?'is-attended':'is-pending'):'';
  return '<select class="'+cls+'" aria-label="Attendance for '+escapeHtml(row.name||'event row')+'" onchange="editEventLogField(\''+row.id+'\',\'attendance\',this.value,this);commitEventLogEdit(true)"><option value="" '+(attendanceWasCaptured(row)?'':'selected')+'>No-show</option><option value="yes" '+(attendanceWasCaptured(row)?'selected':'')+'>Present</option></select>';
}

function renderEventLogDesktopTable(rows){
  let html='<div class="event-log-desktop"><table><thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Attendance</th><th>Event Name</th><th>Event Date</th><th>Hours</th><th>Minutes</th><th>Duration</th><th></th></tr></thead><tbody>';
  rows.forEach(function(row){
    html+='<tr data-event-log-row="'+escapeHtml(row.id)+'">'+
      '<td><input maxlength="500" value="'+escapeHtml(row.name)+'" oninput="editEventLogField(\''+row.id+'\',\'name\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.email)+'" oninput="editEventLogField(\''+row.id+'\',\'email\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.contact)+'" oninput="editEventLogField(\''+row.id+'\',\'contact\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td>'+eventLogAttendanceSelect(row,false)+'</td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventName)+'" oninput="editEventLogField(\''+row.id+'\',\'eventName\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input maxlength="500" value="'+escapeHtml(row.eventDate)+'" oninput="editEventLogField(\''+row.id+'\',\'eventDate\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input type="number" min="0" max="100" step="1" value="'+escapeHtml(durationHoursPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'hours\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td><input type="number" min="0" max="59" step="1" value="'+escapeHtml(durationMinutesPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'minutes\',this.value,this)" onblur="commitEventLogEdit()"></td>'+
      '<td data-duration-for="'+escapeHtml(row.id)+'">'+escapeHtml(formatDuration(row))+'</td>'+
      '<td><button class="small danger" onclick="deleteEventLogRow(\''+row.id+'\')">Delete</button></td>'+
    '</tr>';
  });
  return html+'</tbody></table></div>';
}

function renderEventLogMobileCards(rows){
  let html='<div class="event-log-mobile">';
  rows.forEach(function(row){
    html+='<article class="event-log-card" data-event-log-card="'+escapeHtml(row.id)+'"><div class="event-log-card-top"><div class="event-log-card-copy"><strong class="event-log-card-name">'+escapeHtml(row.name||'Unnamed volunteer')+'</strong><span>'+escapeHtml(row.eventName||'No event name')+(row.eventDate?' · '+escapeHtml(row.eventDate):'')+'</span><span class="muted">'+escapeHtml(formatDuration(row))+(row.email?' · '+escapeHtml(row.email):'')+'</span></div>'+eventLogAttendanceSelect(row,true)+'</div><details><summary>Edit details</summary><div class="event-log-card-fields"><label>Name<input maxlength="500" value="'+escapeHtml(row.name)+'" oninput="editEventLogField(\''+row.id+'\',\'name\',this.value,this)" onblur="commitEventLogEdit()"></label><label>Email<input maxlength="500" value="'+escapeHtml(row.email)+'" oninput="editEventLogField(\''+row.id+'\',\'email\',this.value,this)" onblur="commitEventLogEdit()"></label><label>Contact<input maxlength="500" value="'+escapeHtml(row.contact)+'" oninput="editEventLogField(\''+row.id+'\',\'contact\',this.value,this)" onblur="commitEventLogEdit()"></label><label>Event<input maxlength="500" value="'+escapeHtml(row.eventName)+'" oninput="editEventLogField(\''+row.id+'\',\'eventName\',this.value,this)" onblur="commitEventLogEdit()"></label><label>Date<input type="date" value="'+escapeHtml(row.eventDate)+'" oninput="editEventLogField(\''+row.id+'\',\'eventDate\',this.value,this)" onblur="commitEventLogEdit()"></label><div class="event-duration-fields"><label>Hours<input type="number" min="0" max="100" step="1" value="'+escapeHtml(durationHoursPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'hours\',this.value,this)" onblur="commitEventLogEdit()"></label><label>Minutes<input type="number" min="0" max="59" step="1" value="'+escapeHtml(durationMinutesPart(row))+'" oninput="editEventLogField(\''+row.id+'\',\'minutes\',this.value,this)" onblur="commitEventLogEdit()"></label></div><button class="small danger event-card-delete" onclick="deleteEventLogRow(\''+row.id+'\')">Delete row</button></div></details></article>';
  });
  return html+'</div>';
}

function renderEventLogEditor(){
  installEventLogControls();
  const target=document.getElementById('eventLogTable');
  const summary=document.getElementById('eventLogSummary');
  if(!target||!summary)return;
  appData.attendanceLog=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
  const rows=getFilteredEventLogRows();
  summary.innerHTML=renderEventLogSummary(rows,appData.attendanceLog.length);
  populateEventLogEventFilter();
  syncEventLogFilterControls();
  updateEventLogFloatingUi();
  if(!rows.length){target.innerHTML='<p class="muted event-log-empty">No event log rows match the current filters.</p>';return;}
  target.innerHTML=renderEventLogDesktopTable(rows)+renderEventLogMobileCards(rows);
}

function getEventLogRow(id){return(appData.attendanceLog||[]).find(function(row){return row.id===id;});}

function updateEventLogRowDurationCell(id){
  const row=getEventLogRow(id);
  const cell=document.querySelector('[data-duration-for="'+CSS.escape(id)+'"]');
  if(row&&cell)cell.textContent=formatDuration(row);
  const card=document.querySelector('[data-event-log-card="'+CSS.escape(id)+'"]');
  if(row&&card){const duration=card.querySelector('.event-log-card-copy .muted');if(duration)duration.textContent=formatDuration(row)+(row.email?' · '+row.email:'');}
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
  window.scrollTo({top:document.getElementById('eventLogView').offsetTop-70,behavior:'smooth'});
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
renderAll=function(){originalRenderAllForEventLogEditor();installEventLogControls();renderEventLogEditor();updateEventLogFloatingUi();};

document.addEventListener('DOMContentLoaded',function(){installEventLogControls();renderEventLogEditor();});
