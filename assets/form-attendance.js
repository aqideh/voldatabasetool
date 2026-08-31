(function initFormAttendance(){
  'use strict';
  const C=window.MaklomFormReconciliationCore;
  if(!C)return;

  const state={
    signIns:[],signOuts:[],staged:[],persisted:[],batches:[],submissions:[],
    batchId:'',signInFile:'',signOutFile:'',activeTab:'attendance',busy:false,
    search:'',eventFilter:'',statusFilter:'',summaryFrom:'',summaryTo:''
  };

  function S(){return window.MaklomSharedDB;}
  function byId(id){return document.getElementById(id);}
  function clean(v){return C.clean(v);}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function sharedReady(){return !!(S()&&S().ready);}
  function canWrite(){return !!(S()&&S().ready&&S().canWrite&&S().canWrite());}
  function status(message,type){const el=byId('formAttendanceStatus');if(!el)return;el.innerHTML=message?'<div class="notice '+(type||'ok')+'">'+esc(message)+'</div>':'';}
  function setBusy(value){state.busy=!!value;render();}
  function sourceOf(s){return s.signIn||s.signOut||{};}
  function originalIn(s){return s.signIn&&s.signIn.timestamp&&s.signIn.timestamp.iso||'';}
  function originalOut(s){return s.signOut&&s.signOut.timestamp&&s.signOut.timestamp.iso||'';}
  function effectiveIn(s){return s.signInAt||originalIn(s)||'';}
  function effectiveOut(s){return s.signOutAt||originalOut(s)||'';}
  function sessionTime(s){const value=effectiveIn(s)||effectiveOut(s)||sourceOf(s).timestamp&&sourceOf(s).timestamp.iso||'';const ms=Date.parse(value);return Number.isFinite(ms)?ms:Number.MAX_SAFE_INTEGER;}
  function sortOldest(list){return(list||[]).slice().sort(function(a,b){const d=sessionTime(a)-sessionTime(b);if(d)return d;return(clean(a.eventName)||'').localeCompare(clean(b.eventName)||'')||clean(sourceOf(a).name).localeCompare(clean(sourceOf(b).name));});}
  function formatDateTime(iso){if(!iso)return'—';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return iso;return d.toLocaleString('en-SG',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'});}
  function formatTime(iso){if(!iso)return'—';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return iso;return d.toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'});}
  function localInputValue(iso){
    if(!iso)return'';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return'';
    const parts={};new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(function(p){parts[p.type]=p.value;});
    return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
  }
  function singaporeIso(value){if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;const iso=value+':00+08:00';return Number.isFinite(Date.parse(iso))?iso:null;}
  function minutesBetween(a,b){if(!a||!b)return null;const delta=Math.round((Date.parse(b)-Date.parse(a))/60000);return Number.isFinite(delta)&&delta>=0?delta:null;}
  function volunteerName(id){const v=(appData.volunteers||[]).find(function(row){return row.id===id;});return v?v.name:'';}
  function databaseMatchLabel(s){const id=s.volunteerMatch&&s.volunteerMatch.id||s.volunteerId||'';if(!id)return'No main-database match';const name=volunteerName(id)||s.volunteerMatch&&s.volunteerMatch.name||'Matched volunteer';return'Matched to '+name;}
  function flagLabel(flag){return({missing_sign_in:'Missing sign-in',missing_sign_out:'Missing sign-out',event_mismatch:'Event mismatch',possible_duplicate:'Possible duplicate',long_duration:'Long duration',volunteer_unmatched:'No main-database match',volunteer_ambiguous:'Ambiguous main-database match',manual_time_edit:'Time amended manually',invalid_time_order:'Sign-out before sign-in'})[flag]||String(flag||'').replace(/_/g,' ');}
  function isTimeFlag(flag){return['missing_sign_in','missing_sign_out','long_duration','manual_time_edit','invalid_time_order'].indexOf(flag)>-1;}
  function refreshTimeFields(s){
    const inAt=effectiveIn(s),outAt=effectiveOut(s),base=(s.reviewFlags||[]).filter(function(f){return !isTimeFlag(f);});
    if(!inAt)base.push('missing_sign_in');if(!outAt)base.push('missing_sign_out');
    let calculated=null;if(inAt&&outAt){const raw=Math.round((Date.parse(outAt)-Date.parse(inAt))/60000);if(Number.isFinite(raw)&&raw>=0){calculated=raw;if(raw>600)base.push('long_duration');}else base.push('invalid_time_order');}
    if((inAt||'')!==(originalIn(s)||'')||(outAt||'')!==(originalOut(s)||''))base.push('manual_time_edit');
    s.signInAt=inAt||null;s.signOutAt=outAt||null;s.calculatedMinutes=calculated;s.reviewFlags=Array.from(new Set(base));
    s.matchStatus=!inAt?'missing_sign_in':(!outAt?'missing_sign_out':'matched');
  }
  function prepareSession(s){
    if(s.signInAt===undefined)s.signInAt=originalIn(s)||null;if(s.signOutAt===undefined)s.signOutAt=originalOut(s)||null;
    if(s.staffCreditedMinutes===undefined)s.staffCreditedMinutes=null;if(s.staffCreditNote===undefined)s.staffCreditNote='';
    if(s.included===undefined)s.included=true;refreshTimeFields(s);return s;
  }

  function install(){
    const view=byId('formAttendanceView');if(!view)return;
    const tabs=view.querySelector('[data-form-attendance-tabs]');if(tabs)tabs.addEventListener('click',function(e){const b=e.target.closest('[data-fa-tab]');if(!b)return;state.activeTab=b.dataset.faTab;render();});
    const body=byId('formAttendanceContent');if(body){body.addEventListener('click',handleClick);body.addEventListener('change',handleChange);body.addEventListener('input',handleInput);}
    const nav=document.querySelector('nav button[data-view="formAttendanceView"]');if(nav)nav.addEventListener('click',function(){loadPersisted().catch(function(error){console.error(error);status('Could not load Form Attendance data: '+error.message,'bad');});});
    render();setTimeout(function(){if(sharedReady())loadPersisted().catch(function(){/* retry on tab open */});},700);
  }

  function render(){
    const view=byId('formAttendanceView');if(!view)return;
    view.querySelectorAll('[data-fa-tab]').forEach(function(b){b.classList.toggle('active',b.dataset.faTab===state.activeTab);});
    const body=byId('formAttendanceContent');if(!body)return;
    if(state.activeTab==='shirts')body.innerHTML=renderShirts();
    else if(state.activeTab==='feedback')body.innerHTML=renderFeedback();
    else if(state.activeTab==='imports')body.innerHTML=renderImports();
    else body.innerHTML=renderAttendance();
  }

  function renderAttendance(){
    let html='';
    if(sharedReady()&&!canWrite())html+='<div class="notice warn">This account can view Form Attendance but cannot amend or save it.</div>';
    html+='<div class="fa-import-card"><div class="fa-upload-grid"><label><strong>Sign-in CSV</strong><span>Identity, event, timestamp and T-shirts</span><input id="faSignInFile" type="file" accept=".csv,text/csv"></label><label><strong>Sign-out CSV</strong><span>Identity, event, timestamp and feedback</span><input id="faSignOutFile" type="file" accept=".csv,text/csv"></label></div><div class="fa-actions"><button id="faAnalyse" class="primary" type="button" '+(state.busy?'disabled':'')+'>'+(state.busy?'Working…':'Analyse files')+'</button><span class="muted">This saves only to Form Attendance. It does not alter the Central Database or Event Log.</span></div></div>';
    if(state.staged.length)html+=renderStaged();
    html+=renderSavedList();
    return html;
  }

  function renderStaged(){
    const sessions=sortOldest(state.staged),flags=sessions.filter(function(s){return(s.reviewFlags||[]).length;}).length;
    let html='<section class="fa-panel"><div class="fa-section-head"><div><h3>Staged analysis</h3><p>'+sessions.length+' sessions · '+flags+' flagged · sorted oldest to newest</p></div><button id="faSaveStaged" type="button" class="primary" '+((!canWrite()||state.busy)?'disabled':'')+'>Save to Form Attendance</button></div><div class="fa-kpis"><div><strong>'+sessions.length+'</strong><span>sessions</span></div><div><strong>'+sessions.filter(function(s){return s.matchStatus==='matched';}).length+'</strong><span>paired</span></div><div><strong>'+sessions.filter(function(s){return !effectiveIn(s);}).length+'</strong><span>missing in</span></div><div><strong>'+sessions.filter(function(s){return !effectiveOut(s);}).length+'</strong><span>missing out</span></div><div><strong>'+flags+'</strong><span>flagged</span></div></div><div class="fa-list">';
    sessions.forEach(function(s){html+=renderSessionCard(s,true);});
    html+='</div></section>';return html;
  }

  function savedFilterOptions(){const events={};state.persisted.forEach(function(s){if(s.eventName)events[s.eventName]=true;});return Object.keys(events).sort();}
  function filteredSaved(){
    const q=state.search.toLowerCase(),events=state.eventFilter,status=state.statusFilter;
    return sortOldest(state.persisted).filter(function(s){const src=sourceOf(s),hay=[src.name,src.email,src.phone,s.eventName,databaseMatchLabel(s)].join(' ').toLowerCase();if(q&&hay.indexOf(q)===-1)return false;if(events&&s.eventName!==events)return false;if(status==='flagged'&&!(s.reviewFlags||[]).length)return false;if(status==='clean'&&(s.reviewFlags||[]).length)return false;if(status==='missing'&&effectiveIn(s)&&effectiveOut(s))return false;return true;});
  }
  function renderSavedList(){
    const rows=filteredSaved(),all=state.persisted.length;
    let html='<section class="fa-panel"><div class="fa-section-head"><div><h3>Form Attendance database</h3><p>'+all+' saved sessions. This list is independent from the main MakLom volunteer and Event Log lists.</p></div><button id="faRefresh" type="button">Refresh</button></div>';
    html+='<div class="fa-filters"><label>Search<input id="faSearch" value="'+esc(state.search)+'" placeholder="Name, email, phone or event"></label><label>Event<select id="faEventFilter"><option value="">All events</option>'+savedFilterOptions().map(function(e){return'<option value="'+esc(e)+'" '+(state.eventFilter===e?'selected':'')+'>'+esc(e)+'</option>';}).join('')+'</select></label><label>Status<select id="faStatusFilter"><option value="">All</option><option value="clean" '+(state.statusFilter==='clean'?'selected':'')+'>Clean</option><option value="flagged" '+(state.statusFilter==='flagged'?'selected':'')+'>Flagged</option><option value="missing" '+(state.statusFilter==='missing'?'selected':'')+'>Missing sign-in/out</option></select></label></div>';
    if(!rows.length)html+='<div class="fa-empty"><strong>'+(all?'No sessions match the current filters.':'No Form Attendance records yet.')+'</strong><span>'+(all?'Clear a filter to see more records.':'Upload and analyse sign-in/sign-out CSVs above, then save them here.')+'</span></div>';
    else html+='<div class="fa-list">'+rows.map(function(s){return renderSessionCard(s,false);}).join('')+'</div>';
    html+='</section>';return html;
  }

  function renderSessionCard(s,staged){
    const src=sourceOf(s),inAt=effectiveIn(s),outAt=effectiveOut(s),credited=s.staffCreditedMinutes==null?'':Math.round((s.staffCreditedMinutes/60)*100)/100;
    const flags=(s.reviewFlags||[]).map(function(f){return'<span class="pill '+(f==='invalid_time_order'||f.indexOf('missing_')===0?'bad':(f==='event_mismatch'||f==='possible_duplicate'||f==='long_duration'?'warn':'neutral'))+'">'+esc(flagLabel(f))+'</span>';}).join('')||'<span class="pill ok">Clean</span>';
    const originalNote='<div class="fa-original"><span>Original in: '+esc(formatDateTime(originalIn(s)))+'</span><span>Original out: '+esc(formatDateTime(originalOut(s)))+'</span></div>';
    const key=staged?'staged':'saved';
    return'<article class="fa-session '+(s.included===false?'excluded':'')+'" data-fa-session="'+esc(s.id)+'" data-fa-kind="'+key+'"><div class="fa-session-top"><div class="fa-order-time"><strong>'+esc(formatDateTime(inAt||outAt))+'</strong><span>'+esc(formatTime(inAt))+' → '+esc(formatTime(outAt))+'</span></div><div class="fa-person"><strong>'+esc(src.name||'Unnamed')+'</strong><span>'+esc(src.email||'')+(src.email&&src.phone?' · ':'')+esc(src.phone||'')+'</span><small>'+esc(databaseMatchLabel(s))+'</small></div>'+(staged?'<label class="fa-include"><input type="checkbox" data-fa-field="included" '+(s.included===false?'':'checked')+'> Include</label>':'')+'</div><div class="fa-fields"><label>Event<input data-fa-field="eventName" value="'+esc(s.eventName||'')+'"></label><label>Event date<input type="date" data-fa-field="eventDate" value="'+esc(s.eventDate||'')+'"></label><label>Sign in<input type="datetime-local" data-fa-field="signInAt" value="'+esc(localInputValue(inAt))+'"></label><label>Sign out<input type="datetime-local" data-fa-field="signOutAt" value="'+esc(localInputValue(outAt))+'"></label><label>Calculated<input value="'+esc(C.formatMinutes(s.calculatedMinutes))+'" disabled></label><label>Credited hours<input type="number" min="0" max="100" step="0.01" data-fa-field="creditedHours" value="'+esc(credited)+'" placeholder="Calculated"></label><label class="fa-note">Adjustment note<input maxlength="500" data-fa-field="staffCreditNote" value="'+esc(s.staffCreditNote||'')+'" placeholder="Optional note"></label></div>'+originalNote+'<div class="fa-session-foot"><div class="fa-flags">'+flags+'</div><div class="fa-meta">'+(s.signIn&&s.signIn.shirtQuantity?'<span>T-shirt '+esc(s.signIn.shirtSize||'?')+' × '+esc(s.signIn.shirtQuantity)+'</span>':'')+(s.signOut?'<span>Feedback received</span>':'')+'</div>'+(staged?'':'<button type="button" data-fa-save-row class="small" '+((!canWrite()||state.busy)?'disabled':'')+'>Save amendment</button>')+'</div></article>';
  }

  function summarySessions(){
    const base=state.staged.length?state.staged:state.persisted;
    return sortOldest(base).filter(function(s){return(!state.summaryFrom||s.eventDate>=state.summaryFrom)&&(!state.summaryTo||s.eventDate<=state.summaryTo);});
  }
  function summaryFilters(){return'<div class="fa-summary-filter"><label>From<input id="faSummaryFrom" type="date" value="'+esc(state.summaryFrom)+'"></label><label>To<input id="faSummaryTo" type="date" value="'+esc(state.summaryTo)+'"></label></div>';}
  function renderShirts(){
    const sum=C.shirtSummary(summarySessions()),order=['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'];const sizes=Object.keys(sum.sizes).sort(function(a,b){const ai=order.indexOf(a.toUpperCase()),bi=order.indexOf(b.toUpperCase());return(ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b);});
    return summaryFilters()+'<section class="fa-panel"><div class="fa-section-head"><div><h3>T-shirt drawdown</h3><p>Derived only from Form Attendance responses.</p></div></div><div class="fa-kpis"><div><strong>'+sum.total+'</strong><span>shirts recorded</span></div><div><strong>'+sum.flaggedQuantity+'</strong><span>duplicate-flagged</span></div><div><strong>'+sizes.length+'</strong><span>sizes</span></div></div><div class="fa-stock">'+sizes.map(function(size){return'<div><span>'+esc(size)+'</span><strong>'+sum.sizes[size]+'</strong></div>';}).join('')+'</div><div class="fa-table"><table><thead><tr><th>Date</th><th>Volunteer</th><th>Event</th><th>Size</th><th>Qty</th></tr></thead><tbody>'+sum.issues.slice().sort(function(a,b){return(a.eventDate||'').localeCompare(b.eventDate||'');}).map(function(r){return'<tr><td>'+esc(r.eventDate)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.eventName)+'</td><td>'+esc(r.size)+'</td><td>'+esc(r.quantity)+'</td></tr>';}).join('')+'</tbody></table></div></section>';
  }
  function feedbackBreakdown(sum,label,key){const counts={};sum.responses.forEach(function(r){const value=clean(r.feedback&&r.feedback[key])||'Not stated';counts[value]=(counts[value]||0)+1;});return'<section><h4>'+esc(label)+'</h4>'+Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]||a.localeCompare(b);}).map(function(v){return'<span><b>'+esc(v)+'</b> '+counts[v]+'</span>';}).join('')+'</section>';}
  function renderFeedback(){
    const sum=C.feedbackSummary(summarySessions()),a=sum.averages,comments=sum.responses.filter(function(r){const t=clean(r.improvement).toLowerCase();return t&&['nil','n/a','na','none','no','-'].indexOf(t)===-1;});
    return summaryFilters()+'<section class="fa-panel"><div class="fa-section-head"><div><h3>Feedback analysis</h3><p>Derived only from saved/staged Form Attendance responses.</p></div></div><div class="fa-kpis"><div><strong>'+sum.count+'</strong><span>responses</span></div><div><strong>'+(a.briefing==null?'—':a.briefing.toFixed(2))+'</strong><span>briefing / 5</span></div><div><strong>'+(a.onboarding==null?'—':a.onboarding.toFixed(2))+'</strong><span>onboarding / 5</span></div><div><strong>'+(a.roleSatisfaction==null?'—':a.roleSatisfaction.toFixed(2))+'</strong><span>role / 5</span></div><div><strong>'+(a.staffSupport==null?'—':a.staffSupport.toFixed(2))+'</strong><span>staff / 5</span></div></div><div class="fa-recommend"><strong>'+sum.recommendYes+'</strong> Yes · <strong>'+sum.recommendNo+'</strong> No <span>recommend/continue volunteering</span></div><div class="fa-breakdowns">'+feedbackBreakdown(sum,'Age group','ageGroup')+feedbackBreakdown(sum,'Gender','gender')+feedbackBreakdown(sum,'Time volunteering','tenure')+feedbackBreakdown(sum,'Frequency','frequency')+'</div><div class="fa-comments">'+(comments.length?comments.map(function(r){return'<article><strong>'+esc(r.name)+'</strong><span>'+esc(r.eventName)+' · '+esc(r.eventDate)+'</span><p>'+esc(r.improvement)+'</p></article>';}).join(''):'<div class="fa-empty"><strong>No written improvement comments</strong></div>')+'</div></section>';
  }
  function renderImports(){
    if(!state.batches.length)return'<div class="fa-empty"><strong>No Form Attendance imports yet.</strong></div>';
    return'<section class="fa-panel"><div class="fa-section-head"><div><h3>Import history</h3><p>Files saved into the separate Form Attendance store.</p></div></div><div class="fa-import-history">'+state.batches.slice().sort(function(a,b){return(a.created_at||'').localeCompare(b.created_at||'');}).map(function(b){return'<article><div><strong>'+esc([b.sign_in_filename,b.sign_out_filename].filter(Boolean).join(' + '))+'</strong><span>'+esc(String(b.created_at||'').slice(0,16).replace('T',' '))+'</span></div><div><span>'+esc(b.sign_in_count)+' sign-ins</span><span>'+esc(b.sign_out_count)+' sign-outs</span><span>'+esc(b.warning_count)+' flags</span></div></article>';}).join('')+'</div></section>';
  }

  function handleClick(e){
    if(e.target.id==='faAnalyse'){analyseFiles();return;}
    if(e.target.id==='faSaveStaged'){saveStaged();return;}
    if(e.target.id==='faRefresh'){loadPersisted().then(function(){status('Form Attendance refreshed.','ok');}).catch(function(error){status(error.message,'bad');});return;}
    const save=e.target.closest('[data-fa-save-row]');if(save){const card=save.closest('[data-fa-session]');if(card)saveAmendment(card.dataset.faSession);}
  }
  function handleInput(e){
    if(e.target.id==='faSearch'){state.search=e.target.value;return;}
    if(e.target.dataset.faField)updateSessionField(e.target,false);
  }
  function handleChange(e){
    if(e.target.id==='faEventFilter'){state.eventFilter=e.target.value;render();return;}
    if(e.target.id==='faStatusFilter'){state.statusFilter=e.target.value;render();return;}
    if(e.target.id==='faSummaryFrom'){state.summaryFrom=e.target.value;render();return;}
    if(e.target.id==='faSummaryTo'){state.summaryTo=e.target.value;render();return;}
    if(e.target.id==='faSearch'){state.search=e.target.value;render();return;}
    if(e.target.dataset.faField)updateSessionField(e.target,true);
  }
  function findSession(id){return state.staged.find(function(s){return s.id===id;})||state.persisted.find(function(s){return s.id===id;});}
  function updateSessionField(el,rerender){
    const card=el.closest('[data-fa-session]'),s=card&&findSession(card.dataset.faSession);if(!s)return;const field=el.dataset.faField;
    if(field==='included')s.included=!!el.checked;
    else if(field==='eventName')s.eventName=clean(el.value);
    else if(field==='eventDate')s.eventDate=clean(el.value);
    else if(field==='signInAt')s.signInAt=singaporeIso(el.value);
    else if(field==='signOutAt')s.signOutAt=singaporeIso(el.value);
    else if(field==='creditedHours'){const v=clean(el.value);s.staffCreditedMinutes=v===''?null:Math.max(0,Math.round(Number(v)*60));}
    else if(field==='staffCreditNote')s.staffCreditNote=clean(el.value);
    refreshTimeFields(s);s.dirty=true;if(rerender)render();
  }

  async function analyseFiles(){
    const inFile=byId('faSignInFile')&&byId('faSignInFile').files[0],outFile=byId('faSignOutFile')&&byId('faSignOutFile').files[0];
    if(!inFile&&!outFile){status('Choose a sign-in CSV, a sign-out CSV, or both.','warn');return;}
    if((inFile&&inFile.size>5*1024*1024)||(outFile&&outFile.size>5*1024*1024)){status('Each CSV must be 5 MB or smaller.','bad');return;}
    state.busy=true;render();status('Analysing form responses…','ok');
    try{
      if(sharedReady())await loadPersisted(false);
      let ins=inFile?C.parseSignInCsv(await inFile.text(),inFile.name):[],outs=outFile?C.parseSignOutCsv(await outFile.text(),outFile.name):[];
      state.signInFile=inFile?inFile.name:'';state.signOutFile=outFile?outFile.name:'';
      const originalBatch=C.batchId(ins,outs),existing=state.batches.find(function(b){return b.id===originalBatch&&b.status==='committed';});
      if(existing){state.staged=[];status('These exact responses are already saved in Form Attendance.','warn');return;}
      const committedBatches={};state.batches.forEach(function(b){if(b.status==='committed')committedBatches[b.id]=true;});const committedSubs={};state.submissions.forEach(function(r){if(committedBatches[r.batch_id])committedSubs[r.id]=true;});
      const before=ins.length+outs.length;ins=ins.filter(function(r){return !committedSubs[r.id];});outs=outs.filter(function(r){return !committedSubs[r.id];});const skipped=before-(ins.length+outs.length);
      state.signIns=ins;state.signOuts=outs;if(!ins.length&&!outs.length){state.staged=[];status('No new responses found. '+skipped+' previously saved responses were skipped.','warn');return;}
      state.batchId=C.batchId(ins,outs);state.staged=sortOldest(C.reconcile(ins,outs,appData.volunteers||[]).map(prepareSession));
      status('Analysis ready. '+state.staged.length+' sessions staged'+(skipped?' and '+skipped+' previously saved responses skipped':'')+'. Review and amend timestamps before saving.','ok');
    }catch(error){console.error(error);state.staged=[];status(error.message||'Could not analyse these files.','bad');}
    finally{state.busy=false;render();}
  }

  async function apiJson(path,options){const r=await S().apiFetch(path,options||{});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch(_){data=text;}if(!r.ok)throw new Error(typeof data==='string'?data:(data&&data.message)||('Database request failed ('+r.status+')'));return data;}
  async function postRows(table,rows,mode){if(!rows.length)return[];const out=[];for(let i=0;i<rows.length;i+=100){const chunk=rows.slice(i,i+100),prefer=(mode==='ignore'?'resolution=ignore-duplicates':'resolution=merge-duplicates')+',return=representation',data=await apiJson('/rest/v1/'+table+'?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json','Prefer':prefer},body:JSON.stringify(chunk)});if(Array.isArray(data))out.push.apply(out,data);}return out;}
  async function patchVersioned(table,id,version,body){const rows=await apiJson('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id)+'&row_version=eq.'+encodeURIComponent(version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(body)});if(!rows||!rows.length)throw new Error('Another staff member changed this Form Attendance row. Refresh and retry.');return rows[0];}
  function dbSubmissionToCore(r){const iso=r.submitted_at||'',date=r.submitted_date||String(iso).slice(0,10),base={id:r.id,type:r.submission_type,responseId:r.source_response_id||'',fileName:r.source_file_name||'',timestamp:{iso:iso,date:date,ms:Date.parse(iso)},name:r.full_name||'',email:r.email||'',phone:r.phone||'',eventName:r.event_name||'',shirtQuantity:Number(r.shirt_quantity)||0,shirtSize:r.shirt_size||'',raw:r.raw_payload||{}};if(r.submission_type==='sign_out')base.feedback={ageGroup:r.age_group||'',gender:r.gender||'',tenure:r.volunteer_tenure||'',frequency:r.volunteer_frequency||'',briefing:r.briefing_rating==null?null:Number(r.briefing_rating),onboarding:r.onboarding_rating==null?null:Number(r.onboarding_rating),roleSatisfaction:r.role_satisfaction_rating==null?null:Number(r.role_satisfaction_rating),staffSupport:r.staff_support_rating==null?null:Number(r.staff_support_rating),improvement:r.improvement_feedback||'',recommend:r.recommendation||'',referralEmail:r.referral_email||''};return base;}
  function reconciliationRow(s,batchId){return{id:s.id,batch_id:batchId,volunteer_id:s.volunteerMatch&&s.volunteerMatch.id||s.volunteerId||null,sign_in_submission_id:s.signIn&&s.signIn.id||null,sign_out_submission_id:s.signOut&&s.signOut.id||null,event_name:s.eventName,event_date:s.eventDate,sign_in_at:effectiveIn(s)||null,sign_out_at:effectiveOut(s)||null,calculated_duration_minutes:s.calculatedMinutes,staff_credited_duration_minutes:s.staffCreditedMinutes,staff_credit_note:s.staffCreditNote||null,match_status:s.matchStatus,match_confidence:Number(s.matchConfidence)||0,match_reason:s.matchReason||null,review_flags:s.reviewFlags||[],included:s.included!==false,review_acknowledged:true};}

  async function saveStaged(){
    if(!canWrite()){status('Your account does not have edit access.','bad');return;}if(!state.staged.length){status('Analyse files first.','warn');return;}
    const included=state.staged.filter(function(s){return s.included!==false;});if(!included.length){status('No sessions are included.','warn');return;}
    const invalid=included.filter(function(s){return !clean(s.eventName)||!/^\d{4}-\d{2}-\d{2}$/.test(clean(s.eventDate))||(s.reviewFlags||[]).indexOf('invalid_time_order')>-1;});if(invalid.length){status(invalid.length+' included sessions need a valid event/date and sign-out cannot be before sign-in.','warn');return;}
    setBusy(true);status('Saving into the separate Form Attendance store…','ok');
    try{
      const batch={id:state.batchId,sign_in_filename:state.signInFile||null,sign_out_filename:state.signOutFile||null,sign_in_count:state.signIns.length,sign_out_count:state.signOuts.length,status:'pending_sync',warning_count:included.filter(function(s){return(s.reviewFlags||[]).length;}).length,completed_at:null};
      await postRows('form_import_batches',[batch],'merge');await postRows('form_submissions',state.signIns.concat(state.signOuts).map(function(r){return C.serializeSubmission(r,state.batchId);}), 'ignore');await postRows('attendance_reconciliations',state.staged.map(function(s){return reconciliationRow(s,state.batchId);}), 'merge');
      const savedBatch=(await apiJson('/rest/v1/form_import_batches?id=eq.'+encodeURIComponent(state.batchId)+'&select=*',{method:'GET'}))[0];if(!savedBatch)throw new Error('Saved batch could not be reloaded.');await patchVersioned('form_import_batches',savedBatch.id,savedBatch.row_version,{status:'committed',completed_at:new Date().toISOString()});
      state.staged=[];state.signIns=[];state.signOuts=[];state.batchId='';await loadPersisted(false);status('Saved to Form Attendance. The Central Database and Event Log were not changed.','ok');
    }catch(error){console.error(error);status(error.message+' The form batch remains separate from the main MakLom lists.','bad');}
    finally{state.busy=false;render();}
  }

  async function saveAmendment(id){
    if(!canWrite()){status('Your account does not have edit access.','bad');return;}const s=state.persisted.find(function(row){return row.id===id;});if(!s)return;
    refreshTimeFields(s);if((s.reviewFlags||[]).indexOf('invalid_time_order')>-1){status('Sign-out cannot be earlier than sign-in.','warn');return;}if(!clean(s.eventName)||!/^\d{4}-\d{2}-\d{2}$/.test(clean(s.eventDate))){status('This row needs a valid event name and event date.','warn');return;}
    state.busy=true;render();
    try{
      const body={event_name:s.eventName,event_date:s.eventDate,sign_in_at:effectiveIn(s)||null,sign_out_at:effectiveOut(s)||null,calculated_duration_minutes:s.calculatedMinutes,staff_credited_duration_minutes:s.staffCreditedMinutes,staff_credit_note:s.staffCreditNote||null,match_status:s.matchStatus,review_flags:s.reviewFlags||[],included:s.included!==false,review_acknowledged:true};
      const updated=await patchVersioned('attendance_reconciliations',s.id,s.rowVersion,body);s.rowVersion=Number(updated.row_version)||s.rowVersion;s.updatedAt=updated.updated_at;s.dirty=false;status('Amendment saved. Original form timestamps remain preserved in the raw submission record.','ok');
    }catch(error){console.error(error);status(error.message,'bad');}
    finally{state.busy=false;render();}
  }

  async function loadPersisted(doRender){
    if(!sharedReady())return;const result=await Promise.all([S().fetchRows('form_import_batches','*'),S().fetchRows('form_submissions','*'),S().fetchRows('attendance_reconciliations','*')]);state.batches=result[0]||[];state.submissions=result[1]||[];const committed={};state.batches.forEach(function(b){if(b.status==='committed')committed[b.id]=true;});const map={};state.submissions.forEach(function(r){map[r.id]=dbSubmissionToCore(r);});
    state.persisted=sortOldest((result[2]||[]).filter(function(r){return committed[r.batch_id];}).map(function(r){const s={id:r.id,batchId:r.batch_id,volunteerId:r.volunteer_id||null,signIn:r.sign_in_submission_id?map[r.sign_in_submission_id]||null:null,signOut:r.sign_out_submission_id?map[r.sign_out_submission_id]||null:null,eventName:r.event_name,eventDate:r.event_date,signInAt:r.sign_in_at||null,signOutAt:r.sign_out_at||null,calculatedMinutes:r.calculated_duration_minutes,staffCreditedMinutes:r.staff_credited_duration_minutes,staffCreditNote:r.staff_credit_note||'',matchStatus:r.match_status,matchConfidence:r.match_confidence,matchReason:r.match_reason||'',reviewFlags:Array.isArray(r.review_flags)?r.review_flags:[],included:r.included,rowVersion:Number(r.row_version)||1,updatedAt:r.updated_at||''};return prepareSession(s);}));if(doRender!==false)render();
  }

  document.addEventListener('DOMContentLoaded',install);
})();