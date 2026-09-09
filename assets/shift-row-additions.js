(function installShiftRowAdditions(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const state={eventId:'',event:null,shifts:[],rows:[],targetShift:null,selected:new Set(),query:'',loading:false,loadedEventId:''};
  let queued=false;

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

  async function loadEvent(eventId){
    if(!eventId||state.loading)return;
    state.loading=true;
    try{
      const results=await Promise.all([
        apiRows('events?select=id,name,start_date,end_date&id=eq.'+encodeURIComponent(eventId)),
        apiRows('event_shifts?select=id,event_id,name,shift_date,start_time,end_time&event_id=eq.'+encodeURIComponent(eventId)+'&order=shift_date.asc,name.asc'),
        apiRows('attendance_log?select=id,name,email,contact,attended,event_name,event_date,duration_minutes,event_id,shift_id,row_version&event_id=is.null&order=event_date.desc,event_name.asc,name.asc')
      ]);
      state.event=results[0][0]||null;state.shifts=results[1]||[];state.rows=results[2]||[];state.loadedEventId=eventId;state.eventId=eventId;
      if(state.targetShift&&!state.shifts.some(function(shift){return shift.id===state.targetShift.id;}))closePanel();
      enhanceShiftRows();
      if(state.targetShift)renderPanel();
    }catch(error){console.error(error);renderError(error.message);}
    finally{state.loading=false;}
  }

  function shiftSection(){const detail=currentDetail();if(!detail)return null;return Array.from(detail.querySelectorAll(':scope > .event-subsection')).find(function(section){const h=section.querySelector(':scope > h4');return h&&clean(h.textContent)==='Shifts';})||null;}

  function enhanceShiftRows(){
    const section=shiftSection();if(!section||!canWrite())return;
    section.querySelectorAll('.event-shift-row').forEach(function(row){
      if(row.querySelector('[data-add-rows-to-shift]'))return;
      const edit=row.querySelector('[data-edit-shift]'),del=row.querySelector('[data-delete-shift]');
      const shiftId=edit?edit.dataset.editShift:(del?del.dataset.deleteShift:'');if(!shiftId)return;
      const actions=row.querySelector('.event-inline-actions')||row.lastElementChild;if(!actions)return;
      const button=document.createElement('button');button.type='button';button.className='small';button.dataset.addRowsToShift=shiftId;button.textContent='+ Add rows';
      actions.insertBefore(button,actions.firstChild);
    });
  }

  function panelMount(){
    const section=shiftSection();if(!section)return null;
    let panel=section.querySelector('#shiftAddRowsPanel');
    if(!panel){panel=document.createElement('div');panel.id='shiftAddRowsPanel';panel.className='shift-assigned-panel shift-add-rows-panel';const anchor=section.querySelector('#shiftAssignedRowsPanel')||section.querySelector('#newShiftName')&&section.querySelector('#newShiftName').closest('.grid');if(anchor)section.insertBefore(panel,anchor);else section.appendChild(panel);}
    return panel;
  }

  function filteredRows(){
    const q=normal(state.query);if(!q)return state.rows.slice();
    return state.rows.filter(function(row){const hay=[row.name,row.email,row.contact,row.event_name,row.event_date,fmtDate(row.event_date),row.attended?'present':'no-show',fmtDuration(row.duration_minutes)].map(normal).join(' ');return hay.indexOf(q)>-1;});
  }

  function renderPanel(){
    const panel=panelMount();if(!panel||!state.event||!state.targetShift)return;
    const rows=filteredRows(),selected=state.selected.size,shift=state.targetShift;
    panel.innerHTML='<div class="shift-assigned-head"><div><h5>Add Event Log rows to '+esc(shift.name)+'</h5><p class="muted">Choose existing unassigned deployment rows. They will be linked directly to <strong>'+esc(state.event.name)+' / '+esc(shift.name)+'</strong> without creating duplicate attendance records.</p></div><button id="closeShiftAddRows" type="button" class="small">Close</button></div>'+
      '<div class="shift-add-summary"><span class="pill neutral">'+esc(fmtDate(shift.shift_date))+'</span><span class="pill neutral">'+state.rows.length+' unassigned rows available</span></div>'+
      '<div class="shift-assigned-controls"><label>Find unassigned rows<input id="shiftAddSearch" value="'+esc(state.query)+'" placeholder="Search volunteer, source event, date, email"></label></div>'+
      '<div class="shift-assigned-actions"><button id="shiftAddSelectShown" type="button" class="small">Select shown</button><button id="shiftAddClear" type="button" class="small">Clear selection</button><span class="muted"><strong id="shiftAddSelectedCount">'+selected+'</strong> selected</span><button id="shiftAddApply" type="button" class="primary" '+(selected?'':'disabled')+'>Add selected to shift</button></div>'+
      '<div class="shift-assigned-list">'+renderRows(rows)+'</div>';
    wirePanel();
  }

  function renderRows(rows){
    if(!rows.length)return'<div class="shift-assigned-empty">No unassigned Event Log rows match this search.</div>';
    const shown=rows.slice(0,250);
    return'<table class="shift-assigned-table"><thead><tr><th><input id="shiftAddToggleShown" type="checkbox" aria-label="Select all shown" '+(shown.length&&shown.every(function(row){return state.selected.has(row.id);})?'checked':'')+'></th><th>Volunteer</th><th>Existing event</th><th>Date</th><th>Status</th><th>Duration</th></tr></thead><tbody>'+shown.map(function(row){return'<tr><td><input type="checkbox" data-shift-add-row="'+esc(row.id)+'" '+(state.selected.has(row.id)?'checked':'')+'></td><td><strong>'+esc(row.name||'Unnamed volunteer')+'</strong><span class="shift-assigned-contact">'+esc(row.email||row.contact||'')+'</span></td><td>'+esc(row.event_name||'No event name')+'</td><td>'+esc(fmtDate(row.event_date))+'</td><td>'+(row.attended?'Present':'No-show')+'</td><td>'+esc(fmtDuration(row.duration_minutes))+'</td></tr>';}).join('')+'</tbody></table>'+(rows.length>250?'<div class="shift-assigned-empty">Showing the first 250 matching rows. Narrow the search to see a smaller group.</div>':'');
  }

  function updateSelectionUi(){const count=document.getElementById('shiftAddSelectedCount'),apply=document.getElementById('shiftAddApply');if(count)count.textContent=String(state.selected.size);if(apply)apply.disabled=!state.selected.size;const shown=filteredRows().slice(0,250),toggle=document.getElementById('shiftAddToggleShown');if(toggle)toggle.checked=!!shown.length&&shown.every(function(row){return state.selected.has(row.id);});}

  function wirePanel(){
    const close=document.getElementById('closeShiftAddRows');if(close)close.addEventListener('click',closePanel);
    const search=document.getElementById('shiftAddSearch');if(search)search.addEventListener('input',function(){state.query=search.value;renderPanel();const next=document.getElementById('shiftAddSearch');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}});
    document.querySelectorAll('[data-shift-add-row]').forEach(function(box){box.addEventListener('change',function(){if(box.checked)state.selected.add(box.dataset.shiftAddRow);else state.selected.delete(box.dataset.shiftAddRow);updateSelectionUi();});});
    const toggle=document.getElementById('shiftAddToggleShown');if(toggle)toggle.addEventListener('change',function(){filteredRows().slice(0,250).forEach(function(row){if(toggle.checked)state.selected.add(row.id);else state.selected.delete(row.id);});renderPanel();});
    const select=document.getElementById('shiftAddSelectShown');if(select)select.addEventListener('click',function(){filteredRows().slice(0,250).forEach(function(row){state.selected.add(row.id);});renderPanel();});
    const clear=document.getElementById('shiftAddClear');if(clear)clear.addEventListener('click',function(){state.selected.clear();renderPanel();});
    const apply=document.getElementById('shiftAddApply');if(apply)apply.addEventListener('click',addSelected);
  }

  async function patchRow(row){
    const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({event_id:state.event.id,shift_id:state.targetShift.id})});
    if(!response.ok)return{ok:false,error:await response.text()};
    const updated=await response.json();return updated.length?{ok:true,row:updated[0]}:{ok:false,error:'Row changed in another browser.'};
  }

  async function addSelected(){
    if(!state.event||!state.targetShift||!state.selected.size)return;
    const rows=state.rows.filter(function(row){return state.selected.has(row.id);});if(!rows.length)return;
    if(!confirm('Add '+rows.length+' selected row'+(rows.length===1?'':'s')+' to '+state.event.name+' / '+state.targetShift.name+'?'))return;
    const button=document.getElementById('shiftAddApply');if(button){button.disabled=true;button.textContent='Adding…';}
    let success=0;const failures=[];
    for(const row of rows){const result=await patchRow(row);if(result.ok)success++;else failures.push({row:row,error:result.error});}
    state.selected.clear();
    if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    const eventId=state.eventId,targetId=state.targetShift.id;
    await loadEvent(eventId);
    state.targetShift=state.shifts.find(function(shift){return shift.id===targetId;})||null;
    if(state.targetShift)renderPanel();
    if(failures.length)alert(success+' row'+(success===1?'':'s')+' added. '+failures.length+' could not be updated because they changed or were unavailable.');
  }

  function closePanel(){state.targetShift=null;state.selected.clear();state.query='';const panel=document.getElementById('shiftAddRowsPanel');if(panel)panel.remove();}
  function renderError(message){const section=shiftSection();if(!section)return;let box=section.querySelector('#shiftAddRowsError');if(!box){box=document.createElement('div');box.id='shiftAddRowsError';box.className='notice bad';section.appendChild(box);}box.textContent='Could not load unassigned Event Log rows: '+message;}

  function enhance(){queued=false;const detail=currentDetail();if(!detail||!canWrite())return;const eventId=inferEventId();if(!eventId)return;state.eventId=eventId;if(state.loadedEventId===eventId&&state.event){enhanceShiftRows();return;}loadEvent(eventId);}
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(enhance);}

  document.addEventListener('click',function(event){
    const open=event.target.closest&&event.target.closest('[data-open-event]');if(open){state.eventId=open.dataset.openEvent||'';state.loadedEventId='';closePanel();setTimeout(schedule,0);return;}
    const add=event.target.closest&&event.target.closest('[data-add-rows-to-shift]');if(add){const shift=state.shifts.find(function(item){return item.id===add.dataset.addRowsToShift;});if(!shift)return;state.targetShift=shift;state.selected.clear();state.query=state.event?state.event.name:'';renderPanel();return;}
    if(event.target.closest&&event.target.closest('#closeEventDetail')){state.eventId='';state.loadedEventId='';state.event=null;state.shifts=[];state.rows=[];closePanel();}
  },true);

  document.addEventListener('DOMContentLoaded',function(){const manager=document.getElementById('eventManagerContent');if(manager)new MutationObserver(schedule).observe(manager,{childList:true,subtree:true});setTimeout(schedule,650);});
  window.addEventListener('maklom:access-state',schedule);
  setTimeout(schedule,1050);
})();
