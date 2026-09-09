(function installEventOccurrenceMigration(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  const selected=new Set();
  let lastRows=[];

  function clean(v){return String(v==null?'':v).trim();}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(clean(v)):clean(v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function iso(v){return clean(v).slice(0,10);}
  function localId(prefix){return typeof makeId==='function'?makeId(prefix):prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}
  function fmtDate(v){const d=iso(v);if(!d)return'—';if(window.MaklomDateDisplay&&window.MaklomDateDisplay.format)return window.MaklomDateDisplay.format(d);const p=d.split('-');return p.length===3?p[2]+p[1]+p[0].slice(-2):d;}
  function daysBetween(a,b){if(!a||!b)return 0;return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000);}

  function namedDate(value){
    const match=clean(value).toLowerCase().match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/);
    if(!match)return'';const month=MONTHS[match[2]];if(!month)return'';
    return match[3]+'-'+String(month).padStart(2,'0')+'-'+String(Number(match[1])).padStart(2,'0');
  }

  function effectiveDate(row){return namedDate(row.event_name)||iso(row.event_date);}
  function shiftLabel(value){
    const n=clean(value);
    if(/\b(?:a\.?m\.?)\b/i.test(n))return'AM';
    if(/\b(?:p\.?m\.?)\b/i.test(n))return'PM';
    if(/\bmorning\b/i.test(n))return'Morning';
    if(/\bafternoon\b/i.test(n))return'Afternoon';
    if(/\bevening\b/i.test(n))return'Evening';
    if(/\bnight\b/i.test(n))return'Night';
    if(/\b(?:full[ -]?day|all[ -]?day)\b/i.test(n))return'Full Day';
    return'';
  }
  function shiftOrder(label){return({AM:1,Morning:2,'Full Day':3,PM:4,Afternoon:5,Evening:6,Night:7})[label]||20;}

  function baseLabel(value){
    let n=clean(value);
    n=n.replace(/(?:\s*[-–—|:]\s*)?\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?\s*\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/ig,' ');
    n=n.replace(/(?:\s*[-–—|:]\s*)?\b(?:a\.?m\.?|p\.?m\.?|morning|afternoon|evening|night|full[ -]?day|all[ -]?day)\b/ig,' ');
    return n.replace(/\s*[-–—|:]+\s*$/,'').replace(/\s+/g,' ').trim()||clean(value);
  }
  function baseKey(value){return baseLabel(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}

  async function loadRows(){
    const response=await S.apiFetch('/rest/v1/attendance_log?select=id,name,email,event_name,event_date,event_id,shift_id,row_version&event_id=is.null&order=event_name.asc,event_date.asc',{method:'GET'});
    if(!response.ok)throw new Error(await response.text());
    lastRows=await response.json();return lastRows;
  }

  function clusterDates(dates){
    const sorted=Array.from(new Set(dates.filter(Boolean))).sort();
    const clusters=[];let current=[];
    sorted.forEach(function(date){
      if(!current.length||daysBetween(current[current.length-1],date)<=1)current.push(date);
      else{clusters.push(current);current=[date];}
    });
    if(current.length)clusters.push(current);return clusters;
  }

  function rowsForCandidate(rows,name){
    const exact=rows.filter(function(r){return clean(r.event_name)===name;});
    const label=shiftLabel(name),date=namedDate(name),key=baseKey(name);
    if(!label||!date||!key)return exact;
    const related=rows.filter(function(r){return namedDate(r.event_name)===date&&baseKey(r.event_name)===key&&shiftLabel(r.event_name);});
    return related.length>exact.length?related:exact;
  }

  function buildShifts(rows,dates){
    const dateSet=new Set(dates);const groups={};
    rows.forEach(function(row){
      const date=effectiveDate(row);if(!dateSet.has(date))return;
      const label=shiftLabel(row.event_name);const key=date+'|'+label;
      if(!groups[key])groups[key]={date:date,label:label,count:0,rowIds:[],sourceNames:new Set()};
      groups[key].count++;groups[key].rowIds.push(row.id);groups[key].sourceNames.add(clean(row.event_name));
    });
    const shifts=Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return a.date.localeCompare(b.date)||shiftOrder(a.label)-shiftOrder(b.label)||a.label.localeCompare(b.label);});
    const multiDate=new Set(shifts.map(function(s){return s.date;})).size>1;let day=0,last='';
    shifts.forEach(function(s){if(s.date!==last){day++;last=s.date;}if(!s.label)s.label=multiDate?'Day '+day:'General';});
    return shifts;
  }

  function occurrencePlanForCandidate(rows,candidateName){
    const relevant=rowsForCandidate(rows,candidateName);const dates=Array.from(new Set(relevant.map(effectiveDate).filter(Boolean))).sort();
    const clusters=clusterDates(dates);
    return clusters.map(function(cluster){return{name:baseLabel(candidateName),start:cluster[0],end:cluster[cluster.length-1],sourceRows:relevant.filter(function(r){return cluster.indexOf(effectiveDate(r))>=0;}),shifts:buildShifts(relevant,cluster)};});
  }

  function combinedPlan(rows,names){
    const chosen=rows.filter(function(r){return names.indexOf(clean(r.event_name))>=0;});
    const dates=Array.from(new Set(chosen.map(effectiveDate).filter(Boolean))).sort();
    if(!dates.length)return null;
    const base=commonName(names)||baseLabel(names[0])||'Combined event';
    return{name:base,start:dates[0],end:dates[dates.length-1],sourceRows:chosen,shifts:buildCombinedShifts(chosen,dates)};
  }

  function commonName(names){
    if(!names.length)return'';
    const cleaned=names.map(baseLabel);if(cleaned.every(function(n){return n===cleaned[0];}))return cleaned[0];
    const tokens=cleaned.map(function(n){return n.split(/\s+/).filter(Boolean);});
    let prefix=[];for(let i=0;;i++){const t=tokens[0][i];if(!t||!tokens.every(function(arr){return arr[i]&&arr[i].toLowerCase()===t.toLowerCase();}))break;prefix.push(t);}
    return prefix.length>=2?prefix.join(' '):cleaned[0];
  }

  function buildCombinedShifts(rows,dates){
    const groups={};
    rows.forEach(function(row){
      const date=effectiveDate(row);if(!date)return;
      const explicit=shiftLabel(row.event_name);const source=clean(row.event_name);const key=date+'|'+(explicit||source);
      if(!groups[key])groups[key]={date:date,label:explicit||'',count:0,rowIds:[],sourceNames:new Set()};
      groups[key].count++;groups[key].rowIds.push(row.id);groups[key].sourceNames.add(source);
    });
    const shifts=Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return a.date.localeCompare(b.date)||shiftOrder(a.label)-shiftOrder(b.label);});
    const byDate={};shifts.forEach(function(s){byDate[s.date]=(byDate[s.date]||0)+1;});let day=0,last='';
    shifts.forEach(function(s){if(s.date!==last){day++;last=s.date;}if(!s.label){const src=Array.from(s.sourceNames)[0]||'';s.label=byDate[s.date]>1?baseLabel(src):(dates.length>1?'Day '+day:'General');}});
    return shifts;
  }

  function enhanceCandidateList(){
    const buttons=Array.from(document.querySelectorAll('[data-candidate-name]'));if(!buttons.length)return;
    const card=buttons[0].closest('.card');if(!card)return;
    buttons.forEach(function(button){
      const row=button.closest('.event-candidate-row');if(!row||row.querySelector('[data-group-candidate]'))return;
      const name=clean(button.dataset.candidateName);const box=document.createElement('input');box.type='checkbox';box.dataset.groupCandidate=name;box.title='Select this log group for one combined event';box.checked=selected.has(name);
      box.addEventListener('change',function(){if(box.checked)selected.add(name);else selected.delete(name);refreshToolbar(card);});
      row.insertBefore(box,row.firstChild);
    });
    let toolbar=card.querySelector('#eventCandidateGroupToolbar');
    if(!toolbar){toolbar=document.createElement('div');toolbar.id='eventCandidateGroupToolbar';toolbar.className='event-candidate-toolbar';const heading=card.querySelector('h3');if(heading)heading.insertAdjacentElement('afterend',toolbar);else card.prepend(toolbar);}
    refreshToolbar(card);
  }

  function refreshToolbar(card){
    const toolbar=card.querySelector('#eventCandidateGroupToolbar');if(!toolbar)return;
    toolbar.innerHTML='<span><strong>'+selected.size+'</strong> selected</span><div class="row"><button id="groupSelectedCandidates" type="button" class="small" '+(selected.size<2?'disabled':'')+'>Group selected as one event</button><button id="clearSelectedCandidates" type="button" class="small" '+(!selected.size?'disabled':'')+'>Clear</button></div>';
    const group=toolbar.querySelector('#groupSelectedCandidates');if(group)group.addEventListener('click',openCombinedPreview);
    const clear=toolbar.querySelector('#clearSelectedCandidates');if(clear)clear.addEventListener('click',function(){selected.clear();card.querySelectorAll('[data-group-candidate]').forEach(function(x){x.checked=false;});refreshToolbar(card);});
  }

  async function openCombinedPreview(){
    try{const rows=await loadRows();const names=Array.from(selected);const plan=combinedPlan(rows,names);if(!plan)throw new Error('No usable dates were found in the selected groups.');renderCombinedPreview(plan,names);}catch(error){alert('Could not prepare combined event: '+error.message);}
  }

  function renderCombinedPreview(plan,names){
    const panel=document.getElementById('eventCreatePanel');if(!panel)return;
    panel.innerHTML='<div class="card"><div class="event-manager-head"><div><h3>Group selected logs into one event</h3><p class="muted">'+names.length+' differently named Event Log groups will be consolidated. Review the event name and inferred shifts before creating.</p></div><button id="cancelCombinedEvent" type="button" class="small">Cancel</button></div>'+eventFields(plan.name,plan.start,plan.end)+'<div class="event-subsection"><h4>Source groups</h4><div class="event-source-name-list">'+names.map(function(n){return'<span class="pill neutral">'+esc(n)+'</span>';}).join('')+'</div></div>'+shiftEditor(plan.shifts)+'<div class="notice warn">Creating this event will assign '+plan.sourceRows.length+' matching Event Log rows to the new structured event and its shifts. Their structured event/date metadata will then follow the new event and shift.</div><div class="row"><button id="confirmCombinedEvent" class="primary" type="button">Create & assign rows</button></div></div>';
    panel.scrollIntoView({behavior:'smooth',block:'start'});wireShiftEditor();
    panel.querySelector('#cancelCombinedEvent').addEventListener('click',function(){panel.innerHTML='';});
    panel.querySelector('#confirmCombinedEvent').addEventListener('click',function(){createPlans([readEditedPlan(plan)],this).catch(handleCreateError);});
  }

  function eventFields(name,start,end){return'<div class="event-detail-grid"><label>Name<input id="migrationEventName" maxlength="500" value="'+esc(name)+'"></label><label>Start date<input id="migrationEventStart" type="date" value="'+esc(start)+'"></label><label>End date<input id="migrationEventEnd" type="date" value="'+esc(end)+'"></label><label>Programme / category<input id="migrationEventProgramme" maxlength="500"></label><label>Venue<input id="migrationEventVenue" maxlength="500"></label><label>Notes<input id="migrationEventNotes" maxlength="2000"></label></div>';}

  function shiftEditor(shifts){return'<div class="event-subsection"><h4>Suggested shifts</h4><p class="muted">Each shift is mapped to the source rows shown by its count. Edit labels/times if needed; dates come from the Event Log or an explicit date written in its name.</p><div id="migrationShiftRows">'+shifts.map(shiftRowHtml).join('')+'</div><div class="row"><button id="addMigrationShift" type="button" class="small">+ Add shift</button></div></div>';}
  function shiftRowHtml(s){return'<div class="grid migration-shift-row" data-row-ids="'+esc(s.rowIds.join(','))+'"><label>Shift name<input data-ms-name maxlength="120" value="'+esc(s.label)+'"></label><label>Date<input data-ms-date type="date" value="'+esc(s.date)+'"></label><label>Start time<input data-ms-start type="time"></label><label>End time<input data-ms-end type="time"></label><div><label>&nbsp;</label><button type="button" class="small" data-remove-ms>Remove</button></div><div class="muted">'+s.count+' source row'+(s.count===1?'':'s')+'</div></div>';}
  function wireShiftEditor(){
    document.querySelectorAll('[data-remove-ms]').forEach(function(b){b.addEventListener('click',function(){b.closest('.migration-shift-row').remove();});});
    const add=document.getElementById('addMigrationShift');if(add)add.addEventListener('click',function(){const c=document.getElementById('migrationShiftRows');const div=document.createElement('div');div.innerHTML=shiftRowHtml({label:'General',date:(document.getElementById('migrationEventStart')||{}).value||'',rowIds:[],count:0});const row=div.firstChild;c.appendChild(row);row.querySelector('[data-remove-ms]').addEventListener('click',function(){row.remove();});if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();});
    if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();
  }

  function readEditedPlan(original){
    const name=clean(document.getElementById('migrationEventName').value),start=iso(document.getElementById('migrationEventStart').value),end=iso(document.getElementById('migrationEventEnd').value||start);if(!name||!start||!end||end<start)throw new Error('Enter a valid event name and date range.');
    const normalise=window.MaklomTime24h&&window.MaklomTime24h.normalize;const shifts=[];
    document.querySelectorAll('#migrationShiftRows .migration-shift-row').forEach(function(row){const n=clean(row.querySelector('[data-ms-name]').value),d=iso(row.querySelector('[data-ms-date]').value),sr=clean(row.querySelector('[data-ms-start]').value),er=clean(row.querySelector('[data-ms-end]').value),st=sr?(normalise?normalise(sr):sr):'',et=er?(normalise?normalise(er):er):'';if(!n||!d)throw new Error('Each shift needs a name and date.');if(d<start||d>end)throw new Error('Shift '+n+' must be within the event date range.');if(sr&&st===null)throw new Error('Invalid start time for '+n+'.');if(er&&et===null)throw new Error('Invalid end time for '+n+'.');shifts.push({label:n,date:d,start:st||null,end:et||null,rowIds:clean(row.dataset.rowIds).split(',').filter(Boolean)});});
    return{name:name,start:start,end:end,programme:clean((document.getElementById('migrationEventProgramme')||{}).value)||null,venue:clean((document.getElementById('migrationEventVenue')||{}).value)||null,notes:clean((document.getElementById('migrationEventNotes')||{}).value)||null,sourceRows:original.sourceRows,shifts:shifts};
  }

  function renderOccurrencePreview(plans,candidateName){
    const panel=document.getElementById('eventCreatePanel');if(!panel)return;
    const totalRows=plans.reduce(function(t,p){return t+p.sourceRows.length;},0);
    panel.innerHTML='<div class="card"><div class="event-manager-head"><div><h3>Detected event occurrences</h3><p class="muted">MakLom split <strong>'+esc(candidateName)+'</strong> into '+plans.length+' occurrence'+(plans.length===1?'':'s')+'. Consecutive dates stay together; gaps create separate events.</p></div><button id="cancelOccurrenceMigration" type="button" class="small">Cancel</button></div><div class="event-occurrence-preview">'+plans.map(function(p,i){return'<div class="event-occurrence-row"><div><strong>Occurrence '+(i+1)+'</strong><div class="muted">'+fmtDate(p.start)+(p.end!==p.start?'–'+fmtDate(p.end):'')+' · '+p.sourceRows.length+' rows</div></div><div>'+p.shifts.map(function(s){return'<span class="pill neutral">'+esc(s.label)+' · '+fmtDate(s.date)+' · '+s.count+'</span>';}).join(' ')+'</div></div>';}).join('')+'</div><div class="event-detail-grid"><label>Event name for all occurrences<input id="occurrenceSharedName" maxlength="500" value="'+esc(baseLabel(candidateName))+'"></label><label>Programme / category<input id="occurrenceProgramme" maxlength="500"></label><label>Venue<input id="occurrenceVenue" maxlength="500"></label><label>Notes<input id="occurrenceNotes" maxlength="2000"></label></div><div class="notice warn">Creating these occurrences will create '+plans.length+' structured event'+(plans.length===1?'':'s')+' and automatically assign '+totalRows+' source Event Log rows.</div><div class="row"><button id="confirmOccurrenceMigration" type="button" class="primary">Create '+plans.length+' event'+(plans.length===1?'':'s')+' & assign rows</button></div></div>';
    panel.scrollIntoView({behavior:'smooth',block:'start'});
    panel.querySelector('#cancelOccurrenceMigration').addEventListener('click',function(){panel.innerHTML='';});
    panel.querySelector('#confirmOccurrenceMigration').addEventListener('click',function(){const shared=clean(document.getElementById('occurrenceSharedName').value);if(!shared){alert('Event name is required.');return;}const programme=clean(document.getElementById('occurrenceProgramme').value)||null,venue=clean(document.getElementById('occurrenceVenue').value)||null,notes=clean(document.getElementById('occurrenceNotes').value)||null;const prepared=plans.map(function(p){return Object.assign({},p,{name:shared,programme:programme,venue:venue,notes:notes,shifts:p.shifts.map(function(s){return{label:s.label,date:s.date,start:null,end:null,rowIds:s.rowIds};})});});createPlans(prepared,this).catch(handleCreateError);});
  }

  async function post(table,row){const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});if(!response.ok)throw new Error(await response.text());const rows=await response.json();return rows[0];}
  async function patchAttendance(rowId,version,eventId,shiftId){const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(rowId)+'&row_version=eq.'+encodeURIComponent(version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({event_id:eventId,shift_id:shiftId})});if(!response.ok)throw new Error(await response.text());const rows=await response.json();if(!rows.length)throw new Error('An Event Log row changed in another browser. Reload and try again.');}

  async function createPlans(plans,button){
    button.disabled=true;button.textContent='Creating…';const rowById={};lastRows.forEach(function(r){rowById[r.id]=r;});
    for(const plan of plans){
      const event=await post('events',{id:localId('event'),name:plan.name,start_date:plan.start,end_date:plan.end,programme:plan.programme||null,venue:plan.venue||null,notes:plan.notes||null,status:'active'});
      const assigned=new Set();
      for(const shift of plan.shifts){
        const createdShift=await post('event_shifts',{id:localId('shift'),event_id:event.id,name:shift.label,shift_date:shift.date,start_time:shift.start||null,end_time:shift.end||null,notes:null});
        for(const rowId of shift.rowIds||[]){const row=rowById[rowId];if(!row)continue;await patchAttendance(row.id,row.row_version,event.id,createdShift.id);assigned.add(rowId);}
      }
      for(const row of plan.sourceRows||[]){if(assigned.has(row.id))continue;await patchAttendance(row.id,row.row_version,event.id,null);}
    }
    selected.clear();if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}const eventsButton=document.querySelector('nav button[data-view="eventsView"]');if(eventsButton)eventsButton.click();
  }
  function handleCreateError(error){console.error(error);alert('Could not complete event migration: '+error.message);const b=document.querySelector('#confirmCombinedEvent,#confirmOccurrenceMigration');if(b){b.disabled=false;b.textContent='Try again';}}

  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('[data-candidate-name]');if(!button)return;
    const name=clean(button.dataset.candidateName);setTimeout(async function(){
      try{const rows=await loadRows();const plans=occurrencePlanForCandidate(rows,name);if(plans.length>1){renderOccurrencePreview(plans,name);}}
      catch(error){console.error(error);}
    },0);
  });

  document.addEventListener('DOMContentLoaded',function(){enhanceCandidateList();const main=document.querySelector('main');if(main)new MutationObserver(function(){enhanceCandidateList();}).observe(main,{childList:true,subtree:true});});
})();
