(function installRecurringEventHeaderMode(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  let lastCandidateName='';
  let enhancing=false;

  function clean(v){return String(v==null?'':v).trim();}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(clean(v)):clean(v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'})[ch];});}
  function iso(v){return clean(v).slice(0,10);}
  function localId(prefix){return typeof makeId==='function'?makeId(prefix):prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}

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
    return response.json();
  }

  function rowsForCandidate(rows,name){
    const exact=rows.filter(function(r){return clean(r.event_name)===name;});
    const label=shiftLabel(name),date=namedDate(name),key=baseKey(name);
    if(!label||!date||!key)return exact;
    const related=rows.filter(function(r){return namedDate(r.event_name)===date&&baseKey(r.event_name)===key&&shiftLabel(r.event_name);});
    return related.length>exact.length?related:exact;
  }

  function unifiedPlan(rows,candidateName){
    const relevant=rowsForCandidate(rows,candidateName);
    const dated=relevant.filter(function(row){return !!effectiveDate(row);});
    const dates=Array.from(new Set(dated.map(effectiveDate))).sort();
    if(dates.length<2)throw new Error('This log group does not contain multiple dated occurrences.');
    const groups={};
    dated.forEach(function(row){
      const date=effectiveDate(row),label=shiftLabel(row.event_name),key=date+'|'+label;
      if(!groups[key])groups[key]={date:date,explicitLabel:label,rowIds:[],count:0};
      groups[key].rowIds.push(row.id);groups[key].count++;
    });
    const dateIndex={};dates.forEach(function(date,index){dateIndex[date]=index+1;});
    const shifts=Object.keys(groups).map(function(key){const group=groups[key],session=dateIndex[group.date];return{date:group.date,label:'Session '+session+(group.explicitLabel?' '+group.explicitLabel:''),rowIds:group.rowIds,count:group.count,explicitLabel:group.explicitLabel};}).sort(function(a,b){return a.date.localeCompare(b.date)||shiftOrder(a.explicitLabel)-shiftOrder(b.explicitLabel)||a.label.localeCompare(b.label);});
    return{name:baseLabel(candidateName),start:dates[0],end:dates[dates.length-1],sourceRows:dated,shifts:shifts};
  }

  async function post(table,row){
    const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});
    if(!response.ok)throw new Error(await response.text());
    const rows=await response.json();return rows[0];
  }
  async function patchAttendance(row,eventId,shiftId){
    const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({event_id:eventId,shift_id:shiftId})});
    if(!response.ok)throw new Error(await response.text());
    const rows=await response.json();if(!rows.length)throw new Error('An Event Log row changed in another browser. Reload and try again.');
  }

  async function createUnifiedEvent(button){
    const candidateName=clean(button.dataset.candidateName||lastCandidateName);if(!candidateName)return;
    const sharedName=document.getElementById('occurrenceSharedName'),programme=document.getElementById('occurrenceProgramme'),venue=document.getElementById('occurrenceVenue'),notes=document.getElementById('occurrenceNotes');
    const name=clean(sharedName&&sharedName.value);if(!name){alert('Event name is required.');return;}
    button.disabled=true;button.textContent='Creating one event…';
    try{
      const rows=await loadRows(),plan=unifiedPlan(rows,candidateName),rowById={};rows.forEach(function(row){rowById[row.id]=row;});
      const event=await post('events',{id:localId('event'),name:name,start_date:plan.start,end_date:plan.end,programme:clean(programme&&programme.value)||null,venue:clean(venue&&venue.value)||null,notes:clean(notes&&notes.value)||null,status:'active'});
      const assigned=new Set();
      for(const shift of plan.shifts){
        const createdShift=await post('event_shifts',{id:localId('shift'),event_id:event.id,name:shift.label,shift_date:shift.date,start_time:null,end_time:null,notes:null});
        for(const rowId of shift.rowIds){const row=rowById[rowId];if(!row)continue;await patchAttendance(row,event.id,createdShift.id);assigned.add(rowId);}
      }
      for(const row of plan.sourceRows){if(!assigned.has(row.id))await patchAttendance(row,event.id,null);}
      if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
      const eventsButton=document.querySelector('nav button[data-view="eventsView"]');if(eventsButton)eventsButton.click();
    }catch(error){console.error(error);alert('Could not create the recurring event: '+error.message);button.disabled=false;button.textContent='Keep as 1 event & assign rows';}
  }

  function enhanceOccurrencePreview(){
    if(enhancing)return;
    const panel=document.getElementById('eventCreatePanel'),separate=panel&&panel.querySelector('#confirmOccurrenceMigration');
    if(!panel||!separate||panel.querySelector('#confirmRecurringSingleEvent')||!lastCandidateName)return;
    enhancing=true;
    try{
      const card=separate.closest('.card');if(!card)return;
      const occurrenceCount=card.querySelectorAll('.event-occurrence-row').length||1;
      const heading=card.querySelector('.event-manager-head h3'),intro=card.querySelector('.event-manager-head p');
      if(heading)heading.textContent='Recurring event detected';
      if(intro)intro.innerHTML='MakLom found <strong>'+esc(lastCandidateName)+'</strong> across '+occurrenceCount+' occurrence'+(occurrenceCount===1?'':'s')+'. Choose whether these should sit under one event header or be created as separate structured events.';
      const warning=card.querySelector('.notice.warn');
      if(warning){warning.classList.remove('warn');warning.classList.add('neutral');warning.innerHTML='<strong>One event header:</strong> the event will span from the first to last occurrence, while each dated occurrence remains a separate shift underneath it. This is suitable for recurring programmes spread across weeks or months.';}
      const row=separate.closest('.row')||separate.parentElement;
      const unified=document.createElement('button');unified.id='confirmRecurringSingleEvent';unified.type='button';unified.className='primary';unified.dataset.candidateName=lastCandidateName;unified.textContent='Keep as 1 event & assign rows';
      row.insertBefore(unified,separate);
      separate.classList.remove('primary');separate.classList.add('small');separate.textContent='Create '+occurrenceCount+' separate event'+(occurrenceCount===1?'':'s');
      unified.addEventListener('click',function(){createUnifiedEvent(unified);});
    }finally{enhancing=false;}
  }

  document.addEventListener('click',function(event){
    const candidate=event.target.closest&&event.target.closest('[data-candidate-name]');
    if(candidate)lastCandidateName=clean(candidate.dataset.candidateName);
  },true);

  document.addEventListener('DOMContentLoaded',function(){
    const main=document.querySelector('main');if(main)new MutationObserver(enhanceOccurrencePreview).observe(main,{childList:true,subtree:true});
    setTimeout(enhanceOccurrencePreview,700);
  });
})();
