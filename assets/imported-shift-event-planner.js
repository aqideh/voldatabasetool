(function installImportedShiftEventPlanner(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12};
  let activePlan=null;
  let enhanceQueued=false;

  function clean(value){return String(value==null?'':value).trim();}
  function esc(value){return typeof escapeHtml==='function'?escapeHtml(clean(value)):clean(value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function iso(value){return clean(value).slice(0,10);}
  function normal(value){return clean(value).toLowerCase();}
  function localId(prefix){return typeof makeId==='function'?makeId(prefix):prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}
  function fmtDate(value){const d=iso(value);if(!d)return'—';if(window.MaklomDateDisplay&&window.MaklomDateDisplay.format)return window.MaklomDateDisplay.format(d);const p=d.split('-');return p.length===3?p[2]+p[1]+p[0].slice(-2):d;}

  function ensureStyles(){
    if(document.getElementById('importedShiftPlannerStyles'))return;
    const link=document.createElement('link');
    link.id='importedShiftPlannerStyles';link.rel='stylesheet';link.href='assets/imported-shift-event-planner.css?v=20260910-1';
    document.head.appendChild(link);
  }

  function namedDate(value){
    const match=clean(value).toLowerCase().match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/);
    if(!match)return'';
    const month=MONTHS[match[2]];if(!month)return'';
    return match[3]+'-'+String(month).padStart(2,'0')+'-'+String(Number(match[1])).padStart(2,'0');
  }

  function explicitShiftFromName(value){
    const name=clean(value);
    const numbered=name.match(/\bshift\s*(\d+)\b/i);if(numbered)return'Shift '+Number(numbered[1]);
    if(/\b(?:a\.?m\.?)\b/i.test(name))return'AM';
    if(/\b(?:p\.?m\.?)\b/i.test(name))return'PM';
    if(/\bmorning\b/i.test(name))return'Morning';
    if(/\bafternoon\b/i.test(name))return'Afternoon';
    if(/\bevening\b/i.test(name))return'Evening';
    if(/\bnight\b/i.test(name))return'Night';
    if(/\b(?:full[ -]?day|all[ -]?day)\b/i.test(name))return'Full Day';
    return'';
  }

  function baseLabel(value){
    let name=clean(value);
    name=name.replace(/(?:\s*[-–—|:]\s*)?\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?\s*\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/ig,' ');
    name=name.replace(/(?:\s*[-–—|:]\s*)?\b(?:shift\s*\d+|a\.?m\.?|p\.?m\.?|morning|afternoon|evening|night|full[ -]?day|all[ -]?day)\b/ig,' ');
    return name.replace(/\s*[-–—|:]+\s*$/,'').replace(/\s+/g,' ').trim()||clean(value);
  }
  function baseKey(value){return normal(baseLabel(value)).replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  function effectiveDate(row){return namedDate(row&&row.event_name)||iso(row&&row.event_date);}

  function proposedShiftLabel(raw){
    const value=clean(raw);if(!value)return'';
    if(/^\d+$/.test(value))return'Shift '+Number(value);
    const numbered=value.match(/^shift\s*(\d+)$/i);if(numbered)return'Shift '+Number(numbered[1]);
    if(/^a\.?m\.?$/i.test(value))return'AM';
    if(/^p\.?m\.?$/i.test(value))return'PM';
    if(/^morning$/i.test(value))return'Morning';
    if(/^afternoon$/i.test(value))return'Afternoon';
    if(/^evening$/i.test(value))return'Evening';
    if(/^night$/i.test(value))return'Night';
    if(/^(?:full[ -]?day|all[ -]?day)$/i.test(value))return'Full Day';
    return value;
  }

  function shiftSignal(row){
    const imported=clean(row&&row.shift_label);
    if(imported)return{label:proposedShiftLabel(imported),raw:imported,source:'Imported shift'};
    const detected=explicitShiftFromName(row&&row.event_name);
    if(detected)return{label:detected,raw:detected,source:'Detected from event name'};
    return{label:'',raw:'',source:'No shift label'};
  }

  function shiftRank(label){
    const numbered=clean(label).match(/^shift\s*(\d+)$/i);if(numbered)return 100+Number(numbered[1]);
    return({AM:10,Morning:20,'Full Day':30,PM:40,Afternoon:50,Evening:60,Night:70})[label]||500;
  }

  function hasImportedShiftLocally(names){
    const wanted=new Set((names||[]).map(clean));
    return (appData.attendanceLog||[]).some(function(row){
      return wanted.has(clean(row.eventName))&&!clean(row.eventId)&&clean(row.shiftLabel);
    });
  }

  async function loadUnassignedRows(){
    if(typeof S.fetchRows==='function'){
      const rows=await S.fetchRows('attendance_log','id,name,email,contact,attended,event_name,event_date,event_id,shift_id,shift_label,duration_minutes,row_version');
      return rows.filter(function(row){return !row.event_id;});
    }
    const response=await S.apiFetch('/rest/v1/attendance_log?select=id,name,email,contact,attended,event_name,event_date,event_id,shift_id,shift_label,duration_minutes,row_version&event_id=is.null&order=event_name.asc,event_date.asc,name.asc',{method:'GET'});
    if(!response.ok)throw new Error(await response.text());
    return response.json();
  }

  function candidateRows(allRows,candidateName){
    const exact=allRows.filter(function(row){return clean(row.event_name)===candidateName;});
    const date=namedDate(candidateName),label=explicitShiftFromName(candidateName),key=baseKey(candidateName);
    if(!date||!label||!key)return exact;
    const related=allRows.filter(function(row){return effectiveDate(row)===date&&baseKey(row.event_name)===key&&explicitShiftFromName(row.event_name);});
    return related.length>exact.length?related:exact;
  }

  function commonName(names){
    if(!names.length)return'Event';
    const bases=names.map(baseLabel);
    if(bases.every(function(name){return normal(name)===normal(bases[0]);}))return bases[0];
    const tokens=bases.map(function(name){return name.split(/\s+/).filter(Boolean);});
    const prefix=[];
    for(let i=0;;i++){
      const token=tokens[0][i];
      if(!token||!tokens.every(function(parts){return parts[i]&&normal(parts[i])===normal(token);}))break;
      prefix.push(token);
    }
    return prefix.length>=2?prefix.join(' '):bases[0];
  }

  function buildPlan(rows,names){
    const dated=rows.filter(function(row){return !!effectiveDate(row);});
    if(!dated.length)throw new Error('No usable event dates were found in these Event Log rows.');
    const dates=Array.from(new Set(dated.map(effectiveDate))).sort();
    const groups={};
    dated.forEach(function(row){
      const date=effectiveDate(row),signal=shiftSignal(row),label=signal.label;
      const key=date+'|'+normal(label||'__unlabelled__');
      if(!groups[key])groups[key]={date:date,label:label,rawLabels:new Set(),sources:new Set(),rows:[],rowIds:[]};
      groups[key].rows.push(row);groups[key].rowIds.push(row.id);groups[key].sources.add(signal.source);
      if(signal.raw)groups[key].rawLabels.add(signal.raw);
    });
    const perDate={};Object.keys(groups).forEach(function(key){const group=groups[key];perDate[group.date]=(perDate[group.date]||0)+1;});
    const dateIndex={};dates.forEach(function(date,index){dateIndex[date]=index+1;});
    const shifts=Object.keys(groups).map(function(key){
      const group=groups[key];
      if(!group.label){group.label=perDate[group.date]>1?'Unlabelled':(dates.length>1?'Session '+dateIndex[group.date]:'General');}
      group.rawLabels=Array.from(group.rawLabels);group.sources=Array.from(group.sources);
      return group;
    }).sort(function(a,b){return a.date.localeCompare(b.date)||shiftRank(a.label)-shiftRank(b.label)||a.label.localeCompare(b.label);});
    return{
      name:commonName(names),start:dates[0],end:dates[dates.length-1],dates:dates,sourceRows:dated,shifts:shifts,
      hasImported:dated.some(function(row){return !!clean(row.shift_label);}),undated:rows.length-dated.length,names:names.slice()
    };
  }

  function volunteerSummary(rows){
    const names=[];const seen={};
    rows.forEach(function(row){const name=clean(row.name)||clean(row.email)||'Unnamed volunteer',key=normal(name);if(!seen[key]){seen[key]=true;names.push(name);}});
    const shown=names.slice(0,6).map(esc).join(', ');
    return shown+(names.length>6?' +'+(names.length-6)+' more':'');
  }

  function signalText(shift){
    if(shift.rawLabels.length)return'Imported: '+shift.rawLabels.join(', ');
    if(shift.sources.indexOf('Detected from event name')>-1)return'Detected from event name';
    return'No imported shift';
  }

  function shiftRowHtml(shift){
    return'<div class="isp-shift-row" data-isp-shift data-row-ids="'+esc(shift.rowIds.join(','))+'">'+
      '<div class="isp-shift-source"><span class="pill '+(shift.rawLabels.length?'ok':'neutral')+'">'+esc(signalText(shift))+'</span><span class="muted">'+shift.rows.length+' row'+(shift.rows.length===1?'':'s')+' · '+esc(volunteerSummary(shift.rows))+'</span></div>'+
      '<label>Shift name<input data-isp-name maxlength="120" value="'+esc(shift.label)+'"></label>'+
      '<label>Date<input data-isp-date type="date" value="'+esc(shift.date)+'"></label>'+
      '<label>Start<input data-isp-start type="time"></label>'+
      '<label>End<input data-isp-end type="time"></label>'+
      '<button type="button" class="small" data-isp-remove>Remove</button>'+
    '</div>';
  }

  function renderPlan(plan){
    const panel=document.getElementById('eventCreatePanel');if(!panel)return;
    activePlan=plan;
    const recurring=plan.dates.length>1&&plan.start!==plan.end;
    const notice=recurring?'<div class="notice neutral"><strong>Multiple dates detected.</strong> MakLom will keep these under one event header from '+esc(fmtDate(plan.start))+' to '+esc(fmtDate(plan.end))+', with dated shifts underneath.</div>':'';
    const undated=plan.undated?'<div class="notice warn">'+plan.undated+' source row'+(plan.undated===1?' has':'s have')+' no usable date and will not be included automatically.</div>':'';
    panel.innerHTML='<div class="card isp-planner"><div class="event-manager-head"><div><h3>Review event & detected shifts</h3><p class="muted">Imported Shift values take priority. MakLom has already grouped the Event Log rows; confirm or rename the proposed shifts before creating the event.</p></div><button id="cancelImportedShiftPlan" type="button" class="small">Cancel</button></div>'+notice+undated+
      '<div class="event-detail-grid"><label>Event name<input id="ispEventName" maxlength="500" value="'+esc(plan.name)+'"></label><label>Start date<input id="ispEventStart" type="date" value="'+esc(plan.start)+'"></label><label>End date<input id="ispEventEnd" type="date" value="'+esc(plan.end)+'"></label><label>Programme / category<input id="ispEventProgramme" maxlength="500"></label><label>Venue<input id="ispEventVenue" maxlength="500"></label><label>Notes<input id="ispEventNotes" maxlength="2000"></label></div>'+
      '<div class="event-subsection isp-shifts"><div class="isp-section-head"><div><h4>Detected shifts</h4><p class="muted">Rows are already sorted below. Edit only the shift names or times if needed. Removing a shift keeps those rows on the event without a structured shift.</p></div><span class="pill neutral">'+plan.shifts.length+' proposed</span></div><div id="ispShiftRows">'+plan.shifts.map(shiftRowHtml).join('')+'</div></div>'+
      '<div class="isp-assignment-summary"><strong>'+plan.sourceRows.length+' Event Log row'+(plan.sourceRows.length===1?'':'s')+'</strong><span>will be assigned automatically when you confirm.</span></div><div class="row"><button id="confirmImportedShiftPlan" type="button" class="primary">Create event & assign '+plan.sourceRows.length+' row'+(plan.sourceRows.length===1?'':'s')+'</button></div></div>';
    panel.scrollIntoView({behavior:'smooth',block:'start'});
    panel.querySelector('#cancelImportedShiftPlan').addEventListener('click',function(){activePlan=null;panel.innerHTML='';});
    panel.querySelectorAll('[data-isp-remove]').forEach(function(button){button.addEventListener('click',function(){button.closest('[data-isp-shift]').remove();});});
    panel.querySelector('#confirmImportedShiftPlan').addEventListener('click',function(){createFromPlan(plan,this).catch(handleCreateError);});
    if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();
  }

  function readEditedShifts(start,end){
    const normalise=window.MaklomTime24h&&window.MaklomTime24h.normalize;
    const shifts=[];
    document.querySelectorAll('#ispShiftRows [data-isp-shift]').forEach(function(row){
      const name=clean(row.querySelector('[data-isp-name]').value),date=iso(row.querySelector('[data-isp-date]').value);
      const startRaw=clean(row.querySelector('[data-isp-start]').value),endRaw=clean(row.querySelector('[data-isp-end]').value);
      const startTime=startRaw?(normalise?normalise(startRaw):startRaw):'',endTime=endRaw?(normalise?normalise(endRaw):endRaw):'';
      if(!name||!date)throw new Error('Each proposed shift needs a name and date.');
      if(date<start||date>end)throw new Error('Shift '+name+' must fall within the event date range.');
      if(startRaw&&startTime===null)throw new Error('Start time for '+name+' must use 24-hour HH:mm format.');
      if(endRaw&&endTime===null)throw new Error('End time for '+name+' must use 24-hour HH:mm format.');
      shifts.push({name:name,date:date,start:startTime||null,end:endTime||null,rowIds:clean(row.dataset.rowIds).split(',').filter(Boolean)});
    });
    return shifts;
  }

  async function post(table,row){
    const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});
    if(!response.ok)throw new Error(await response.text());
    const rows=await response.json();return rows[0];
  }

  async function patchAttendance(row,eventId,shiftId){
    const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({event_id:eventId,shift_id:shiftId})});
    if(!response.ok)throw new Error(await response.text());
    const updated=await response.json();
    if(!updated.length)throw new Error('An Event Log row changed in another browser. Reload and try again.');
  }

  async function createFromPlan(plan,button){
    const name=clean((document.getElementById('ispEventName')||{}).value),start=iso((document.getElementById('ispEventStart')||{}).value),end=iso((document.getElementById('ispEventEnd')||{}).value||start);
    if(!name||!start||!end)throw new Error('Event name, start date and end date are required.');
    if(end<start)throw new Error('End date cannot be before start date.');
    const shifts=readEditedShifts(start,end);
    button.disabled=true;button.textContent='Creating & assigning…';
    const event=await post('events',{id:localId('event'),name:name,start_date:start,end_date:end,programme:clean((document.getElementById('ispEventProgramme')||{}).value)||null,venue:clean((document.getElementById('ispEventVenue')||{}).value)||null,notes:clean((document.getElementById('ispEventNotes')||{}).value)||null,status:'active'});
    const rowById={};plan.sourceRows.forEach(function(row){rowById[row.id]=row;});
    const assigned=new Set();
    for(const shift of shifts){
      const createdShift=await post('event_shifts',{id:localId('shift'),event_id:event.id,name:shift.name,shift_date:shift.date,start_time:shift.start,end_time:shift.end,notes:null});
      for(const rowId of shift.rowIds){const row=rowById[rowId];if(!row)continue;await patchAttendance(row,event.id,createdShift.id);assigned.add(rowId);}
    }
    for(const row of plan.sourceRows){if(!assigned.has(row.id))await patchAttendance(row,event.id,null);}
    activePlan=null;
    if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    const eventsButton=document.querySelector('nav button[data-view="eventsView"]');if(eventsButton)eventsButton.click();
  }

  function handleCreateError(error){
    console.error(error);
    alert('Could not complete event creation: '+error.message+' Some earlier changes may already have been applied; reload Events before retrying.');
    const button=document.getElementById('confirmImportedShiftPlan');if(button){button.disabled=false;button.textContent='Try again';}
  }

  async function openCandidatePlanner(candidateName){
    const panel=document.getElementById('eventCreatePanel');if(panel)panel.innerHTML='<div class="card"><p class="muted">Detecting imported shifts and sorting Event Log rows…</p></div>';
    try{
      const rows=await loadUnassignedRows(),relevant=candidateRows(rows,candidateName);
      if(!relevant.length)throw new Error('No unassigned Event Log rows were found for this event.');
      renderPlan(buildPlan(relevant,[candidateName]));
    }catch(error){console.error(error);if(panel)panel.innerHTML='<div class="card"><div class="notice bad">Could not prepare shifts: '+esc(error.message)+'</div></div>';}
  }

  async function openCombinedPlanner(names){
    const panel=document.getElementById('eventCreatePanel');if(panel)panel.innerHTML='<div class="card"><p class="muted">Combining selected Event Log groups and detecting imported shifts…</p></div>';
    try{
      const rows=await loadUnassignedRows(),wanted=new Set(names),relevant=rows.filter(function(row){return wanted.has(clean(row.event_name));});
      if(!relevant.length)throw new Error('No unassigned Event Log rows were found for the selected groups.');
      renderPlan(buildPlan(relevant,names));
    }catch(error){console.error(error);if(panel)panel.innerHTML='<div class="card"><div class="notice bad">Could not prepare combined event: '+esc(error.message)+'</div></div>';}
  }

  function localRowById(id){return (appData.attendanceLog||[]).find(function(row){return row.id===id;})||null;}
  function importedShiftForId(id){const row=localRowById(id);return clean(row&&row.shiftLabel);}

  function insertImportedShiftColumn(table,checkboxSelector,afterHeaderText){
    if(!table)return;
    const header=table.querySelector('thead tr');if(!header)return;
    let shiftHead=header.querySelector('[data-imported-shift-head]');
    if(!shiftHead){
      const cells=Array.from(header.children),afterIndex=cells.findIndex(function(cell){return clean(cell.textContent)===afterHeaderText;});
      shiftHead=document.createElement('th');shiftHead.dataset.importedShiftHead='true';shiftHead.className='isp-imported-shift-cell';shiftHead.textContent='Imported shift';
      const anchor=afterIndex>-1?cells[afterIndex].nextSibling:null;header.insertBefore(shiftHead,anchor);
    }
    const index=Array.from(header.children).indexOf(shiftHead);
    table.querySelectorAll('tbody tr').forEach(function(tr){
      if(tr.querySelector('[data-imported-shift-cell]'))return;
      const box=tr.querySelector(checkboxSelector);if(!box)return;
      const id=box.getAttribute('data-event-assign-row')||box.getAttribute('data-shift-add-row')||box.getAttribute('data-shift-assigned-row')||'';
      const raw=importedShiftForId(id),td=document.createElement('td');td.dataset.importedShiftCell='true';td.className='isp-imported-shift-cell';
      td.innerHTML=raw?'<span class="pill neutral" title="Imported Shift: '+esc(raw)+'">'+esc(raw)+'</span>':'<span class="muted">—</span>';
      tr.insertBefore(td,tr.children[index]||null);
    });
  }

  function enhanceAssignmentPanels(){
    insertImportedShiftColumn(document.querySelector('#eventRowAssignment .event-assign-table'),'[data-event-assign-row]','Existing event');
    insertImportedShiftColumn(document.querySelector('#shiftAddRowsPanel .shift-assigned-table'),'[data-shift-add-row]','Existing event');
    insertImportedShiftColumn(document.querySelector('#shiftAssignedRowsPanel .shift-assigned-table'),'[data-shift-assigned-row]','Volunteer');
  }

  function enhanceCandidateSummaries(){
    document.querySelectorAll('.event-candidate-row [data-candidate-name]').forEach(function(button){
      const row=button.closest('.event-candidate-row');if(!row||row.querySelector('[data-imported-shift-summary]'))return;
      const name=clean(button.dataset.candidateName),counts={};
      (appData.attendanceLog||[]).forEach(function(item){
        if(clean(item.eventName)!==name||clean(item.eventId)||!clean(item.shiftLabel))return;
        const raw=clean(item.shiftLabel);counts[raw]=(counts[raw]||0)+1;
      });
      const labels=Object.keys(counts);if(!labels.length)return;
      const summary=document.createElement('div');summary.dataset.importedShiftSummary='true';summary.className='isp-candidate-shifts muted';
      summary.innerHTML='<strong>Imported shifts:</strong> '+labels.sort(function(a,b){return proposedShiftLabel(a).localeCompare(proposedShiftLabel(b),undefined,{numeric:true});}).map(function(label){return'<span class="pill neutral">'+esc(label)+' · '+counts[label]+'</span>';}).join(' ');
      const meta=row.querySelector('.muted');if(meta)meta.insertAdjacentElement('afterend',summary);else row.firstElementChild&&row.firstElementChild.appendChild(summary);
    });
  }

  function enhance(){enhanceQueued=false;enhanceCandidateSummaries();enhanceAssignmentPanels();}
  function scheduleEnhance(){if(enhanceQueued)return;enhanceQueued=true;requestAnimationFrame(enhance);}

  document.addEventListener('click',function(event){
    const candidate=event.target.closest&&event.target.closest('.event-candidate-row [data-candidate-name]');
    if(candidate){
      const name=clean(candidate.dataset.candidateName);
      if(hasImportedShiftLocally([name])){
        event.preventDefault();event.stopImmediatePropagation();
        openCandidatePlanner(name);
      }
      return;
    }
    const group=event.target.closest&&event.target.closest('#groupSelectedCandidates');
    if(group){
      const names=Array.from(document.querySelectorAll('[data-group-candidate]:checked')).map(function(box){return clean(box.dataset.groupCandidate);}).filter(Boolean);
      if(names.length>=2&&hasImportedShiftLocally(names)){
        event.preventDefault();event.stopImmediatePropagation();
        openCombinedPlanner(names);
      }
    }
  },true);

  ensureStyles();
  document.addEventListener('DOMContentLoaded',function(){
    const main=document.querySelector('main');if(main)new MutationObserver(scheduleEnhance).observe(main,{childList:true,subtree:true});
    scheduleEnhance();
  });
  window.addEventListener('maklom:access-state',scheduleEnhance);
  setTimeout(scheduleEnhance,900);
})();
