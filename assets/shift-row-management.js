(function installShiftRowManagement(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const state={eventId:'',event:null,shifts:[],rows:[],activeKey:'',selected:new Set(),query:'',loading:false,loadedEventId:''};
  let enhanceQueued=false;

  function clean(value){return String(value==null?'':value).trim();}
  function esc(value){return typeof escapeHtml==='function'?escapeHtml(clean(value)):clean(value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function canWrite(){return !!(S.getAccessState&&S.getAccessState().canWrite);}
  function fmtDate(value){const raw=clean(value).slice(0,10);if(window.MaklomDateDisplay&&window.MaklomDateDisplay.format)return window.MaklomDateDisplay.format(raw);const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+m[2]+m[1].slice(-2):(raw||'—');}
  function fmtDuration(minutes){const total=Math.max(0,Number(minutes)||0),h=Math.floor(total/60),m=total%60;if(h&&m)return h+'h '+m+'m';if(h)return h+'h';if(m)return m+'m';return'0m';}
  function normal(value){return clean(value).toLowerCase();}

  async function apiRows(path){const response=await S.apiFetch('/rest/v1/'+path,{method:'GET'});if(!response.ok)throw new Error(await response.text());return response.json();}

  function currentDetail(){return document.querySelector('#eventDetailPanel > .card');}
  function inferEventId(){
    if(state.eventId)return state.eventId;
    const detail=currentDetail(),heading=detail&&detail.querySelector('.event-manager-head h3');if(!heading)return'';
    const name=clean(heading.textContent);
    const options=Array.from(document.querySelectorAll('#eventBatchEvent option[value]')).filter(function(option){return option.value;});
    const match=options.find(function(option){return clean(option.textContent).split(' · ')[0]===name;});
    return match?match.value:'';
  }

  async function loadEvent(eventId,preserveActive){
    if(!eventId||state.loading)return;
    state.loading=true;
    try{
      const results=await Promise.all([
        apiRows('events?select=id,name,start_date,end_date&id=eq.'+encodeURIComponent(eventId)),
        apiRows('event_shifts?select=id,event_id,name,shift_date,start_time,end_time&event_id=eq.'+encodeURIComponent(eventId)+'&order=shift_date.asc,name.asc'),
        apiRows('attendance_log?select=id,name,email,contact,attended,event_name,event_date,duration_minutes,event_id,shift_id,row_version&event_id=eq.'+encodeURIComponent(eventId)+'&order=event_date.asc,name.asc')
      ]);
      state.event=results[0][0]||null;state.shifts=results[1]||[];state.rows=results[2]||[];state.loadedEventId=eventId;state.eventId=eventId;
      if(!preserveActive||!validActiveKey(state.activeKey))state.activeKey='';
      state.selected.clear();
      enhanceShiftRows();
      if(state.activeKey)renderPanel();else removePanel();
    }catch(error){console.error(error);renderLoadError(error.message);}
    finally{state.loading=false;}
  }

  function validActiveKey(key){return key==='event-only'||state.shifts.some(function(shift){return shift.id===key;});}
  function shiftFor(id){return state.shifts.find(function(shift){return shift.id===id;})||null;}
  function rowsForKey(key){return key==='event-only'?state.rows.filter(function(row){return !row.shift_id;}):state.rows.filter(function(row){return row.shift_id===key;});}

  function shiftSection(){const detail=currentDetail();if(!detail)return null;return Array.from(detail.querySelectorAll(':scope > .event-subsection')).find(function(section){const h=section.querySelector(':scope > h4');return h&&clean(h.textContent)==='Shifts';})||null;}

  function enhanceShiftRows(){
    const section=shiftSection();if(!section||!canWrite())return;
    section.querySelectorAll('.event-shift-row').forEach(function(row){
      if(row.querySelector('[data-manage-shift-rows]'))return;
      const edit=row.querySelector('[data-edit-shift]'),del=row.querySelector('[data-delete-shift]');
      const shiftId=edit?edit.dataset.editShift:(del?del.dataset.deleteShift:'');if(!shiftId)return;
      const actions=row.querySelector('.event-inline-actions')||row.lastElementChild;if(!actions)return;
      const count=rowsForKey(shiftId).length;
      const button=document.createElement('button');button.type='button';button.className='small';button.dataset.manageShiftRows=shiftId;button.textContent='Rows ('+count+')';button.setAttribute('aria-expanded',state.activeKey===shiftId?'true':'false');
      actions.insertBefore(button,actions.firstChild);
    });
    const eventOnly=state.rows.filter(function(row){return !row.shift_id;}).length;
    let button=section.querySelector('[data-manage-event-only]');
    if(eventOnly&&!button){button=document.createElement('button');button.type='button';button.className='small';button.dataset.manageEventOnly='true';const addForm=section.querySelector('#newShiftName');const anchor=addForm&&addForm.closest('.grid');if(anchor)section.insertBefore(button,anchor);else section.appendChild(button);}
    if(button){button.textContent='Event-only rows ('+eventOnly+')';button.hidden=!eventOnly;button.setAttribute('aria-expanded',state.activeKey==='event-only'?'true':'false');}
  }

  function panelMount(){const section=shiftSection();if(!section)return null;let panel=section.querySelector('#shiftAssignedRowsPanel');if(!panel){panel=document.createElement('div');panel.id='shiftAssignedRowsPanel';panel.className='shift-assigned-panel';const addForm=section.querySelector('#newShiftName');const anchor=addForm&&addForm.closest('.grid');if(anchor)section.insertBefore(panel,anchor);else section.appendChild(panel);}return panel;}
  function removePanel(){const panel=document.getElementById('shiftAssignedRowsPanel');if(panel)panel.remove();}

  function filteredRows(){const rows=rowsForKey(state.activeKey),q=normal(state.query);if(!q)return rows;return rows.filter(function(row){return [row.name,row.email,row.contact,row.event_name,row.event_date,row.attended?'present':'no-show',fmtDuration(row.duration_minutes)].map(normal).join(' ').indexOf(q)>-1;});}
  function sourceLabel(){if(state.activeKey==='event-only')return'Event only';const shift=shiftFor(state.activeKey);return shift?shift.name:'Shift';}

  function destinationOptions(){
    const current=state.activeKey;
    let html='<option value="">Choose destination</option>';
    state.shifts.forEach(function(shift){html+='<option value="shift:'+esc(shift.id)+'" '+(shift.id===current?'disabled':'')+'>'+esc(shift.name)+' · '+esc(fmtDate(shift.shift_date))+(shift.id===current?' (current)':'')+'</option>';});
    html+='<option value="event-only" '+(current==='event-only'?'disabled':'')+'>Event only (no shift)</option><option value="unassigned">Unassigned Event Log pool</option>';
    return html;
  }

  function renderPanel(){
    const panel=panelMount();if(!panel||!state.event||!state.activeKey)return;
    const all=rowsForKey(state.activeKey),rows=filteredRows(),selected=state.selected.size;
    panel.innerHTML='<div class="shift-assigned-head"><div><h5>'+esc(sourceLabel())+' · Assigned rows</h5><p class="muted">Review the Event Log rows currently linked here. Select rows to move them to another shift, keep them at event level, or return them to the unassigned pool.</p></div><button id="closeShiftAssignedRows" type="button" class="small">Close</button></div>'+
      '<div class="shift-assigned-controls"><label>Find assigned row<input id="shiftAssignedSearch" value="'+esc(state.query)+'" placeholder="Search volunteer, email, status"></label><label>Move to<select id="shiftAssignedDestination">'+destinationOptions()+'</select></label></div>'+
      '<div class="shift-assigned-actions"><button id="shiftAssignedSelectShown" type="button" class="small">Select shown</button><button id="shiftAssignedClear" type="button" class="small">Clear selection</button><span class="muted"><strong id="shiftAssignedSelectedCount">'+selected+'</strong> selected · '+all.length+' assigned</span><button id="shiftAssignedMove" type="button" class="primary" '+(selected?'':'disabled')+'>Move selected</button></div>'+
      '<div class="shift-assigned-list">'+renderRows(rows)+'</div>';
    wirePanel();
  }

  function renderRows(rows){
    if(!rows.length)return'<div class="shift-assigned-empty">No assigned rows match this search.</div>';
    const shown=rows.slice(0,250);
    return'<table class="shift-assigned-table"><thead><tr><th><input id="shiftAssignedToggleShown" type="checkbox" aria-label="Select all shown" '+(shown.length&&shown.every(function(row){return state.selected.has(row.id);})?'checked':'')+'></th><th>Volunteer</th><th>Date</th><th>Status</th><th>Duration</th></tr></thead><tbody>'+shown.map(function(row){return'<tr><td><input type="checkbox" data-shift-assigned-row="'+esc(row.id)+'" '+(state.selected.has(row.id)?'checked':'')+'></td><td><strong>'+esc(row.name||'Unnamed volunteer')+'</strong><span class="shift-assigned-contact">'+esc(row.email||row.contact||'')+'</span></td><td>'+esc(fmtDate(row.event_date))+'</td><td>'+(row.attended?'Present':'No-show')+'</td><td>'+esc(fmtDuration(row.duration_minutes))+'</td></tr>';}).join('')+'</tbody></table>'+(rows.length>250?'<div class="shift-assigned-empty">Showing the first 250 matching rows. Narrow the search to see a smaller group.</div>':'');
  }

  function updateSelectionUi(){const count=document.getElementById('shiftAssignedSelectedCount'),move=document.getElementById('shiftAssignedMove');if(count)count.textContent=String(state.selected.size);if(move)move.disabled=!state.selected.size;const shown=filteredRows().slice(0,250),toggle=document.getElementById('shiftAssignedToggleShown');if(toggle)toggle.checked=!!shown.length&&shown.every(function(row){return state.selected.has(row.id);});}

  function wirePanel(){
    const close=document.getElementById('closeShiftAssignedRows');if(close)close.addEventListener('click',function(){state.activeKey='';state.selected.clear();state.query='';enhanceShiftRows();removePanel();});
    const search=document.getElementById('shiftAssignedSearch');if(search)search.addEventListener('input',function(){state.query=search.value;renderPanel();const next=document.getElementById('shiftAssignedSearch');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}});
    document.querySelectorAll('[data-shift-assigned-row]').forEach(function(box){box.addEventListener('change',function(){if(box.checked)state.selected.add(box.dataset.shiftAssignedRow);else state.selected.delete(box.dataset.shiftAssignedRow);updateSelectionUi();});});
    const toggle=document.getElementById('shiftAssignedToggleShown');if(toggle)toggle.addEventListener('change',function(){filteredRows().slice(0,250).forEach(function(row){if(toggle.checked)state.selected.add(row.id);else state.selected.delete(row.id);});renderPanel();});
    const select=document.getElementById('shiftAssignedSelectShown');if(select)select.addEventListener('click',function(){filteredRows().slice(0,250).forEach(function(row){state.selected.add(row.id);});renderPanel();});
    const clear=document.getElementById('shiftAssignedClear');if(clear)clear.addEventListener('click',function(){state.selected.clear();renderPanel();});
    const move=document.getElementById('shiftAssignedMove');if(move)move.addEventListener('click',moveSelected);
  }

  async function patchRow(row,changes){const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(changes)});if(!response.ok)return{ok:false,error:await response.text()};const updated=await response.json();return updated.length?{ok:true,row:updated[0]}:{ok:false,error:'Row changed in another browser.'};}

  async function moveSelected(){
    if(!state.selected.size)return;
    const select=document.getElementById('shiftAssignedDestination'),destination=select?select.value:'';if(!destination){alert('Choose a destination first.');return;}
    const sourceRows=rowsForKey(state.activeKey).filter(function(row){return state.selected.has(row.id);});if(!sourceRows.length)return;
    let changes,targetLabel;
    if(destination.indexOf('shift:')===0){const shiftId=destination.slice(6),shift=shiftFor(shiftId);if(!shift){alert('That shift is no longer available. Reload and try again.');return;}changes={event_id:state.event.id,shift_id:shift.id};targetLabel=state.event.name+' / '+shift.name;}
    else if(destination==='event-only'){changes={event_id:state.event.id,shift_id:null};targetLabel=state.event.name+' / Event only';}
    else{changes={event_id:null,shift_id:null};targetLabel='Unassigned Event Log pool';}
    if(!confirm('Move '+sourceRows.length+' row'+(sourceRows.length===1?'':'s')+' from '+sourceLabel()+' to '+targetLabel+'?'))return;
    const button=document.getElementById('shiftAssignedMove');if(button){button.disabled=true;button.textContent='Moving…';}
    let success=0;const failures=[];
    for(const row of sourceRows){const result=await patchRow(row,changes);if(result.ok)success++;else failures.push({row:row,error:result.error});}
    state.selected.clear();
    if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    const eventsNav=document.querySelector('nav button[data-view="eventsView"]');if(eventsNav)eventsNav.click();
    setTimeout(function(){loadEvent(state.eventId,true);},150);
    if(failures.length)alert(success+' row'+(success===1?'':'s')+' moved. '+failures.length+' could not be updated because they changed or were unavailable.');
  }

  function renderLoadError(message){const section=shiftSection();if(!section)return;let box=section.querySelector('#shiftAssignedRowsError');if(!box){box=document.createElement('div');box.id='shiftAssignedRowsError';box.className='notice bad';section.appendChild(box);}box.textContent='Could not load assigned shift rows: '+message;}

  function enhance(){
    enhanceQueued=false;const detail=currentDetail();if(!detail||!canWrite())return;const eventId=inferEventId();if(!eventId)return;state.eventId=eventId;
    if(state.loadedEventId===eventId&&state.event){enhanceShiftRows();if(state.activeKey&&!document.getElementById('shiftAssignedRowsPanel'))renderPanel();return;}
    loadEvent(eventId,false);
  }
  function scheduleEnhance(){if(enhanceQueued)return;enhanceQueued=true;requestAnimationFrame(enhance);}

  document.addEventListener('click',function(event){
    const open=event.target.closest&&event.target.closest('[data-open-event]');if(open){state.eventId=open.dataset.openEvent||'';state.loadedEventId='';state.activeKey='';setTimeout(scheduleEnhance,0);return;}
    const manage=event.target.closest&&event.target.closest('[data-manage-shift-rows]');if(manage){state.activeKey=manage.dataset.manageShiftRows||'';state.selected.clear();state.query='';enhanceShiftRows();renderPanel();return;}
    const eventOnly=event.target.closest&&event.target.closest('[data-manage-event-only]');if(eventOnly){state.activeKey='event-only';state.selected.clear();state.query='';enhanceShiftRows();renderPanel();return;}
    if(event.target.closest&&event.target.closest('#closeEventDetail')){state.eventId='';state.loadedEventId='';state.event=null;state.shifts=[];state.rows=[];state.activeKey='';state.selected.clear();state.query='';}
  },true);

  document.addEventListener('DOMContentLoaded',function(){const manager=document.getElementById('eventManagerContent');if(manager)new MutationObserver(scheduleEnhance).observe(manager,{childList:true,subtree:true});setTimeout(scheduleEnhance,600);});
  window.addEventListener('maklom:access-state',scheduleEnhance);
  setTimeout(scheduleEnhance,1000);
})();
