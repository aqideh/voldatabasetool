(function installEventRowAssignment(){
  'use strict';
  const S=window.MaklomSharedDB;
  if(!S)return;

  const state={activeEventId:'',event:null,shifts:[],rows:[],selected:new Set(),query:'',loading:false,loadedEventId:''};
  let enhanceQueued=false;

  function esc(value){return typeof escapeHtml==='function'?escapeHtml(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function clean(value){return String(value==null?'':value).trim();}
  function canWrite(){return !!(S.getAccessState&&S.getAccessState().canWrite);}
  function formatDate(value){const raw=clean(value).slice(0,10),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+m[2]+m[1].slice(-2):(raw||'—');}
  function formatDuration(minutes){const total=Math.max(0,Number(minutes)||0),h=Math.floor(total/60),m=total%60;if(h&&m)return h+'h '+m+'m';if(h)return h+'h';if(m)return m+'m';return'0m';}
  function normal(value){return clean(value).toLowerCase();}

  function injectStyles(){
    if(document.getElementById('event-row-assignment-style'))return;
    const style=document.createElement('style');style.id='event-row-assignment-style';style.textContent='\
#eventRowAssignment{border-top:1px solid #e1e5e9;padding-top:18px}\
.event-assign-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}\
.event-assign-head h4{margin:0 0 4px}\
.event-assign-head p{margin:0}\
.event-assign-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,260px);gap:10px;align-items:end}\
.event-assign-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}\
.event-assign-actions .primary{margin-left:auto}\
.event-assign-list{border:1px solid #e1e5e9;border-radius:10px;overflow:auto;max-height:430px}\
.event-assign-table{width:100%;border-collapse:collapse;font-size:.9rem}\
.event-assign-table th,.event-assign-table td{padding:9px 10px;border-bottom:1px solid #edf0f2;text-align:left;vertical-align:middle}\
.event-assign-table th{position:sticky;top:0;background:#fff;z-index:1;white-space:nowrap}\
.event-assign-table tr:last-child td{border-bottom:0}\
.event-assign-table td:first-child,.event-assign-table th:first-child{width:38px;text-align:center}\
.event-assign-source{min-width:220px}\
.event-assign-person strong{display:block}\
.event-assign-person span{display:block;font-size:.8rem;color:#69727d}\
.event-assign-status{white-space:nowrap}\
.event-assign-empty{padding:18px;color:#69727d}\
.event-assign-meta{font-size:.82rem;color:#69727d}\
@media(max-width:760px){.event-assign-controls{grid-template-columns:1fr}.event-assign-actions .primary{margin-left:0;width:100%}.event-assign-list{max-height:520px}.event-assign-table th:nth-child(3),.event-assign-table td:nth-child(3),.event-assign-table th:nth-child(5),.event-assign-table td:nth-child(5){display:none}.event-assign-source{min-width:180px}}';document.head.appendChild(style);
  }

  async function apiRows(path){const response=await S.apiFetch('/rest/v1/'+path,{method:'GET'});if(!response.ok)throw new Error(await response.text());return response.json();}

  async function loadEvent(eventId,resetQuery){
    if(!eventId||state.loading)return;
    state.loading=true;
    try{
      const results=await Promise.all([
        apiRows('events?select=id,name,start_date,end_date&id=eq.'+encodeURIComponent(eventId)),
        apiRows('event_shifts?select=id,event_id,name,shift_date,start_time,end_time&event_id=eq.'+encodeURIComponent(eventId)+'&order=shift_date.asc,name.asc'),
        apiRows('attendance_log?select=id,name,email,contact,attended,event_name,event_date,duration_minutes,row_version&event_id=is.null&order=event_name.asc,event_date.desc,name.asc')
      ]);
      state.event=results[0][0]||null;state.shifts=results[1]||[];state.rows=results[2]||[];state.loadedEventId=eventId;state.selected.clear();
      if(resetQuery!==false&&state.event)state.query=state.event.name||'';
      renderPanel();
    }catch(error){console.error(error);renderError(error.message);}
    finally{state.loading=false;}
  }

  function currentDetail(){return document.querySelector('#eventDetailPanel > .card');}
  function inferActiveEventId(){
    if(state.activeEventId)return state.activeEventId;
    const detail=currentDetail(),heading=detail&&detail.querySelector('.event-manager-head h3');if(!heading)return'';
    const name=clean(heading.textContent);
    const options=Array.from(document.querySelectorAll('#eventBatchEvent option[value]')).filter(function(option){return option.value;});
    const match=options.find(function(option){return clean(option.textContent).split(' · ')[0]===name;});
    return match?match.value:'';
  }

  function mountPoint(){
    const detail=currentDetail();if(!detail)return null;
    const sections=detail.querySelectorAll(':scope > .event-subsection');
    return sections.length?sections[0]:detail;
  }

  function ensurePanel(){
    const detail=currentDetail();if(!detail||!canWrite())return null;
    let panel=document.getElementById('eventRowAssignment');if(panel&&detail.contains(panel))return panel;
    panel=document.createElement('div');panel.id='eventRowAssignment';panel.className='event-subsection event-row-assignment';
    const anchor=mountPoint();if(anchor&&anchor!==detail)anchor.insertAdjacentElement('afterend',panel);else detail.appendChild(panel);
    return panel;
  }

  function filteredRows(){
    const q=normal(state.query);if(!q)return state.rows.slice();
    return state.rows.filter(function(row){const hay=[row.name,row.email,row.contact,row.event_name,row.event_date,formatDate(row.event_date),row.attended?'present':'no-show'].map(normal).join(' ');return hay.indexOf(q)>-1;});
  }

  function selectedCountIn(rows){return rows.reduce(function(total,row){return total+(state.selected.has(row.id)?1:0);},0);}

  function shiftOptions(){
    if(!state.shifts.length)return'<option value="">Event only</option>';
    return'<option value="">Choose shift</option>'+state.shifts.map(function(shift){return'<option value="'+esc(shift.id)+'">'+esc(shift.name)+' · '+esc(formatDate(shift.shift_date))+'</option>';}).join('');
  }

  function renderPanel(){
    const panel=ensurePanel();if(!panel||!state.event)return;
    const rows=filteredRows(),selected=state.selected.size,autoShift=state.shifts.length===1?state.shifts[0].id:'';
    panel.innerHTML='<div class="event-assign-head"><div><h4>Assign Event Log rows</h4><p class="muted">Link existing unassigned deployment rows to <strong>'+esc(state.event.name)+'</strong>. If the event has shifts, assign each group to the correct shift.</p></div><span class="pill neutral">'+rows.length+' shown · '+state.rows.length+' unassigned</span></div>'+
      '<div class="event-assign-controls"><label>Find rows<input id="eventAssignSearch" value="'+esc(state.query)+'" placeholder="Search volunteer or existing event name"></label><label>Shift'+(state.shifts.length?'':' (none created)')+'<select id="eventAssignShift">'+shiftOptions()+'</select></label></div>'+
      '<div class="event-assign-actions"><button id="eventAssignSelectShown" type="button" class="small">Select shown</button><button id="eventAssignClear" type="button" class="small">Clear selection</button><span class="event-assign-meta"><strong id="eventAssignSelectedCount">'+selected+'</strong> selected</span><button id="eventAssignApply" type="button" class="primary" '+(selected?'':'disabled')+'>Assign selected</button></div>'+
      '<div id="eventAssignList" class="event-assign-list">'+renderRows(rows)+'</div>';
    const shift=document.getElementById('eventAssignShift');if(shift&&autoShift)shift.value=autoShift;
    wirePanel();
  }

  function renderRows(rows){
    if(!rows.length)return'<div class="event-assign-empty">No unassigned Event Log rows match this search. Clear the search to browse all unassigned rows.</div>';
    return'<table class="event-assign-table"><thead><tr><th><input id="eventAssignToggleShown" type="checkbox" aria-label="Select all shown rows" '+(rows.length&&selectedCountIn(rows)===rows.length?'checked':'')+'></th><th>Volunteer</th><th>Existing event</th><th>Date</th><th>Status</th><th>Duration</th></tr></thead><tbody>'+rows.slice(0,250).map(function(row){return'<tr><td><input type="checkbox" data-event-assign-row="'+esc(row.id)+'" '+(state.selected.has(row.id)?'checked':'')+' aria-label="Select '+esc(row.name||'row')+'"></td><td class="event-assign-person"><strong>'+esc(row.name||'Unnamed volunteer')+'</strong><span>'+esc(row.email||row.contact||'')+'</span></td><td class="event-assign-source">'+esc(row.event_name||'No event name')+'</td><td>'+esc(formatDate(row.event_date))+'</td><td class="event-assign-status">'+(row.attended?'Present':'No-show')+'</td><td>'+esc(formatDuration(row.duration_minutes))+'</td></tr>';}).join('')+'</tbody></table>'+(rows.length>250?'<div class="event-assign-empty">Showing the first 250 matching rows. Narrow the search to see a smaller group.</div>':'');
  }

  function updateSelectionUi(){
    const count=document.getElementById('eventAssignSelectedCount'),apply=document.getElementById('eventAssignApply');if(count)count.textContent=String(state.selected.size);if(apply)apply.disabled=state.selected.size===0;
    const rows=filteredRows(),toggle=document.getElementById('eventAssignToggleShown');if(toggle)toggle.checked=!!rows.length&&selectedCountIn(rows)===rows.length;
  }

  function wirePanel(){
    const search=document.getElementById('eventAssignSearch');if(search)search.addEventListener('input',function(){state.query=search.value;renderPanel();const next=document.getElementById('eventAssignSearch');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}});
    document.querySelectorAll('[data-event-assign-row]').forEach(function(box){box.addEventListener('change',function(){if(box.checked)state.selected.add(box.dataset.eventAssignRow);else state.selected.delete(box.dataset.eventAssignRow);updateSelectionUi();});});
    const toggle=document.getElementById('eventAssignToggleShown');if(toggle)toggle.addEventListener('change',function(){filteredRows().forEach(function(row){if(toggle.checked)state.selected.add(row.id);else state.selected.delete(row.id);});renderPanel();});
    const selectShown=document.getElementById('eventAssignSelectShown');if(selectShown)selectShown.addEventListener('click',function(){filteredRows().forEach(function(row){state.selected.add(row.id);});renderPanel();});
    const clear=document.getElementById('eventAssignClear');if(clear)clear.addEventListener('click',function(){state.selected.clear();renderPanel();});
    const apply=document.getElementById('eventAssignApply');if(apply)apply.addEventListener('click',assignSelected);
  }

  async function patchRow(row,changes){
    const response=await S.apiFetch('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(changes)});
    if(!response.ok)return{ok:false,error:await response.text()};
    const updated=await response.json();return updated.length?{ok:true,row:updated[0]}:{ok:false,error:'Row changed in another browser.'};
  }

  async function assignSelected(){
    if(!state.event||!state.selected.size)return;
    const shiftSelect=document.getElementById('eventAssignShift'),shiftId=shiftSelect?shiftSelect.value:'';
    const shift=state.shifts.find(function(item){return item.id===shiftId;})||null;
    if(state.shifts.length>1&&!shift){alert('Choose a shift before assigning these rows.');return;}
    const selectedRows=state.rows.filter(function(row){return state.selected.has(row.id);});if(!selectedRows.length)return;
    const target=state.event.name+(shift?' / '+shift.name:'');
    if(!confirm('Assign '+selectedRows.length+' selected row'+(selectedRows.length===1?'':'s')+' to '+target+'?'))return;
    const button=document.getElementById('eventAssignApply');if(button){button.disabled=true;button.textContent='Assigning…';}
    let success=0;const failures=[];
    const changes={event_id:state.event.id,shift_id:shift?shift.id:null};
    for(const row of selectedRows){const result=await patchRow(row,changes);if(result.ok)success++;else failures.push({row:row,error:result.error});}
    state.selected.clear();
    if(S.refreshFromRemote)try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    await loadEvent(state.event.id,false);
    const eventsNav=document.querySelector('nav button[data-view="eventsView"]');if(eventsNav)eventsNav.click();
    if(failures.length)alert(success+' row'+(success===1?'':'s')+' assigned. '+failures.length+' could not be updated because they changed or were unavailable.');
  }

  function renderError(message){const panel=ensurePanel();if(panel)panel.innerHTML='<h4>Assign Event Log rows</h4><div class="notice bad">Could not load unassigned rows: '+esc(message)+'</div>';}

  function enhance(){
    enhanceQueued=false;injectStyles();
    const detail=currentDetail();if(!detail){return;}
    const eventId=inferActiveEventId();if(!eventId)return;
    state.activeEventId=eventId;
    if(state.loadedEventId===eventId&&state.event){if(!document.getElementById('eventRowAssignment'))renderPanel();return;}
    loadEvent(eventId,true);
  }
  function scheduleEnhance(){if(enhanceQueued)return;enhanceQueued=true;requestAnimationFrame(enhance);}

  document.addEventListener('click',function(event){
    const open=event.target.closest&&event.target.closest('[data-open-event]');if(open){state.activeEventId=open.dataset.openEvent||'';state.loadedEventId='';setTimeout(scheduleEnhance,0);return;}
    if(event.target.closest&&event.target.closest('#closeEventDetail')){state.activeEventId='';state.loadedEventId='';state.event=null;state.shifts=[];state.rows=[];state.selected.clear();}
  },true);

  document.addEventListener('DOMContentLoaded',function(){injectStyles();const manager=document.getElementById('eventManagerContent');if(manager)new MutationObserver(scheduleEnhance).observe(manager,{childList:true,subtree:true});setTimeout(scheduleEnhance,500);});
  window.addEventListener('maklom:access-state',scheduleEnhance);
  setTimeout(scheduleEnhance,900);
})();
