(function installEventManagement(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const state={events:[],shifts:[],metrics:[],attendance:[],selected:new Set(),activeEventId:'',loaded:false,loading:false};
  const MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};

  function esc(value){return typeof escapeHtml==='function'?escapeHtml(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function text(value){return String(value==null?'':value).trim();}
  function iso(value){return text(value).slice(0,10);}
  function id(prefix){return typeof makeId==='function'?makeId(prefix):prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
  function canWrite(){return !!(S.getAccessState&&S.getAccessState().canWrite);}
  function canDelete(){return !!(S.getAccessState&&S.getAccessState().canDelete);}
  function fmtDate(value){const d=iso(value);if(!d)return'—';const p=d.split('-');return p.length===3?p[2]+' '+new Date(Number(p[0]),Number(p[1])-1,1).toLocaleString('en-SG',{month:'short'})+' '+p[0]:d;}
  function fmtRange(event){return event.start_date===event.end_date?fmtDate(event.start_date):fmtDate(event.start_date)+' – '+fmtDate(event.end_date);}
  function daysBetween(a,b){const x=new Date(a+'T00:00:00Z'),y=new Date(b+'T00:00:00Z');return Math.round((y-x)/86400000);}

  async function fetchRows(table,select,order){
    const path='/rest/v1/'+table+'?select='+encodeURIComponent(select||'*')+(order?'&order='+encodeURIComponent(order):'');
    const response=await S.apiFetch(path,{method:'GET'});
    if(!response.ok)throw new Error('Could not load '+table+': '+await response.text());
    return response.json();
  }
  async function loadAll(force){
    if(state.loading)return;
    const access=S.getAccessState&&S.getAccessState();
    if(!access||!access.ready){renderAccessWait();return;}
    if(state.loaded&&!force){renderAllEventUi();return;}
    state.loading=true;
    try{
      const rows=await Promise.all([
        fetchRows('events','*','start_date.desc,name.asc'),
        fetchRows('event_shifts','*','shift_date.asc,name.asc'),
        fetchRows('event_impact_metrics','*','label.asc'),
        fetchRows('attendance_log','id,name,email,contact,attended,event_name,event_date,duration_minutes,event_id,shift_id,row_version','event_date.desc')
      ]);
      state.events=rows[0];state.shifts=rows[1];state.metrics=rows[2];state.attendance=rows[3];state.loaded=true;
      if(state.activeEventId&&!state.events.some(function(e){return e.id===state.activeEventId;}))state.activeEventId='';
      renderAllEventUi();
    }catch(error){console.error(error);renderError(error.message);}
    finally{state.loading=false;}
  }

  function injectShell(){
    const nav=document.querySelector('nav');
    if(nav&&!document.querySelector('nav button[data-view="eventsView"]')){
      const dashboardButton=nav.querySelector('button[data-view="dashboardView"]');
      const button=document.createElement('button');button.type='button';button.dataset.view='eventsView';button.textContent='Events';
      if(dashboardButton)nav.insertBefore(button,dashboardButton);else nav.appendChild(button);
      button.addEventListener('click',function(){showView('eventsView');loadAll(true);});
    }
    const main=document.querySelector('main');
    if(main&&!document.getElementById('eventsView')){
      const section=document.createElement('section');section.id='eventsView';section.className='view';
      section.innerHTML='<div id="eventManagerStatus"></div><div id="eventManagerContent"></div>';
      const dashboard=document.getElementById('dashboardView');if(dashboard)main.insertBefore(section,dashboard);else main.appendChild(section);
    }
    ensureBatchToolbar();
  }

  function renderAccessWait(){const target=document.getElementById('eventManagerContent');if(target)target.innerHTML='<div class="card"><p class="muted">Sign in to load structured events and shifts.</p></div>';}
  function renderError(message){const target=document.getElementById('eventManagerStatus');if(target)target.innerHTML='<div class="notice bad">'+esc(message)+'</div>';}
  function clearStatus(){const target=document.getElementById('eventManagerStatus');if(target)target.innerHTML='';}

  function eventStats(eventId){
    const rows=state.attendance.filter(function(r){return r.event_id===eventId;});
    const attended=rows.filter(function(r){return r.attended;});
    const volunteers=new Set(attended.map(function(r){return text(r.email).toLowerCase()||text(r.contact).replace(/\D/g,'')||text(r.name).toLowerCase();}).filter(Boolean));
    const minutes=attended.reduce(function(t,r){return t+(Number(r.duration_minutes)||0);},0);
    return{rows:rows.length,attended:attended.length,volunteers:volunteers.size,minutes:minutes,shifts:state.shifts.filter(function(s){return s.event_id===eventId;}).length};
  }
  function migrationCandidates(){
    const groups={};
    state.attendance.filter(function(r){return !r.event_id;}).forEach(function(row){const name=text(row.event_name)||'Unnamed event';if(!groups[name])groups[name]={name:name,dates:{},rows:0};groups[name].rows++;groups[name].dates[iso(row.event_date)]=(groups[name].dates[iso(row.event_date)]||0)+1;});
    return Object.keys(groups).map(function(name){const g=groups[name],dates=Object.keys(g.dates).filter(Boolean).sort();g.dateList=dates;g.start=dates[0]||'';g.end=dates[dates.length-1]||'';g.span=g.start&&g.end?daysBetween(g.start,g.end):0;return g;}).sort(function(a,b){return(b.end||'').localeCompare(a.end||'')||a.name.localeCompare(b.name);});
  }
  function namedDate(name){
    const match=text(name).toLowerCase().match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/);
    if(!match)return'';const month=MONTHS[match[2]];if(!month)return'';return match[3]+'-'+String(month).padStart(2,'0')+'-'+String(Number(match[1])).padStart(2,'0');
  }
  function dateIssues(){
    const out=[];
    const grouped={};
    state.attendance.forEach(function(row){const expected=namedDate(row.event_name);if(expected&&expected!==iso(row.event_date)){const key=row.event_name+'|'+row.event_date+'|'+expected;if(!grouped[key])grouped[key]={eventName:row.event_name,current:iso(row.event_date),expected:expected,ids:[]};grouped[key].ids.push(row.id);}});
    Object.keys(grouped).forEach(function(k){out.push(grouped[k]);});return out.sort(function(a,b){return b.ids.length-a.ids.length;});
  }

  function renderManager(){
    const target=document.getElementById('eventManagerContent');if(!target||!state.loaded)return;
    const assigned=state.attendance.filter(function(r){return r.event_id;}).length;
    const unassigned=state.attendance.length-assigned;
    const issues=dateIssues();
    target.innerHTML=[
      '<div class="card"><div class="event-manager-head"><div><h2>Events & Shifts</h2><p class="muted">One event can span several days and contain multiple shifts. Attendance rows remain the deployment records.</p></div>',canWrite()?'<button id="newStructuredEvent" class="primary" type="button">+ New event</button>':'','</div>',
      '<div class="event-manager-kpis"><div class="event-manager-kpi"><span>Events</span><strong>'+state.events.length+'</strong></div><div class="event-manager-kpi"><span>Shifts</span><strong>'+state.shifts.length+'</strong></div><div class="event-manager-kpi"><span>Assigned rows</span><strong>'+assigned+'</strong></div><div class="event-manager-kpi"><span>Unassigned rows</span><strong>'+unassigned+'</strong></div><div class="event-manager-kpi"><span>Date issues</span><strong>'+issues.length+'</strong></div></div></div>',
      '<div id="eventCreatePanel"></div>',
      renderEventList(),
      '<div id="eventDetailPanel">'+(state.activeEventId?renderEventDetail(state.activeEventId):'')+'</div>',
      renderDateIssues(issues),
      renderMigrationCandidates()
    ].join('');
    wireManager();
  }

  function renderEventList(){
    if(!state.events.length)return'<div class="card"><h3>Structured events</h3><p class="event-empty">No structured events yet. Create one, then assign existing Event Log rows to its shifts.</p></div>';
    return'<div class="card"><h3>Structured events</h3><div class="event-list">'+state.events.map(function(e){const s=eventStats(e.id);return'<div class="event-row"><div><div class="event-row-title">'+esc(e.name)+'</div><div class="event-row-meta">'+esc(fmtRange(e))+(e.venue?' · '+esc(e.venue):'')+'</div></div><div class="event-row-meta">'+s.shifts+' shift'+(s.shifts===1?'':'s')+' · '+s.rows+' deployments · '+s.attended+' attended</div><div><button type="button" class="small" data-open-event="'+esc(e.id)+'">Manage</button></div></div>';}).join('')+'</div></div>';
  }

  function renderEventDetail(eventId){
    const e=state.events.find(function(x){return x.id===eventId;});if(!e)return'';
    const shifts=state.shifts.filter(function(x){return x.event_id===eventId;});const metrics=state.metrics.filter(function(x){return x.event_id===eventId;});const s=eventStats(eventId);
    return'<div class="card"><div class="event-manager-head"><div><h3>'+esc(e.name)+'</h3><p class="muted">'+esc(fmtRange(e))+' · '+s.rows+' deployments · '+s.volunteers+' unique attending volunteers · '+(Math.round((s.minutes/60)*10)/10)+' hours</p></div><button type="button" class="small" id="closeEventDetail">Close</button></div>'+
      '<div class="event-detail-grid"><label>Name<input id="eventEditName" maxlength="500" value="'+esc(e.name)+'" '+(canWrite()?'':'disabled')+'></label><label>Start date<input id="eventEditStart" type="date" value="'+esc(e.start_date)+'" '+(canWrite()?'':'disabled')+'></label><label>End date<input id="eventEditEnd" type="date" value="'+esc(e.end_date)+'" '+(canWrite()?'':'disabled')+'></label><label>Programme / category<input id="eventEditProgramme" maxlength="500" value="'+esc(e.programme||'')+'" '+(canWrite()?'':'disabled')+'></label><label>Venue<input id="eventEditVenue" maxlength="500" value="'+esc(e.venue||'')+'" '+(canWrite()?'':'disabled')+'></label><label>Notes<input id="eventEditNotes" maxlength="2000" value="'+esc(e.notes||'')+'" '+(canWrite()?'':'disabled')+'></label></div>'+
      (canWrite()?'<div class="row"><button id="saveStructuredEvent" type="button" class="primary">Save event</button>'+(canDelete()?'<button id="deleteStructuredEvent" type="button" class="danger">Delete event</button>':'')+'</div>':'')+
      '<div class="event-subsection"><h4>Shifts</h4>'+(shifts.length?shifts.map(renderShiftRow).join(''):'<p class="muted">No shifts yet.</p>')+(canWrite()?renderAddShift(eventId):'')+'</div>'+
      '<div class="event-subsection"><h4>Impact metrics</h4><p class="muted">Record event-specific outputs such as people reached, bundles packed, meals distributed, or waste collected.</p>'+(metrics.length?metrics.map(renderMetricRow).join(''):'<p class="muted">No impact metrics recorded.</p>')+(canWrite()?renderAddMetric(eventId):'')+'</div></div>';
  }
  function renderShiftRow(shift){return'<div class="event-shift-row"><div><strong>'+esc(shift.name)+'</strong><div class="muted">'+esc(fmtDate(shift.shift_date))+(shift.start_time?' · '+esc(String(shift.start_time).slice(0,5)):'')+(shift.end_time?'–'+esc(String(shift.end_time).slice(0,5)):'')+'</div></div><div class="muted">'+state.attendance.filter(function(r){return r.shift_id===shift.id;}).length+' rows</div>'+(canWrite()?'<div class="event-inline-actions"><button type="button" class="small" data-edit-shift="'+esc(shift.id)+'">Edit</button>'+(canDelete()?'<button type="button" class="small danger" data-delete-shift="'+esc(shift.id)+'">Delete</button>':'')+'</div>':'<div></div>')+'</div>';}
  function renderAddShift(eventId){return'<div class="grid"><label>Shift name<input id="newShiftName" placeholder="e.g. AM, PM, Full Day"></label><label>Date<input id="newShiftDate" type="date"></label><label>Start time<input id="newShiftStart" type="time"></label><label>End time<input id="newShiftEnd" type="time"></label></div><div class="row"><button id="addStructuredShift" type="button">Add shift</button></div>';}
  function renderMetricRow(metric){return'<div class="event-impact-row"><div><strong>'+esc(metric.label)+'</strong></div><div>'+esc(metric.value)+' '+esc(metric.unit||'')+'</div>'+(canWrite()?'<div class="event-inline-actions"><button type="button" class="small" data-edit-metric="'+esc(metric.id)+'">Edit</button>'+(canDelete()?'<button type="button" class="small danger" data-delete-metric="'+esc(metric.id)+'">Delete</button>':'')+'</div>':'<div></div>')+'</div>';}
  function renderAddMetric(){return'<div class="grid"><label>Metric<label><input id="newImpactLabel" placeholder="e.g. People reached"></label><label>Value<input id="newImpactValue" type="number" min="0" step="any"></label><label>Unit<input id="newImpactUnit" placeholder="e.g. people, kg, bundles"></label></div><div class="row"><button id="addImpactMetric" type="button">Add impact metric</button></div>';}

  function renderDateIssues(issues){
    if(!issues.length)return'<div class="card"><h3>Data issues</h3><p class="muted">No event-name/date mismatches detected.</p></div>';
    return'<div class="card"><h3>Data issues <span class="pill warn">'+issues.length+'</span></h3><p class="muted">MakLom found dates written in event names that conflict with the stored event date. Review before correcting.</p>'+issues.map(function(issue){return'<div class="event-issue-row event-data-issue"><div><strong>'+esc(issue.eventName)+'</strong><div class="muted">Stored '+esc(fmtDate(issue.current))+' · name suggests '+esc(fmtDate(issue.expected))+'</div></div><div>'+issue.ids.length+' row'+(issue.ids.length===1?'':'s')+'</div>'+(canWrite()?'<div><button type="button" class="small" data-fix-date="'+esc(issue.expected)+'" data-fix-ids="'+esc(issue.ids.join(','))+'">Correct rows</button></div>':'<div></div>')+'</div>';}).join('')+'</div>';
  }
  function renderMigrationCandidates(){
    const groups=migrationCandidates();if(!groups.length)return'<div class="card"><h3>Unassigned Event Log groups</h3><p class="muted">All current Event Log rows are assigned to structured events.</p></div>';
    return'<div class="card"><h3>Unassigned Event Log groups</h3><p class="muted">These are candidates only. A long date span may indicate a recurring programme rather than one multi-day event.</p>'+groups.slice(0,100).map(function(g){const warning=g.span>14?' · review recurring dates':'';return'<div class="event-candidate-row"><div><strong>'+esc(g.name)+'</strong><div class="muted">'+g.dateList.length+' date'+(g.dateList.length===1?'':'s')+' · '+esc(g.start?fmtDate(g.start):'no date')+(g.end&&g.end!==g.start?' to '+esc(fmtDate(g.end)):'')+esc(warning)+'</div></div><div>'+g.rows+' rows</div>'+(canWrite()?'<div><button type="button" class="small" data-candidate-name="'+esc(g.name)+'" data-candidate-start="'+esc(g.start)+'" data-candidate-end="'+esc(g.end)+'">Create event</button></div>':'<div></div>')+'</div>';}).join('')+'</div>';
  }

  function renderCreatePanel(seed){
    const target=document.getElementById('eventCreatePanel');if(!target)return;const draft=seed||{};
    target.innerHTML='<div class="card"><div class="event-manager-head"><div><h3>Create event</h3><p class="muted">For recurring programmes, create a separate event occurrence where appropriate rather than using the full programme date span.</p></div><button id="cancelNewStructuredEvent" type="button" class="small">Cancel</button></div><div class="event-detail-grid"><label>Name<input id="createEventName" maxlength="500" value="'+esc(draft.name||'')+'"></label><label>Start date<input id="createEventStart" type="date" value="'+esc(draft.start||'')+'"></label><label>End date<input id="createEventEnd" type="date" value="'+esc(draft.end||draft.start||'')+'"></label><label>Programme / category<input id="createEventProgramme" maxlength="500"></label><label>Venue<input id="createEventVenue" maxlength="500"></label><label>Notes<input id="createEventNotes" maxlength="2000"></label></div><div class="row"><button id="confirmNewStructuredEvent" class="primary" type="button">Create event</button></div></div>';
    document.getElementById('cancelNewStructuredEvent').addEventListener('click',function(){target.innerHTML='';});
    document.getElementById('confirmNewStructuredEvent').addEventListener('click',createEventFromPanel);
    target.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function apiInsert(table,row){const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});if(!response.ok)throw new Error(await response.text());const rows=await response.json();return rows[0];}
  async function apiUpdate(table,row,version){const response=await S.apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});if(!response.ok)throw new Error(await response.text());const rows=await response.json();if(!rows.length)throw new Error('This record changed in another browser. Reload and try again.');return rows[0];}
  async function apiDelete(table,row){const response=await S.apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'DELETE',headers:{Prefer:'return=representation'}});if(!response.ok)throw new Error(await response.text());const rows=await response.json();if(!rows.length)throw new Error('This record changed in another browser. Reload and try again.');}

  async function createEventFromPanel(){
    const name=text(document.getElementById('createEventName').value),start=iso(document.getElementById('createEventStart').value),end=iso(document.getElementById('createEventEnd').value||start);if(!name||!start||!end){alert('Event name, start date and end date are required.');return;}if(end<start){alert('End date cannot be before start date.');return;}
    try{const created=await apiInsert('events',{id:id('event'),name:name,start_date:start,end_date:end,programme:text(document.getElementById('createEventProgramme').value)||null,venue:text(document.getElementById('createEventVenue').value)||null,notes:text(document.getElementById('createEventNotes').value)||null,status:'active'});if(start===end)await apiInsert('event_shifts',{id:id('shift'),event_id:created.id,name:'General',shift_date:start,start_time:null,end_time:null,notes:null});state.activeEventId=created.id;await loadAll(true);}catch(error){alert('Could not create event: '+error.message);}
  }
  async function saveActiveEvent(){const e=state.events.find(function(x){return x.id===state.activeEventId;});if(!e)return;const name=text(document.getElementById('eventEditName').value),start=iso(document.getElementById('eventEditStart').value),end=iso(document.getElementById('eventEditEnd').value);if(!name||!start||!end||end<start){alert('Enter a valid event name and date range.');return;}try{await apiUpdate('events',{id:e.id,name:name,start_date:start,end_date:end,programme:text(document.getElementById('eventEditProgramme').value)||null,venue:text(document.getElementById('eventEditVenue').value)||null,notes:text(document.getElementById('eventEditNotes').value)||null,status:e.status||'active'},e.row_version);await loadAll(true);}catch(error){alert('Could not save event: '+error.message);}}
  async function addShift(){const eventId=state.activeEventId,name=text(document.getElementById('newShiftName').value),date=iso(document.getElementById('newShiftDate').value);if(!name||!date){alert('Shift name and date are required.');return;}try{await apiInsert('event_shifts',{id:id('shift'),event_id:eventId,name:name,shift_date:date,start_time:text(document.getElementById('newShiftStart').value)||null,end_time:text(document.getElementById('newShiftEnd').value)||null,notes:null});await loadAll(true);}catch(error){alert('Could not add shift: '+error.message);}}
  async function editShift(shiftId){const shift=state.shifts.find(function(x){return x.id===shiftId;});if(!shift)return;const name=prompt('Shift name',shift.name);if(name==null)return;const date=prompt('Shift date (YYYY-MM-DD)',shift.shift_date);if(date==null)return;try{await apiUpdate('event_shifts',{id:shift.id,event_id:shift.event_id,name:text(name),shift_date:iso(date),start_time:shift.start_time,end_time:shift.end_time,notes:shift.notes},shift.row_version);await loadAll(true);}catch(error){alert('Could not edit shift: '+error.message);}}
  async function addMetric(){const label=text(document.getElementById('newImpactLabel').value),value=Number(document.getElementById('newImpactValue').value),unit=text(document.getElementById('newImpactUnit').value);if(!label||!Number.isFinite(value)||value<0){alert('Metric label and a value of 0 or more are required.');return;}try{await apiInsert('event_impact_metrics',{id:id('impact'),event_id:state.activeEventId,label:label,value:value,unit:unit||null});await loadAll(true);}catch(error){alert('Could not add impact metric: '+error.message);}}
  async function editMetric(metricId){const metric=state.metrics.find(function(x){return x.id===metricId;});if(!metric)return;const label=prompt('Metric label',metric.label);if(label==null)return;const raw=prompt('Value',metric.value);if(raw==null)return;const unit=prompt('Unit',metric.unit||'');if(unit==null)return;const value=Number(raw);if(!text(label)||!Number.isFinite(value)||value<0){alert('Enter a valid label and value.');return;}try{await apiUpdate('event_impact_metrics',{id:metric.id,event_id:metric.event_id,label:text(label),value:value,unit:text(unit)||null},metric.row_version);await loadAll(true);}catch(error){alert('Could not edit impact metric: '+error.message);}}
  async function deleteRecord(table,row,label){if(!confirm('Delete '+label+'?'))return;try{await apiDelete(table,row);if(table==='events')state.activeEventId='';await loadAll(true);}catch(error){alert('Could not delete '+label+': '+error.message);}}

  async function patchAttendance(ids,changes){
    const rows=state.attendance.filter(function(r){return ids.indexOf(r.id)>-1;});if(!rows.length)return;
    for(const row of rows){const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(changes)});if(!response.ok)throw new Error(await response.text());const result=await response.json();if(!result.length)throw new Error('A selected Event Log row changed in another browser. Reload and retry.');}
    state.selected.clear();state.loaded=false;if(S.refreshFromRemote)await S.refreshFromRemote(true,true);await loadAll(true);if(typeof renderEventLogEditor==='function')renderEventLogEditor();
  }
  async function fixIssue(button){const ids=text(button.dataset.fixIds).split(',').filter(Boolean),date=iso(button.dataset.fixDate);if(!confirm('Change '+ids.length+' Event Log row'+(ids.length===1?'':'s')+' to '+date+'?'))return;try{await patchAttendance(ids,{event_date:date});}catch(error){alert('Could not correct rows: '+error.message);}}

  function wireManager(){
    clearStatus();const newButton=document.getElementById('newStructuredEvent');if(newButton)newButton.addEventListener('click',function(){renderCreatePanel();});
    document.querySelectorAll('[data-open-event]').forEach(function(b){b.addEventListener('click',function(){state.activeEventId=b.dataset.openEvent;renderManager();document.getElementById('eventDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});});});
    document.querySelectorAll('[data-candidate-name]').forEach(function(b){b.addEventListener('click',function(){renderCreatePanel({name:b.dataset.candidateName,start:b.dataset.candidateStart,end:b.dataset.candidateEnd});});});
    document.querySelectorAll('[data-fix-date]').forEach(function(b){b.addEventListener('click',function(){fixIssue(b);});});
    const close=document.getElementById('closeEventDetail');if(close)close.addEventListener('click',function(){state.activeEventId='';renderManager();});
    const save=document.getElementById('saveStructuredEvent');if(save)save.addEventListener('click',saveActiveEvent);
    const del=document.getElementById('deleteStructuredEvent');if(del)del.addEventListener('click',function(){const e=state.events.find(function(x){return x.id===state.activeEventId;});if(e)deleteRecord('events',e,'event');});
    const addS=document.getElementById('addStructuredShift');if(addS)addS.addEventListener('click',addShift);
    document.querySelectorAll('[data-edit-shift]').forEach(function(b){b.addEventListener('click',function(){editShift(b.dataset.editShift);});});
    document.querySelectorAll('[data-delete-shift]').forEach(function(b){b.addEventListener('click',function(){const x=state.shifts.find(function(s){return s.id===b.dataset.deleteShift;});if(x)deleteRecord('event_shifts',x,'shift');});});
    const addM=document.getElementById('addImpactMetric');if(addM)addM.addEventListener('click',addMetric);
    document.querySelectorAll('[data-edit-metric]').forEach(function(b){b.addEventListener('click',function(){editMetric(b.dataset.editMetric);});});
    document.querySelectorAll('[data-delete-metric]').forEach(function(b){b.addEventListener('click',function(){const x=state.metrics.find(function(m){return m.id===b.dataset.deleteMetric;});if(x)deleteRecord('event_impact_metrics',x,'impact metric');});});
  }

  function ensureBatchToolbar(){
    const view=document.getElementById('eventLogView');if(!view||document.getElementById('eventBatchToolbar'))return;
    const toolbar=document.createElement('div');toolbar.id='eventBatchToolbar';toolbar.className='event-batch-toolbar hidden';
    toolbar.innerHTML='<div><label>Selected</label><strong id="eventBatchCount">0 rows</strong></div><div><label for="eventBatchEvent">Event</label><select id="eventBatchEvent"><option value="">Choose event</option></select></div><div><label for="eventBatchShift">Shift</label><select id="eventBatchShift"><option value="">Choose shift</option></select></div><div><button id="applyEventBatchAssignment" type="button" class="primary">Assign event / shift</button></div><div><label for="eventBatchDate">Correct date</label><input id="eventBatchDate" type="date"></div><div><button id="applyEventBatchDate" type="button">Change date</button></div><div><button id="clearEventBatchSelection" type="button">Clear</button></div>';
    const firstCard=view.querySelector('.card');if(firstCard)firstCard.insertAdjacentElement('afterend',toolbar);
    document.getElementById('eventBatchEvent').addEventListener('change',populateBatchShifts);
    document.getElementById('applyEventBatchAssignment').addEventListener('click',applyBatchAssignment);
    document.getElementById('applyEventBatchDate').addEventListener('click',applyBatchDate);
    document.getElementById('clearEventBatchSelection').addEventListener('click',function(){state.selected.clear();decorateEventLog();updateBatchToolbar();});
  }
  function updateBatchToolbar(){const toolbar=document.getElementById('eventBatchToolbar');if(!toolbar)return;toolbar.classList.toggle('hidden',state.selected.size===0);const count=document.getElementById('eventBatchCount');if(count)count.textContent=state.selected.size+' row'+(state.selected.size===1?'':'s');populateBatchEvents();}
  function populateBatchEvents(){const select=document.getElementById('eventBatchEvent');if(!select)return;const current=select.value;select.innerHTML='<option value="">Choose event</option>'+state.events.map(function(e){return'<option value="'+esc(e.id)+'">'+esc(e.name)+' · '+esc(fmtRange(e))+'</option>';}).join('');select.value=state.events.some(function(e){return e.id===current;})?current:'';populateBatchShifts();}
  function populateBatchShifts(){const eventId=(document.getElementById('eventBatchEvent')||{}).value||'',select=document.getElementById('eventBatchShift');if(!select)return;const current=select.value;const shifts=state.shifts.filter(function(s){return s.event_id===eventId;});select.innerHTML='<option value="">Choose shift</option>'+shifts.map(function(s){return'<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(fmtDate(s.shift_date))+'</option>';}).join('');select.value=shifts.some(function(s){return s.id===current;})?current:'';}
  async function applyBatchAssignment(){const eventId=document.getElementById('eventBatchEvent').value,shiftId=document.getElementById('eventBatchShift').value;if(!eventId){alert('Choose an event.');return;}const event=state.events.find(function(e){return e.id===eventId;}),shift=state.shifts.find(function(s){return s.id===shiftId;});if(!event){alert('Event not found.');return;}const changes={event_id:event.id,shift_id:shift?shift.id:null,event_name:event.name};if(shift)changes.event_date=shift.shift_date;if(!confirm('Assign '+state.selected.size+' selected row'+(state.selected.size===1?'':'s')+' to '+event.name+(shift?' / '+shift.name:'')+'?'))return;try{await patchAttendance(Array.from(state.selected),changes);}catch(error){alert('Could not assign rows: '+error.message);}}
  async function applyBatchDate(){const date=iso(document.getElementById('eventBatchDate').value);if(!date){alert('Choose a date.');return;}if(!confirm('Change the date on '+state.selected.size+' selected row'+(state.selected.size===1?'':'s')+' to '+date+'?'))return;try{await patchAttendance(Array.from(state.selected),{event_date:date});}catch(error){alert('Could not change date: '+error.message);}}

  function decorateEventLog(){
    ensureBatchToolbar();
    document.querySelectorAll('.event-log-desktop table').forEach(function(table){const head=table.querySelector('thead tr');if(head&&!head.querySelector('.event-select-cell')){const th=document.createElement('th');th.className='event-select-cell';th.innerHTML='<input type="checkbox" aria-label="Select all visible Event Log rows">';head.insertBefore(th,head.firstChild);th.querySelector('input').addEventListener('change',function(e){document.querySelectorAll('.event-log-desktop tbody tr[data-event-log-row]').forEach(function(tr){const rid=tr.dataset.eventLogRow;if(e.target.checked)state.selected.add(rid);else state.selected.delete(rid);});decorateEventLog();updateBatchToolbar();});}
      table.querySelectorAll('tbody tr[data-event-log-row]').forEach(function(tr){if(tr.querySelector('.event-select-cell'))return;const td=document.createElement('td');td.className='event-select-cell';const box=document.createElement('input');box.type='checkbox';box.checked=state.selected.has(tr.dataset.eventLogRow);box.setAttribute('aria-label','Select Event Log row');box.addEventListener('change',function(){if(box.checked)state.selected.add(tr.dataset.eventLogRow);else state.selected.delete(tr.dataset.eventLogRow);updateBatchToolbar();syncSelectionCopies(tr.dataset.eventLogRow,box.checked);});td.appendChild(box);tr.insertBefore(td,tr.firstChild);});
    });
    document.querySelectorAll('.event-log-card[data-event-log-card]').forEach(function(card){card.classList.add('has-event-select');if(card.querySelector('.event-select-mobile'))return;const box=document.createElement('input');box.type='checkbox';box.className='event-select-mobile';box.checked=state.selected.has(card.dataset.eventLogCard);box.setAttribute('aria-label','Select Event Log row');box.addEventListener('change',function(){if(box.checked)state.selected.add(card.dataset.eventLogCard);else state.selected.delete(card.dataset.eventLogCard);updateBatchToolbar();syncSelectionCopies(card.dataset.eventLogCard,box.checked);});card.appendChild(box);});
    updateBatchToolbar();
  }
  function syncSelectionCopies(idValue,checked){document.querySelectorAll('[data-event-log-row="'+CSS.escape(idValue)+'"] .event-select-cell input,[data-event-log-card="'+CSS.escape(idValue)+'"] .event-select-mobile').forEach(function(box){box.checked=checked;});}

  function renderDashboardImpact(){
    const root=document.getElementById('dashboardContent');if(!root||!state.loaded)return;let section=document.getElementById('dashboardEventImpact');if(section)section.remove();
    const assigned=state.attendance.filter(function(r){return r.event_id;});const attended=assigned.filter(function(r){return r.attended;});const minutes=attended.reduce(function(t,r){return t+(Number(r.duration_minutes)||0);},0);
    const totals={};state.metrics.forEach(function(m){const key=text(m.label).toLowerCase()+'|'+text(m.unit).toLowerCase();if(!totals[key])totals[key]={label:m.label,unit:m.unit||'',value:0};totals[key].value+=Number(m.value)||0;});
    const chips=Object.keys(totals).sort().map(function(k){const m=totals[k];return'<span class="event-impact-chip"><strong>'+esc(m.value)+'</strong> '+esc(m.label)+(m.unit?' ('+esc(m.unit)+')':'')+'</span>';}).join('');
    section=document.createElement('div');section.id='dashboardEventImpact';section.innerHTML='<div class="card"><h2>Event & Impact Overview</h2><p class="muted">Structured events count real-world event occurrences; shifts are operational time blocks; deployments remain individual Event Log rows.</p><div class="dashboard-kpis">'+renderMetricCard('Events',String(state.events.length),'structured event occurrences')+renderMetricCard('Shifts',String(state.shifts.length),'structured event shifts')+renderMetricCard('Assigned Deployments',String(assigned.length),'event log rows linked to events')+renderMetricCard('Assigned Volunteer Hours',String(Math.round((minutes/60)*10)/10),'attended linked rows')+'</div>'+(chips?'<div class="event-subsection"><h3>Recorded impact</h3><div class="event-impact-summary">'+chips+'</div></div>':'<p class="muted">No event impact metrics recorded yet.</p>')+'</div>';
    root.insertBefore(section,root.firstChild);
  }
  function renderAllEventUi(){renderManager();decorateEventLog();renderDashboardImpact();}

  injectShell();
  const previousEventRender=typeof renderEventLogEditor==='function'?renderEventLogEditor:null;
  if(previousEventRender){renderEventLogEditor=function(){const result=previousEventRender.apply(this,arguments);setTimeout(decorateEventLog,0);return result;};}
  const previousDashboard=typeof renderDashboard==='function'?renderDashboard:null;
  if(previousDashboard){renderDashboard=function(){const result=previousDashboard.apply(this,arguments);setTimeout(function(){if(state.loaded)renderDashboardImpact();else loadAll(false);},0);return result;};}
  window.addEventListener('maklom:access-state',function(e){if(e.detail&&e.detail.ready){state.loaded=false;loadAll(true);}else renderAccessWait();});
  document.addEventListener('DOMContentLoaded',function(){injectShell();setTimeout(function(){loadAll(false);decorateEventLog();},100);});
  setTimeout(function(){loadAll(false);},300);
})();