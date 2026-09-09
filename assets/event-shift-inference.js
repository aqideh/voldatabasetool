(function installEventShiftInference(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  const state={active:false,candidateName:'',rows:[],suggestions:[],recurring:false};

  function clean(value){return String(value==null?'':value).trim();}
  function esc(value){return typeof escapeHtml==='function'?escapeHtml(clean(value)):clean(value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function iso(value){return clean(value).slice(0,10);}
  function makeLocalId(prefix){return typeof makeId==='function'?makeId(prefix):prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}

  function namedDate(value){
    const name=clean(value).toLowerCase();
    const match=name.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/);
    if(!match)return'';
    const month=MONTHS[match[2]];
    if(!month)return'';
    return match[3]+'-'+String(month).padStart(2,'0')+'-'+String(Number(match[1])).padStart(2,'0');
  }

  function shiftLabel(value){
    const name=clean(value);
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
    name=name.replace(/(?:\s*[-–—|:]\s*)?\b(?:a\.?m\.?|p\.?m\.?|morning|afternoon|evening|night|full[ -]?day|all[ -]?day)\b/ig,' ');
    return name.replace(/\s*[-–—|:]+\s*$/,'').replace(/\s+/g,' ').trim()||clean(value);
  }

  function baseKey(value){return baseLabel(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  function effectiveDate(row){return namedDate(row&&row.event_name)||iso(row&&row.event_date);}
  function daysBetween(a,b){if(!a||!b)return 0;return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000);}

  function datePatternInfo(dates){
    const sorted=dates.slice().sort();
    let maxGap=0;
    for(let i=1;i<sorted.length;i++)maxGap=Math.max(maxGap,daysBetween(sorted[i-1],sorted[i]));
    return{span:sorted.length?daysBetween(sorted[0],sorted[sorted.length-1]):0,maxGap:maxGap};
  }

  async function loadUnassignedRows(){
    if(typeof S.fetchRows==='function'){
      const rows=await S.fetchRows('attendance_log','id,event_name,event_date,event_id');
      return rows.filter(function(row){return !row.event_id;});
    }
    const response=await S.apiFetch('/rest/v1/attendance_log?select=id,event_name,event_date,event_id&event_id=is.null&order=event_name.asc,event_date.asc',{method:'GET'});
    if(!response.ok)throw new Error(await response.text());
    return response.json();
  }

  function relevantRows(allRows,candidateName){
    const exact=allRows.filter(function(row){return clean(row.event_name)===candidateName;});
    const label=shiftLabel(candidateName),date=namedDate(candidateName),key=baseKey(candidateName);
    if(!label||!date||!key)return exact;
    const related=allRows.filter(function(row){
      return shiftLabel(row.event_name)&&namedDate(row.event_name)===date&&baseKey(row.event_name)===key;
    });
    return related.length>exact.length?related:exact;
  }

  function infer(rows,candidateName){
    const distinctDates=Array.from(new Set(rows.map(effectiveDate).filter(Boolean))).sort();
    const pattern=datePatternInfo(distinctDates);
    const hasRelatedShiftNames=new Set(rows.map(function(row){return clean(row.event_name);})).size>1&&rows.some(function(row){return !!shiftLabel(row.event_name);});
    const recurring=!hasRelatedShiftNames&&distinctDates.length>1&&(distinctDates.length>7||pattern.span>14||pattern.maxGap>3);
    if(recurring)return{suggestions:[],recurring:true,dates:distinctDates,pattern:pattern};

    const groups={};
    rows.forEach(function(row){
      const date=effectiveDate(row);if(!date)return;
      const explicit=shiftLabel(row.event_name);
      const key=date+'|'+(explicit||'');
      if(!groups[key])groups[key]={date:date,label:explicit,count:0,sources:{}};
      groups[key].count++;
      groups[key].sources[clean(row.event_name)]=true;
    });
    const grouped=Object.keys(groups).map(function(key){return groups[key];}).sort(function(a,b){
      return a.date.localeCompare(b.date)||shiftOrder(a.label)-shiftOrder(b.label)||a.label.localeCompare(b.label);
    });
    const multiDate=new Set(grouped.map(function(group){return group.date;})).size>1;
    let day=0,lastDate='';
    grouped.forEach(function(group){
      if(group.date!==lastDate){day++;lastDate=group.date;}
      if(!group.label)group.label=multiDate?'Day '+day:'General';
    });
    return{suggestions:grouped,recurring:false,dates:distinctDates,pattern:pattern};
  }

  function shiftOrder(label){
    return({AM:1,Morning:2,'Full Day':3,PM:4,Afternoon:5,Evening:6,Night:7})[label]||20;
  }

  function clearState(){state.active=false;state.candidateName='';state.rows=[];state.suggestions=[];state.recurring=false;}

  async function enhanceCandidate(button){
    const candidateName=clean(button.dataset.candidateName);if(!candidateName)return;
    state.active=true;state.candidateName=candidateName;state.rows=[];state.suggestions=[];state.recurring=false;
    const panel=document.getElementById('eventCreatePanel');
    try{
      const allRows=await loadUnassignedRows();
      if(!state.active||state.candidateName!==candidateName)return;
      const rows=relevantRows(allRows,candidateName);
      const result=infer(rows,candidateName);
      state.rows=rows;state.suggestions=result.suggestions;state.recurring=result.recurring;
      renderSuggestions(result,candidateName,rows);
    }catch(error){
      console.error(error);
      if(panel)appendWarning(panel,'Could not infer shifts from the Event Log. You can still create the event and add shifts manually.');
    }
  }

  function appendWarning(panel,message){
    const card=panel&&panel.querySelector('.card');if(!card)return;
    let box=document.getElementById('eventShiftInferenceNotice');
    if(!box){box=document.createElement('div');box.id='eventShiftInferenceNotice';box.className='notice warn';const actions=card.querySelector(':scope > .row:last-child');if(actions)card.insertBefore(box,actions);else card.appendChild(box);}
    box.textContent=message;
  }

  function renderSuggestions(result,candidateName,rows){
    const panel=document.getElementById('eventCreatePanel'),card=panel&&panel.querySelector('.card');if(!card)return;
    const old=document.getElementById('eventShiftInference');if(old)old.remove();
    const oldNotice=document.getElementById('eventShiftInferenceNotice');if(oldNotice)oldNotice.remove();

    if(result.recurring){
      appendWarning(panel,'This log group spans '+result.dates.length+' dates with gaps suggesting a recurring programme. Shifts were not auto-created. Create a specific occurrence rather than treating the whole series as one event.');
      return;
    }
    if(!result.suggestions.length){
      appendWarning(panel,'No reliable shift dates could be inferred from these Event Log rows.');
      return;
    }

    const sourceNames=Array.from(new Set(rows.map(function(row){return clean(row.event_name);}))).filter(Boolean);
    if(sourceNames.length>1&&shiftLabel(candidateName)){
      const nameInput=document.getElementById('createEventName');
      const cleaned=baseLabel(candidateName);
      if(nameInput&&cleaned)nameInput.value=cleaned;
    }
    const dates=result.suggestions.map(function(s){return s.date;}).sort();
    const start=document.getElementById('createEventStart'),end=document.getElementById('createEventEnd');
    if(start&&dates.length)start.value=dates[0];
    if(end&&dates.length)end.value=dates[dates.length-1];

    const section=document.createElement('div');section.id='eventShiftInference';section.className='event-subsection';
    section.innerHTML='<h4>Suggested shifts from Event Log</h4><p class="muted">MakLom inferred these from the source log names and dates. Review before creating. Start/end times are left blank because the Event Log does not contain shift times.</p><div id="eventShiftInferenceRows"></div><div class="row"><button id="addInferredShift" type="button" class="small">+ Add shift</button></div>';
    const actions=card.querySelector(':scope > .row:last-child');if(actions)card.insertBefore(section,actions);else card.appendChild(section);
    const container=document.getElementById('eventShiftInferenceRows');
    result.suggestions.forEach(function(suggestion){appendShiftRow(container,suggestion);});
    document.getElementById('addInferredShift').addEventListener('click',function(){appendShiftRow(container,{label:'General',date:(document.getElementById('createEventStart')||{}).value||'',count:0});});
    if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();
  }

  function appendShiftRow(container,suggestion){
    if(!container)return;
    const row=document.createElement('div');row.className='grid';row.dataset.inferredShift='true';
    row.innerHTML='<label>Shift name<input data-inferred-name maxlength="120" value="'+esc(suggestion.label||'General')+'"></label><label>Date<input data-inferred-date type="date" value="'+esc(suggestion.date||'')+'"></label><label>Start time<input data-inferred-start type="time"></label><label>End time<input data-inferred-end type="time"></label><div><label>&nbsp;</label><button type="button" class="small" data-remove-inferred-shift>Remove</button></div>'+(suggestion.count?'<div class="muted">'+suggestion.count+' source row'+(suggestion.count===1?'':'s')+'</div>':'');
    container.appendChild(row);
    row.querySelector('[data-remove-inferred-shift]').addEventListener('click',function(){row.remove();});
    if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();
  }

  function readShiftRows(start,end){
    const normalise=window.MaklomTime24h&&window.MaklomTime24h.normalize;
    const shifts=[];
    document.querySelectorAll('#eventShiftInferenceRows [data-inferred-shift]').forEach(function(row){
      const name=clean(row.querySelector('[data-inferred-name]').value);
      const date=iso(row.querySelector('[data-inferred-date]').value);
      const startRaw=clean(row.querySelector('[data-inferred-start]').value),endRaw=clean(row.querySelector('[data-inferred-end]').value);
      const startTime=startRaw?(normalise?normalise(startRaw):startRaw):'';
      const endTime=endRaw?(normalise?normalise(endRaw):endRaw):'';
      shifts.push({name:name,date:date,start:startTime,end:endTime,startRaw:startRaw,endRaw:endRaw});
    });
    for(const shift of shifts){
      if(!shift.name||!shift.date)throw new Error('Each suggested shift needs a name and date.');
      if(shift.date<start||shift.date>end)throw new Error('Shift '+shift.name+' must fall within the event date range.');
      if(shift.startRaw&&shift.start===null)throw new Error('Start time for '+shift.name+' must use 24-hour HH:mm format.');
      if(shift.endRaw&&shift.end===null)throw new Error('End time for '+shift.name+' must use 24-hour HH:mm format.');
    }
    return shifts;
  }

  async function postRow(table,row){
    const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});
    if(!response.ok)throw new Error(await response.text());
    const rows=await response.json();return rows[0];
  }

  async function createWithSuggestedShifts(button){
    const name=clean((document.getElementById('createEventName')||{}).value),start=iso((document.getElementById('createEventStart')||{}).value),end=iso((document.getElementById('createEventEnd')||{}).value||start);
    if(!name||!start||!end)throw new Error('Event name, start date and end date are required.');
    if(end<start)throw new Error('End date cannot be before start date.');
    const shifts=readShiftRows(start,end);
    button.disabled=true;button.textContent='Creating…';
    const event=await postRow('events',{id:makeLocalId('event'),name:name,start_date:start,end_date:end,programme:clean((document.getElementById('createEventProgramme')||{}).value)||null,venue:clean((document.getElementById('createEventVenue')||{}).value)||null,notes:clean((document.getElementById('createEventNotes')||{}).value)||null,status:'active'});
    for(const shift of shifts){
      await postRow('event_shifts',{id:makeLocalId('shift'),event_id:event.id,name:shift.name,shift_date:shift.date,start_time:shift.start||null,end_time:shift.end||null,notes:null});
    }
    clearState();
    if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    const eventsButton=document.querySelector('nav button[data-view="eventsView"]');
    if(eventsButton)eventsButton.click();
  }

  document.addEventListener('click',function(event){
    const candidate=event.target.closest&&event.target.closest('[data-candidate-name]');
    if(candidate){setTimeout(function(){enhanceCandidate(candidate);},0);return;}
    if(event.target.closest&&event.target.closest('#newStructuredEvent')){clearState();return;}
    if(event.target.closest&&event.target.closest('#cancelNewStructuredEvent')){clearState();return;}
  });

  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('#confirmNewStructuredEvent');
    if(!button||!state.active||state.recurring||!document.getElementById('eventShiftInference'))return;
    event.preventDefault();event.stopImmediatePropagation();
    createWithSuggestedShifts(button).catch(function(error){
      console.error(error);alert('Could not create event: '+error.message);button.disabled=false;button.textContent='Create event';
    });
  },true);
})();
