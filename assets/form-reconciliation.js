(function initFormReconciliation(){
  'use strict';
  const C=window.MaklomFormReconciliationCore;
  if(!C)return;
  const state={signIns:[],signOuts:[],sessions:[],batchId:'',signInFile:'',signOutFile:'',activeTab:'import',reviewFilter:'needs-review',persistedSessions:[],batches:[],submissions:[],summaryEvent:'',summaryFrom:'',summaryTo:'',busy:false};

  function S(){return window.MaklomSharedDB;}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function byId(id){return document.getElementById(id);}
  function canWrite(){return !!(S()&&S().ready&&S().canWrite&&S().canWrite());}
  function sharedReady(){return !!(S()&&S().ready);}
  function status(message,type){const el=byId('formReconStatus');if(!el)return;el.innerHTML=message?'<div class="notice '+(type||'ok')+'">'+esc(message)+'</div>':'';}
  function setBusy(value,label){state.busy=!!value;const button=byId('formAnalyzeButton');if(button){button.disabled=state.busy;button.textContent=state.busy?(label||'Working…'):'Analyse files';}const confirm=byId('formConfirmImport');if(confirm)confirm.disabled=state.busy;}
  function formatTime(iso){if(!iso)return'—';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return iso;return d.toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'});}
  function formatDate(isoDate){if(!isoDate)return'';const d=new Date(isoDate+'T00:00:00+08:00');return Number.isFinite(d.getTime())?d.toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Singapore'}):isoDate;}
  function volunteerDisplay(v){return[v.name||'Unnamed',v.email||v.phone||'',v.id?'#'+String(v.id).slice(-6):''].filter(Boolean).join(' — ');}
  function volunteerDisplayMap(){const map={};(appData.volunteers||[]).forEach(function(v){map[volunteerDisplay(v)]=v;});return map;}
  function allKnownEvents(){const out={},add=function(v){v=C.clean(v);if(v)out[v.toLowerCase()]=v;};(appData.attendanceLog||[]).forEach(function(r){add(r.eventName);});state.signIns.forEach(function(r){add(r.eventName);});state.signOuts.forEach(function(r){add(r.eventName);});state.persistedSessions.forEach(function(r){add(r.eventName);});return Object.keys(out).map(function(k){return out[k];}).sort(function(a,b){return a.localeCompare(b);});}

  function install(){
    const view=byId('eventLogView');if(!view)return;
    if(!byId('formImportButton')){
      const button=document.createElement('button');button.id='formImportButton';button.type='button';button.className='event-log-form-import';button.textContent='Forms';button.setAttribute('aria-label','Open sign-in and sign-out form operations');button.addEventListener('click',openModal);
      const heading=view.querySelector(':scope > .card:first-child > h2');if(heading)heading.insertAdjacentElement('afterend',button);
    }
    ensureModal();
  }

  function ensureModal(){
    if(byId('formReconciliationModal'))return;
    const modal=document.createElement('div');modal.id='formReconciliationModal';modal.className='form-recon-modal hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','formReconTitle');
    modal.innerHTML='<button type="button" class="form-recon-backdrop" data-form-close aria-label="Close form operations"></button><section class="form-recon-shell"><header class="form-recon-head"><div><h2 id="formReconTitle">Form Operations</h2><p class="muted">Reconcile volunteer sign-in, sign-out, T-shirt and feedback data.</p></div><button type="button" class="small" data-form-close>Close</button></header><nav class="form-recon-tabs" aria-label="Form operations views"><button type="button" data-form-tab="import" class="active">Import & review</button><button type="button" data-form-tab="shirts">T-shirts</button><button type="button" data-form-tab="feedback">Feedback</button><button type="button" data-form-tab="history">Imports</button></nav><div id="formReconStatus"></div><div id="formReconBody"></div></section>';
    modal.querySelectorAll('[data-form-close]').forEach(function(b){b.addEventListener('click',closeModal);});
    modal.addEventListener('click',handleModalClick);modal.addEventListener('change',handleModalChange);modal.addEventListener('input',handleModalInput);
    document.body.appendChild(modal);render();
  }

  async function openModal(){
    ensureModal();byId('formReconciliationModal').classList.remove('hidden');document.body.classList.add('form-recon-open');
    if(sharedReady()){try{await loadPersisted();}catch(error){console.error(error);status('Could not load saved form operations: '+error.message,'warn');}}
    render();
  }
  function closeModal(){const m=byId('formReconciliationModal');if(m)m.classList.add('hidden');document.body.classList.remove('form-recon-open');}
  function switchTab(tab){state.activeTab=tab;render();}

  function render(){
    const modal=byId('formReconciliationModal');if(!modal)return;
    modal.querySelectorAll('[data-form-tab]').forEach(function(b){b.classList.toggle('active',b.dataset.formTab===state.activeTab);});
    const body=byId('formReconBody');if(!body)return;
    if(state.activeTab==='shirts')body.innerHTML=renderShirts();
    else if(state.activeTab==='feedback')body.innerHTML=renderFeedback();
    else if(state.activeTab==='history')body.innerHTML=renderHistory();
    else body.innerHTML=renderImport();
    renderSharedDataLists();
  }

  function renderSharedDataLists(){
    const shell=byId('formReconBody');if(!shell)return;
    let dl=byId('formVolunteerOptions');if(!dl){dl=document.createElement('datalist');dl.id='formVolunteerOptions';document.body.appendChild(dl);}dl.innerHTML=(appData.volunteers||[]).slice().sort(function(a,b){return(a.name||'').localeCompare(b.name||'');}).map(function(v){return'<option value="'+esc(volunteerDisplay(v))+'"></option>';}).join('');
    let ev=byId('formEventOptions');if(!ev){ev=document.createElement('datalist');ev.id='formEventOptions';document.body.appendChild(ev);}ev.innerHTML=allKnownEvents().map(function(v){return'<option value="'+esc(v)+'"></option>';}).join('');
  }

  function renderImport(){
    const writeWarning=sharedReady()&&!canWrite()?'<div class="notice warn">This account can review form data but cannot import or edit it.</div>':'';
    let html=writeWarning+'<div class="form-upload-grid"><label class="form-upload-box"><span>Sign-in CSV</span><small>Timestamp, identity, event and T-shirts</small><input id="formSignInFile" type="file" accept=".csv,text/csv"></label><label class="form-upload-box"><span>Sign-out CSV</span><small>Timestamp, identity, event and feedback</small><input id="formSignOutFile" type="file" accept=".csv,text/csv"></label></div><div class="form-import-actions"><button id="formAnalyzeButton" type="button" class="primary" '+(state.busy?'disabled':'')+'>Analyse files</button><span class="muted">Upload either file or both. Previously committed responses are skipped automatically. Nothing is saved until Confirm import.</span></div>';
    if(!state.sessions.length)return html+'<div class="form-empty"><strong>No reconciliation staged.</strong><span>Upload the exported CSV files to match sign-ins and sign-outs.</span></div>';
    const total=state.sessions.length,matched=state.sessions.filter(function(s){return s.matchStatus==='matched';}).length,needs=state.sessions.filter(needsReview).length,inOnly=state.sessions.filter(function(s){return s.matchStatus==='missing_sign_out';}).length,outOnly=state.sessions.filter(function(s){return s.matchStatus==='missing_sign_in';}).length;
    html+='<div class="form-kpis"><div><strong>'+total+'</strong><span>sessions</span></div><div><strong>'+matched+'</strong><span>paired</span></div><div class="'+(needs?'warn':'')+'"><strong>'+needs+'</strong><span>need review</span></div><div><strong>'+inOnly+'</strong><span>missing out</span></div><div><strong>'+outOnly+'</strong><span>missing in</span></div></div>';
    html+='<div class="form-review-toolbar"><div class="form-review-filters"><button type="button" data-review-filter="needs-review" class="'+(state.reviewFilter==='needs-review'?'active':'')+'">Needs review ('+needs+')</button><button type="button" data-review-filter="all" class="'+(state.reviewFilter==='all'?'active':'')+'">All ('+total+')</button><button type="button" data-review-filter="matched" class="'+(state.reviewFilter==='matched'?'active':'')+'">Paired</button><button type="button" data-review-filter="incomplete" class="'+(state.reviewFilter==='incomplete'?'active':'')+'">Incomplete</button></div><div><button id="formAcknowledgeVisible" type="button">Acknowledge visible</button></div></div>';
    const visible=state.sessions.filter(function(s){if(state.reviewFilter==='needs-review')return needsReview(s);if(state.reviewFilter==='matched')return s.matchStatus==='matched';if(state.reviewFilter==='incomplete')return s.matchStatus!=='matched';return true;});
    html+='<div class="form-session-list">'+visible.map(renderSessionCard).join('')+'</div>';
    const unresolved=state.sessions.filter(function(s){return s.included!==false&&needsReview(s)&&!s.reviewAcknowledged;}).length;
    html+='<footer class="form-confirm-bar"><div><strong>'+state.sessions.filter(function(s){return s.included!==false;}).length+' sessions included</strong><span class="muted">'+(unresolved?unresolved+' flagged sessions still need acknowledgement':'All included flagged sessions reviewed')+'</span></div><button id="formConfirmImport" type="button" class="primary" '+((!canWrite()||state.busy)?'disabled':'')+'>Confirm import</button></footer>';
    return html;
  }

  function needsReview(s){return !!((s.reviewFlags&&s.reviewFlags.length)||!s.volunteerMatch);}
  function flagLabel(flag){return({missing_sign_in:'Missing sign-in',missing_sign_out:'Missing sign-out',event_mismatch:'Event mismatch',possible_duplicate:'Possible duplicate',long_duration:'Long duration',volunteer_unmatched:'Volunteer not matched',volunteer_ambiguous:'Volunteer match ambiguous'})[flag]||flag.replace(/_/g,' ');}
  function sessionSource(s){return s.signIn||s.signOut;}
  function renderSessionCard(s){
    const source=sessionSource(s),name=source?source.name:'Unnamed',email=source?source.email:'',phone=source?source.phone:'';
    const volunteer=s.volunteerMatch&&s.volunteerMatch.id?(appData.volunteers||[]).find(function(v){return v.id===s.volunteerMatch.id;})||s.volunteerMatch:null;
    const volunteerValue=volunteer?volunteerDisplay(volunteer):'';
    const flags=(s.reviewFlags||[]).map(function(f){return'<span class="pill '+(f.indexOf('missing')===0||f==='event_mismatch'||f==='possible_duplicate'||f==='long_duration'?'warn':'neutral')+'">'+esc(flagLabel(f))+'</span>';}).join('');
    const sourceEvents=s.eventOptions&&s.eventOptions.length>1?'<div class="form-source-note">Form events: '+s.eventOptions.map(esc).join(' / ')+'</div>':'';
    const shirt=s.signIn&&s.signIn.shirtQuantity?'<span>T-shirt: <strong>'+esc(s.signIn.shirtSize||'Unspecified')+' × '+esc(s.signIn.shirtQuantity)+'</strong></span>':'';
    const feedback=s.signOut?'<span>Feedback: <strong>received</strong></span>':'';
    const credited=s.staffCreditedMinutes==null?'':(Math.round((s.staffCreditedMinutes/60)*100)/100);
    return '<article class="form-session '+(s.included===false?'excluded':'')+'" data-session="'+esc(s.id)+'"><div class="form-session-main"><label class="form-include"><input type="checkbox" data-session-field="included" data-session-id="'+esc(s.id)+'" '+(s.included===false?'':'checked')+'> Include</label><div class="form-session-person"><strong>'+esc(name)+'</strong><span>'+esc(email)+(email&&phone?' · ':'')+esc(phone)+'</span></div><div class="form-session-times"><span><b>In</b> '+formatTime(s.signIn&&s.signIn.timestamp.iso)+'</span><span><b>Out</b> '+formatTime(s.signOut&&s.signOut.timestamp.iso)+'</span><span><b>Calculated</b> '+esc(C.formatMinutes(s.calculatedMinutes))+'</span></div></div><div class="form-session-fields"><label>MakLom volunteer<input list="formVolunteerOptions" data-session-field="volunteer" data-session-id="'+esc(s.id)+'" value="'+esc(volunteerValue)+'" placeholder="Search existing volunteer"></label><label>Event<input list="formEventOptions" data-session-field="eventName" data-session-id="'+esc(s.id)+'" value="'+esc(s.eventName)+'"></label><label>Event date<input type="date" data-session-field="eventDate" data-session-id="'+esc(s.id)+'" value="'+esc(s.eventDate)+'"></label><label>Credited hours<input type="number" min="0" max="100" step="0.01" data-session-field="creditedHours" data-session-id="'+esc(s.id)+'" value="'+esc(credited)+'" placeholder="Calculated"></label><label>Adjustment note<input maxlength="500" data-session-field="staffCreditNote" data-session-id="'+esc(s.id)+'" value="'+esc(s.staffCreditNote||'')+'" placeholder="Optional"></label></div><div class="form-session-foot"><div class="form-session-flags">'+(flags||'<span class="pill ok">Matched</span>')+'</div><div class="form-session-extra">'+shirt+feedback+'<span>'+esc(formatDate(s.eventDate))+'</span></div></div>'+sourceEvents+(needsReview(s)?'<label class="form-ack"><input type="checkbox" data-session-field="reviewAcknowledged" data-session-id="'+esc(s.id)+'" '+(s.reviewAcknowledged?'checked':'')+'> I reviewed this flagged session and accept the pairing / exception.</label>':'')+'</article>';
  }

  function renderSummaryFilters(){
    const sessions=summarySessions(),events={};sessions.forEach(function(s){if(s.eventName)events[s.eventName]=true;});
    return '<div class="form-summary-filters"><label>Event<select id="formSummaryEvent"><option value="">All events</option>'+Object.keys(events).sort().map(function(e){return'<option value="'+esc(e)+'" '+(state.summaryEvent===e?'selected':'')+'>'+esc(e)+'</option>';}).join('')+'</select></label><label>From<input id="formSummaryFrom" type="date" value="'+esc(state.summaryFrom)+'"></label><label>To<input id="formSummaryTo" type="date" value="'+esc(state.summaryTo)+'"></label></div>';
  }
  function summarySessions(){const base=state.sessions.length?state.sessions:state.persistedSessions;return base.filter(function(s){return(!state.summaryEvent||s.eventName===state.summaryEvent)&&(!state.summaryFrom||s.eventDate>=state.summaryFrom)&&(!state.summaryTo||s.eventDate<=state.summaryTo);});}

  function renderShirts(){
    const sessions=summarySessions(),sum=C.shirtSummary(sessions),order=['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'];
    const sizes=Object.keys(sum.sizes).sort(function(a,b){const ai=order.indexOf(a.toUpperCase()),bi=order.indexOf(b.toUpperCase());if(ai>=0||bi>=0)return(ai<0?999:ai)-(bi<0?999:bi);return a.localeCompare(b);});
    return renderSummaryFilters()+'<div class="form-kpis"><div><strong>'+sum.total+'</strong><span>shirts drawn</span></div><div class="'+(sum.flaggedQuantity?'warn':'')+'"><strong>'+sum.flaggedQuantity+'</strong><span>from duplicate-flagged sessions</span></div><div><strong>'+sizes.length+'</strong><span>sizes</span></div></div><div class="form-stock-grid">'+sizes.map(function(size){return'<div><span>'+esc(size)+'</span><strong>'+sum.sizes[size]+'</strong></div>';}).join('')+'</div><div class="form-data-table"><table><thead><tr><th>Date</th><th>Volunteer</th><th>Event</th><th>Size</th><th>Qty</th></tr></thead><tbody>'+sum.issues.slice().sort(function(a,b){return(b.eventDate||'').localeCompare(a.eventDate||'');}).map(function(r){return'<tr class="'+(r.flagged?'form-row-warn':'')+'"><td>'+esc(r.eventDate)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.eventName)+'</td><td>'+esc(r.size)+'</td><td>'+esc(r.quantity)+'</td></tr>';}).join('')+'</tbody></table></div>'+(state.sessions.length?'<p class="muted">This summary reflects the currently staged import. Excluding a duplicate session updates the stock count immediately.</p>':'<p class="muted">Only committed form imports are included.</p>');
  }

  function renderFeedback(){
    const sum=C.feedbackSummary(summarySessions()),a=sum.averages;
    const comments=sum.responses.filter(function(r){const t=C.lower(r.improvement);return t&&['nil','n/a','na','none','no','-'].indexOf(t)===-1;});
    return renderSummaryFilters()+'<div class="form-kpis form-feedback-kpis"><div><strong>'+sum.count+'</strong><span>responses</span></div><div><strong>'+(a.briefing==null?'—':a.briefing.toFixed(2))+'</strong><span>briefing / 5</span></div><div><strong>'+(a.onboarding==null?'—':a.onboarding.toFixed(2))+'</strong><span>onboarding / 5</span></div><div><strong>'+(a.roleSatisfaction==null?'—':a.roleSatisfaction.toFixed(2))+'</strong><span>role / 5</span></div><div><strong>'+(a.staffSupport==null?'—':a.staffSupport.toFixed(2))+'</strong><span>staff support / 5</span></div></div><div class="form-recommend"><strong>'+sum.recommendYes+'</strong> Yes <span class="muted">·</span> <strong>'+sum.recommendNo+'</strong> No <span class="muted">would recommend / continue volunteering</span></div><div class="form-feedback-comments">'+(comments.length?comments.map(function(r){return'<article><div><strong>'+esc(r.name)+'</strong><span>'+esc(r.eventName)+' · '+esc(r.eventDate)+'</span></div><p>'+esc(r.improvement)+'</p></article>';}).join(''):'<div class="form-empty"><strong>No written improvement comments</strong><span>for the selected filters.</span></div>')+'</div>'+(state.sessions.length?'<p class="muted">This summary reflects the currently staged import.</p>':'<p class="muted">Only committed form imports are included.</p>');
  }

  function renderHistory(){
    if(!sharedReady())return'<div class="form-empty"><strong>Sign in to view import history.</strong></div>';
    if(!state.batches.length)return'<div class="form-empty"><strong>No form imports yet.</strong><span>Committed sign-in/sign-out uploads will appear here.</span></div>';
    return'<div class="form-history">'+state.batches.slice().sort(function(a,b){return(b.created_at||'').localeCompare(a.created_at||'');}).map(function(b){return'<article><div><strong>'+esc((b.sign_in_filename||'')+(b.sign_in_filename&&b.sign_out_filename?' + ':'')+(b.sign_out_filename||''))+'</strong><span>'+esc((b.created_at||'').slice(0,10))+'</span></div><div><span class="pill '+(b.status==='committed'?'ok':'warn')+'">'+esc(b.status)+'</span><span>'+esc(b.sign_in_count)+' sign-ins · '+esc(b.sign_out_count)+' sign-outs</span><span>'+esc(b.warning_count)+' warnings</span></div></article>';}).join('')+'</div>';
  }

  function handleModalClick(event){
    const tab=event.target.closest('[data-form-tab]');if(tab){switchTab(tab.dataset.formTab);return;}
    const filter=event.target.closest('[data-review-filter]');if(filter){state.reviewFilter=filter.dataset.reviewFilter;render();return;}
    if(event.target.id==='formAnalyzeButton'){analyseFiles();return;}
    if(event.target.id==='formConfirmImport'){confirmImport();return;}
    if(event.target.id==='formAcknowledgeVisible'){acknowledgeVisible();return;}
  }
  function handleModalChange(event){
    if(event.target.id==='formSummaryEvent'){state.summaryEvent=event.target.value;render();return;}
    if(event.target.id==='formSummaryFrom'){state.summaryFrom=event.target.value;render();return;}
    if(event.target.id==='formSummaryTo'){state.summaryTo=event.target.value;render();return;}
    if(event.target.dataset.sessionField)updateSessionControl(event.target,true);
  }
  function handleModalInput(event){if(event.target.dataset.sessionField&&['eventName','eventDate','creditedHours','staffCreditNote','volunteer'].indexOf(event.target.dataset.sessionField)>-1)updateSessionControl(event.target,false);}
  function getSession(id){return state.sessions.find(function(s){return s.id===id;});}
  function updateSessionControl(el,rerender){
    const s=getSession(el.dataset.sessionId);if(!s)return;const field=el.dataset.sessionField;
    if(field==='included')s.included=!!el.checked;
    else if(field==='reviewAcknowledged')s.reviewAcknowledged=!!el.checked;
    else if(field==='eventName')s.eventName=C.clean(el.value);
    else if(field==='eventDate')s.eventDate=C.clean(el.value);
    else if(field==='staffCreditNote')s.staffCreditNote=C.clean(el.value);
    else if(field==='creditedHours'){const value=C.clean(el.value);s.staffCreditedMinutes=value===''?null:Math.max(0,Math.round(Number(value)*60));}
    else if(field==='volunteer'){
      const v=volunteerDisplayMap()[el.value]||null;s.volunteerMatch=v?{id:v.id,name:v.name,email:v.email||'',phone:v.phone||'',confidence:100,ambiguous:false,reason:'staff selected'}:null;
      s.reviewFlags=(s.reviewFlags||[]).filter(function(f){return f!=='volunteer_unmatched'&&f!=='volunteer_ambiguous';});if(!v)s.reviewFlags.push('volunteer_unmatched');s.reviewAcknowledged=false;
    }
    if(rerender)render();
  }
  function acknowledgeVisible(){state.sessions.forEach(function(s){let visible=state.reviewFilter==='all'||(state.reviewFilter==='needs-review'&&needsReview(s))||(state.reviewFilter==='matched'&&s.matchStatus==='matched')||(state.reviewFilter==='incomplete'&&s.matchStatus!=='matched');if(visible&&s.included!==false&&needsReview(s))s.reviewAcknowledged=true;});render();}

  async function analyseFiles(){
    const inInput=byId('formSignInFile'),outInput=byId('formSignOutFile'),inFile=inInput&&inInput.files&&inInput.files[0],outFile=outInput&&outInput.files&&outInput.files[0];
    if(!inFile&&!outFile){status('Choose a sign-in CSV, a sign-out CSV, or both.','warn');return;}
    if((inFile&&inFile.size>5*1024*1024)||(outFile&&outFile.size>5*1024*1024)){status('Each CSV must be 5 MB or smaller.','bad');return;}
    setBusy(true,'Analysing…');status('');
    try{
      let parsedIns=inFile?C.parseSignInCsv(await inFile.text(),inFile.name):[],parsedOuts=outFile?C.parseSignOutCsv(await outFile.text(),outFile.name):[];state.signInFile=inFile?inFile.name:'';state.signOutFile=outFile?outFile.name:'';
      let skipped=0,retryBatch=null;
      if(sharedReady()){
        await loadPersisted();
        const originalBatchId=C.batchId(parsedIns,parsedOuts);retryBatch=await getBatch(originalBatchId);
        if(retryBatch&&retryBatch.status==='committed'){state.signIns=[];state.signOuts=[];state.sessions=[];state.batchId='';status('These exact form responses were already committed on '+String(retryBatch.completed_at||retryBatch.updated_at||retryBatch.created_at).slice(0,10)+'. No new rows were staged.','warn');render();return;}
        if(!retryBatch){
          const committedBatches={};state.batches.forEach(function(b){if(b.status==='committed')committedBatches[b.id]=true;});
          const committedSubmissions={};state.submissions.forEach(function(r){if(committedBatches[r.batch_id])committedSubmissions[r.id]=true;});
          const before=parsedIns.length+parsedOuts.length;parsedIns=parsedIns.filter(function(r){return !committedSubmissions[r.id];});parsedOuts=parsedOuts.filter(function(r){return !committedSubmissions[r.id];});skipped=before-(parsedIns.length+parsedOuts.length);
        }
      }
      state.signIns=parsedIns;state.signOuts=parsedOuts;
      if(!state.signIns.length&&!state.signOuts.length){state.sessions=[];state.batchId='';status(skipped?('No new form responses found. '+skipped+' previously committed responses were skipped.'):'No form responses were found in the selected files.','warn');render();return;}
      state.sessions=C.reconcile(state.signIns,state.signOuts,appData.volunteers||[]);state.batchId=C.batchId(state.signIns,state.signOuts);state.reviewFilter=state.sessions.some(needsReview)?'needs-review':'all';
      if(sharedReady()){
        const existing=retryBatch||await getBatch(state.batchId);if(existing&&existing.status!=='committed')status('A previous attempt for these responses is marked '+existing.status+'. Confirming again will safely retry the pending import.'+(skipped?' '+skipped+' previously committed responses were skipped.':''),'warn');
        else status('Files analysed. '+(skipped?skipped+' previously committed responses were skipped. ':'')+'Review flagged sessions before confirming.','ok');
      }else status('Files analysed locally. Sign in to MakLom before confirming the import.','warn');
      render();
    }catch(error){console.error(error);state.sessions=[];status(error.message||'Could not analyse these CSV files.','bad');}
    finally{setBusy(false);render();}
  }

  async function apiJson(path,options){const r=await S().apiFetch(path,options||{});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch(e){data=text;}if(!r.ok)throw new Error(typeof data==='string'?data:(data&&data.message)||('Database request failed ('+r.status+')'));return data;}
  async function getBatch(id){const rows=await apiJson('/rest/v1/form_import_batches?id=eq.'+encodeURIComponent(id)+'&select=*',{method:'GET'});return rows&&rows[0]||null;}
  async function postRows(table,rows,mode){
    if(!rows.length)return[];const out=[];
    for(let i=0;i<rows.length;i+=100){const chunk=rows.slice(i,i+100);const prefer=(mode==='ignore'?'resolution=ignore-duplicates':'resolution=merge-duplicates')+',return=representation';const data=await apiJson('/rest/v1/'+table+'?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json','Prefer':prefer},body:JSON.stringify(chunk)});if(Array.isArray(data))out.push.apply(out,data);}
    return out;
  }
  async function patchVersioned(table,id,version,body){const rows=await apiJson('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id)+'&row_version=eq.'+encodeURIComponent(version),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(body)});if(!rows||!rows.length)throw new Error('Another staff member changed '+table+' while this import was being saved. Reload and retry.');return rows[0];}

  async function persistFormRecords(){
    const warningCount=state.sessions.filter(needsReview).length,batch={id:state.batchId,sign_in_filename:state.signInFile||null,sign_out_filename:state.signOutFile||null,sign_in_count:state.signIns.length,sign_out_count:state.signOuts.length,status:'pending_sync',warning_count:warningCount,completed_at:null};
    await postRows('form_import_batches',[batch],'merge');
    const submissions=state.signIns.concat(state.signOuts).map(function(r){return C.serializeSubmission(r,state.batchId);});await postRows('form_submissions',submissions,'ignore');
    const recs=state.sessions.map(function(s){return C.serializeReconciliation(s,state.batchId);});await postRows('attendance_reconciliations',recs,'merge');
  }

  function attendanceCandidate(rows,s){
    const source=sessionSource(s),vid=s.volunteerMatch&&s.volunteerMatch.id||null,event=C.normalizeEvent(s.eventName),date=s.eventDate,email=C.normalizeEmail(source&&source.email),phone=C.normalizePhone(source&&source.phone);
    let exact=rows.filter(function(r){return r.form_reconciliation_id===s.id;});if(exact.length)return exact[0];
    exact=rows.filter(function(r){const identityMatch=(vid&&r.volunteer_id===vid)||(email&&C.normalizeEmail(r.email)===email)||(phone&&C.normalizePhone(r.contact)===phone);return r.event_date===date&&C.normalizeEvent(r.event_name)===event&&identityMatch;});return exact.length===1?exact[0]:null;
  }

  async function writeAttendance(){
    const rows=await S().fetchRows('attendance_log','*');
    for(const s of state.sessions){
      if(s.included===false)continue;const source=sessionSource(s);if(!source)continue;const finalMinutes=C.finalMinutes(s),body={volunteer_id:s.volunteerMatch&&s.volunteerMatch.id||null,attended:true,event_name:s.eventName,event_date:s.eventDate,duration_minutes:finalMinutes,sign_in_at:s.signIn&&s.signIn.timestamp.iso||null,sign_out_at:s.signOut&&s.signOut.timestamp.iso||null,calculated_duration_minutes:s.calculatedMinutes,staff_credited_duration_minutes:s.staffCreditedMinutes,staff_credit_note:s.staffCreditNote||null,form_reconciliation_id:s.id};
      let existing=attendanceCandidate(rows,s);
      if(existing){const updated=await patchVersioned('attendance_log',existing.id,existing.row_version,body);Object.assign(existing,updated);continue;}
      const id='evt_form_'+C.hashString(s.id),insert=Object.assign({id:id,name:source.name,email:source.email||null,contact:source.phone||null},body);
      try{const added=await postRows('attendance_log',[insert],'ignore');if(added.length)rows.push(added[0]);else{const found=(await apiJson('/rest/v1/attendance_log?id=eq.'+encodeURIComponent(id)+'&select=*',{method:'GET'}))[0];if(found){const updated=await patchVersioned('attendance_log',found.id,found.row_version,body);rows.push(updated);}}}
      catch(error){throw new Error('Attendance save failed for '+source.name+': '+error.message);}
    }
  }

  async function markBatchCommitted(){const batch=await getBatch(state.batchId);if(!batch)throw new Error('Import batch could not be found after saving.');await patchVersioned('form_import_batches',batch.id,batch.row_version,{status:'committed',completed_at:new Date().toISOString()});}

  async function confirmImport(){
    if(!canWrite()){status('Your account does not have edit access.','bad');return;}
    if(!state.sessions.length){status('Analyse the form CSV files first.','warn');return;}
    const existing=await getBatch(state.batchId);if(existing&&existing.status==='committed'){status('This exact import has already been committed.','warn');return;}
    const unresolved=state.sessions.filter(function(s){return s.included!==false&&needsReview(s)&&!s.reviewAcknowledged;});if(unresolved.length){status(unresolved.length+' included flagged sessions still need acknowledgement or exclusion.','warn');state.reviewFilter='needs-review';render();return;}
    const invalid=state.sessions.filter(function(s){return s.included!==false&&(!C.clean(s.eventName)||!/^\d{4}-\d{2}-\d{2}$/.test(C.clean(s.eventDate)));});if(invalid.length){status('Every included session needs a valid event name and event date.','warn');return;}
    setBusy(true);status('Saving raw submissions and reconciliation…','ok');
    try{
      await persistFormRecords();status('Form data saved. Updating Event Log attendance…','ok');await writeAttendance();await markBatchCommitted();if(S().refreshFromRemote)await S().refreshFromRemote(true,true);await loadPersisted();status('Import committed. Event Log hours, T-shirt withdrawals and feedback are now available.','ok');state.sessions=[];state.signIns=[];state.signOuts=[];state.batchId='';state.activeTab='history';render();
    }catch(error){console.error(error);status(error.message+' The batch remains pending and can be retried safely.','bad');}
    finally{setBusy(false);render();}
  }

  function dbSubmissionToCore(r){const iso=r.submitted_at||'',date=r.submitted_date||String(iso).slice(0,10),base={id:r.id,type:r.submission_type,responseId:r.source_response_id||'',fileName:r.source_file_name||'',timestamp:{iso:iso,date:date,ms:Date.parse(iso)},name:r.full_name||'',email:r.email||'',phone:r.phone||'',eventName:r.event_name||'',shirtQuantity:Number(r.shirt_quantity)||0,shirtSize:r.shirt_size||'',raw:r.raw_payload||{}};if(r.submission_type==='sign_out')base.feedback={ageGroup:r.age_group||'',gender:r.gender||'',tenure:r.volunteer_tenure||'',frequency:r.volunteer_frequency||'',briefing:r.briefing_rating==null?null:Number(r.briefing_rating),onboarding:r.onboarding_rating==null?null:Number(r.onboarding_rating),roleSatisfaction:r.role_satisfaction_rating==null?null:Number(r.role_satisfaction_rating),staffSupport:r.staff_support_rating==null?null:Number(r.staff_support_rating),improvement:r.improvement_feedback||'',recommend:r.recommendation||'',referralEmail:r.referral_email||''};return base;}
  async function loadPersisted(){
    if(!sharedReady())return;const results=await Promise.all([S().fetchRows('form_import_batches','*'),S().fetchRows('form_submissions','*'),S().fetchRows('attendance_reconciliations','*')]);state.batches=results[0]||[];state.submissions=results[1]||[];const committed={};state.batches.forEach(function(b){if(b.status==='committed')committed[b.id]=true;});const map={};state.submissions.forEach(function(r){map[r.id]=dbSubmissionToCore(r);});state.persistedSessions=(results[2]||[]).filter(function(r){return committed[r.batch_id]&&r.included;}).map(function(r){return{id:r.id,signIn:r.sign_in_submission_id?map[r.sign_in_submission_id]||null:null,signOut:r.sign_out_submission_id?map[r.sign_out_submission_id]||null:null,eventName:r.event_name,eventDate:r.event_date,calculatedMinutes:r.calculated_duration_minutes,staffCreditedMinutes:r.staff_credited_duration_minutes,staffCreditNote:r.staff_credit_note||'',included:r.included,reviewAcknowledged:r.review_acknowledged,reviewFlags:Array.isArray(r.review_flags)?r.review_flags:[],matchStatus:r.match_status,matchConfidence:r.match_confidence};});
  }

  document.addEventListener('DOMContentLoaded',install);
})();