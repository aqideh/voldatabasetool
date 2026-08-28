(function installMaklomSharedDatabase(){
  'use strict';

  const SUPABASE_URL='https://nqthzoakznqgllhfhgpn.supabase.co';
  const SUPABASE_KEY='sb_publishable_Fh4yoN-Zl5gL_-6SjKCwrw_GNEbcoU0';
  const SESSION_KEY='maklom.supabase.session.v1';
  const LOCAL_DATA_KEY=typeof STORAGE_KEY==='string'?STORAGE_KEY:'volunteerDatabaseTool.v1';
  const SYNC_DELAY_MS=350;
  const REFRESH_EARLY_SECONDS=60;

  let sharedSession=null;
  let sharedMember=null;
  let sharedReady=false;
  let syncTimer=null;
  let syncInFlight=false;
  let syncQueued=false;
  let lastSnapshot=null;
  let lastRemoteRefresh=0;
  let suppressRemoteSync=false;

  const originalSaveData=saveData;
  const originalClearLocalData=clearLocalData;

  function clone(value){return JSON.parse(JSON.stringify(value));}
  function text(value){return String(value==null?'':value);}
  function nonBlank(value){const v=text(value).trim();return v||null;}
  function lower(value){return text(value).trim().toLowerCase();}
  function phoneKey(value){return text(value).replace(/\D/g,'');}
  function dateIso(value){return value?text(value).slice(0,10):null;}
  function currentUserId(){return sharedSession&&sharedSession.user&&sharedSession.user.id||null;}
  function canWrite(){return !!(sharedMember&&sharedMember.active&&(sharedMember.role==='editor'||sharedMember.role==='admin'));}
  function canAdmin(){return !!(sharedMember&&sharedMember.active&&sharedMember.role==='admin');}

  function sessionHeaders(extra){
    const headers={'apikey':SUPABASE_KEY};
    if(sharedSession&&sharedSession.access_token)headers.Authorization='Bearer '+sharedSession.access_token;
    return Object.assign(headers,extra||{});
  }

  async function apiFetch(path,options){
    const opts=Object.assign({},options||{});
    opts.headers=Object.assign({},sessionHeaders(),opts.headers||{});
    let response=await fetch(SUPABASE_URL+path,opts);
    if(response.status===401&&sharedSession&&sharedSession.refresh_token){
      const refreshed=await refreshSession();
      if(refreshed){
        opts.headers=Object.assign({},sessionHeaders(),options&&options.headers||{});
        response=await fetch(SUPABASE_URL+path,opts);
      }
    }
    return response;
  }

  function persistSession(session){
    sharedSession=session||null;
    if(sharedSession)localStorage.setItem(SESSION_KEY,JSON.stringify(sharedSession));
    else localStorage.removeItem(SESSION_KEY);
  }

  function readStoredSession(){
    try{
      const raw=localStorage.getItem(SESSION_KEY);
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      return parsed&&parsed.access_token&&parsed.refresh_token?parsed:null;
    }catch(error){return null;}
  }

  function tokenExpiresSoon(session){
    if(!session||!session.expires_at)return false;
    return Number(session.expires_at)-Math.floor(Date.now()/1000)<REFRESH_EARLY_SECONDS;
  }

  async function refreshSession(){
    if(!sharedSession||!sharedSession.refresh_token)return false;
    try{
      const response=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:sharedSession.refresh_token})
      });
      if(!response.ok){persistSession(null);return false;}
      const data=await response.json();
      data.expires_at=Math.floor(Date.now()/1000)+Number(data.expires_in||3600);
      persistSession(data);
      return true;
    }catch(error){return false;}
  }

  async function signIn(email,password){
    const response=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email:email,password:password})
    });
    const data=await response.json().catch(function(){return{};});
    if(!response.ok)throw new Error(data.error_description||data.msg||data.message||'Sign-in failed.');
    data.expires_at=Math.floor(Date.now()/1000)+Number(data.expires_in||3600);
    persistSession(data);
    return data;
  }

  async function signOut(){
    try{if(sharedSession)await apiFetch('/auth/v1/logout',{method:'POST'});}catch(error){}
    persistSession(null);
    sharedMember=null;sharedReady=false;lastSnapshot=null;
    renderAuthState();
  }

  async function fetchRows(table,select){
    const response=await apiFetch('/rest/v1/'+table+'?select='+encodeURIComponent(select||'*'),{method:'GET'});
    if(!response.ok){const body=await response.text();throw new Error(table+' load failed: '+body);}
    return response.json();
  }

  async function loadMember(){
    const userId=currentUserId();
    if(!userId)return null;
    const response=await apiFetch('/rest/v1/app_members?user_id=eq.'+encodeURIComponent(userId)+'&select=user_id,role,active',{method:'GET'});
    if(!response.ok)throw new Error('Could not verify MakLom access.');
    const rows=await response.json();
    sharedMember=rows[0]||null;
    return sharedMember;
  }

  function dbVolunteerToLocal(row){
    return{
      id:row.id,name:row.name||'',nric:row.nric||'',phone:row.phone||'',email:row.email||'',gender:row.gender||'',address:row.address||'',
      recruitedYear:row.recruited_year==null?'':String(row.recruited_year),chatSession:row.chat_session||'',chatSessionDate:row.chat_session_date||'',
      interests:row.interests||'',languagesSpoken:row.languages_spoken||'',programmesRegistered:Array.isArray(row.programmes_registered)?row.programmes_registered.join(', '):'',
      tags:Array.isArray(row.tags)?row.tags:[],emergencyName:row.emergency_name||'',emergencyPhone:row.emergency_phone||'',shirtSize:row.shirt_size||'',
      dietary:row.dietary||'',notes:row.notes||'',attendance:[]
    };
  }

  function dbEventToLocal(row){
    return{
      id:row.id,name:row.name||'',email:row.email||'',contact:row.contact||'',attendance:row.attended?'yes':'',eventName:row.event_name||'',
      eventDate:row.event_date||'',durationMinutes:Number(row.duration_minutes)||0,
      grabVoucherCode1:row.grab_voucher_code_1||'',grabVoucherCode2:row.grab_voucher_code_2||'',grabVoucherCode3:row.grab_voucher_code_3||''
    };
  }

  function dbDuplicateToLocal(row){
    return{id:row.id,level:row.level,existingId:row.existing_volunteer_id||'',incoming:row.incoming||{},decision:row.decision||'pending',reason:row.reason||''};
  }

  function dbMergeToLocal(row){
    return{date:row.occurred_at,level:row.level||'',action:row.action||'',existingName:row.existing_name||'',incomingName:row.incoming_name||'',reason:row.reason||''};
  }

  async function loadRemoteData(){
    const results=await Promise.all([
      fetchRows('volunteers','*'),fetchRows('attendance_log','*'),fetchRows('reporting_metrics','*'),fetchRows('suspected_duplicates','*'),fetchRows('merge_log','*')
    ]);
    const remote={
      volunteers:results[0].map(dbVolunteerToLocal),
      attendanceLog:results[1].map(dbEventToLocal),
      reportingMetrics:results[2].map(function(r){return{id:r.id,label:r.label||'',value:r.value==null?null:Number(r.value),note:r.note||''};}),
      suspectedDuplicates:results[3].map(dbDuplicateToLocal),
      mergeLog:results[4].map(dbMergeToLocal)
    };
    return validateJsonSave(remote);
  }

  function volunteerToDb(v){
    return{
      id:v.id,name:text(v.name),nric:nonBlank(v.nric),phone:nonBlank(v.phone),email:nonBlank(v.email),gender:nonBlank(v.gender),address:nonBlank(v.address),
      recruited_year:v.recruitedYear?Number(v.recruitedYear):null,chat_session:nonBlank(v.chatSession),chat_session_date:dateIso(v.chatSessionDate),
      interests:nonBlank(v.interests),languages_spoken:nonBlank(v.languagesSpoken),programmes_registered:typeof programmesToArray==='function'?programmesToArray(v.programmesRegistered):[],
      tags:Array.isArray(v.tags)?v.tags:[],emergency_name:nonBlank(v.emergencyName),emergency_phone:nonBlank(v.emergencyPhone),shirt_size:nonBlank(v.shirtSize),
      dietary:nonBlank(v.dietary),notes:nonBlank(v.notes)
    };
  }

  function matchedVolunteerId(eventRow){
    const email=lower(eventRow.email),phone=phoneKey(eventRow.contact);
    const match=(appData.volunteers||[]).find(function(v){return(email&&lower(v.email)===email)||(phone&&phoneKey(v.phone)===phone);});
    return match?match.id:null;
  }

  function eventToDb(row){
    return{
      id:row.id,volunteer_id:matchedVolunteerId(row),name:text(row.name),email:nonBlank(row.email),contact:nonBlank(row.contact),attended:normaliseAttendanceFlag(row.attendance)==='yes',
      event_name:text(row.eventName),event_date:dateIso(row.eventDate),duration_minutes:Number(row.durationMinutes)||0,
      grab_voucher_code_1:nonBlank(row.grabVoucherCode1),grab_voucher_code_2:nonBlank(row.grabVoucherCode2),grab_voucher_code_3:nonBlank(row.grabVoucherCode3)
    };
  }

  function metricToDb(row){return{id:row.id,label:text(row.label),value:row.value==null?null:Number(row.value),note:nonBlank(row.note)};}
  function duplicateToDb(row){return{id:row.id,level:row.level||'low',existing_volunteer_id:nonBlank(row.existingId),incoming:row.incoming||{},decision:row.decision||'pending',reason:nonBlank(row.reason)};}

  function hashString(value){
    let hash=2166136261;
    for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return(hash>>>0).toString(36);
  }

  function mergeLogId(row){
    return'merge_'+hashString([row.date,row.level,row.action,row.existingName,row.incomingName,row.reason].map(text).join('|'));
  }
  function mergeToDb(row){return{id:mergeLogId(row),occurred_at:row.date||new Date().toISOString(),level:nonBlank(row.level),action:text(row.action),existing_name:nonBlank(row.existingName),incoming_name:nonBlank(row.incomingName),reason:nonBlank(row.reason)};}

  function currentCanonical(){
    return{
      volunteers:(appData.volunteers||[]).map(volunteerToDb),
      attendance_log:(appData.attendanceLog||[]).map(eventToDb),
      reporting_metrics:(appData.reportingMetrics||[]).map(metricToDb),
      suspected_duplicates:(appData.suspectedDuplicates||[]).map(duplicateToDb),
      merge_log:(appData.mergeLog||[]).map(mergeToDb)
    };
  }

  function mapById(rows){const out={};(rows||[]).forEach(function(row){out[row.id]=row;});return out;}
  function canonicalSnapshot(){const current=currentCanonical();return{
    volunteers:mapById(current.volunteers),attendance_log:mapById(current.attendance_log),reporting_metrics:mapById(current.reporting_metrics),
    suspected_duplicates:mapById(current.suspected_duplicates),merge_log:mapById(current.merge_log)
  };}
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}

  async function upsertRows(table,rows){
    if(!rows.length)return;
    const response=await apiFetch('/rest/v1/'+table+'?on_conflict=id',{
      method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)
    });
    if(!response.ok)throw new Error(table+' save failed: '+await response.text());
  }

  async function deleteRow(table,id){
    const response=await apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:{'Prefer':'return=minimal'}});
    if(!response.ok)throw new Error(table+' delete failed: '+await response.text());
  }

  async function insertAudit(entries){
    if(!entries.length)return;
    const actor=currentUserId();
    const rows=entries.map(function(e){return{actor_user_id:actor,entity_type:e.table,entity_id:e.id,action:e.action,details:{source:'maklom-web'}};});
    const response=await apiFetch('/rest/v1/audit_log',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(rows)});
    if(!response.ok)console.warn('MakLom audit write failed',await response.text());
  }

  async function syncChanges(){
    if(!sharedReady||!canWrite()||suppressRemoteSync)return;
    if(syncInFlight){syncQueued=true;return;}
    syncInFlight=true;
    setSyncStatus('syncing','Saving…');
    try{
      const current=canonicalSnapshot();
      const previous=lastSnapshot||{volunteers:{},attendance_log:{},reporting_metrics:{},suspected_duplicates:{},merge_log:{}};
      const audit=[];
      for(const table of Object.keys(current)){
        const changed=[];
        Object.keys(current[table]).forEach(function(id){
          if(!previous[table][id]||!same(current[table][id],previous[table][id])){changed.push(current[table][id]);audit.push({table:table,id:id,action:previous[table][id]?'update':'insert'});}
        });
        await upsertRows(table,changed);
        if(table!=='merge_log'){
          const removed=Object.keys(previous[table]).filter(function(id){return !current[table][id];});
          for(const id of removed){await deleteRow(table,id);audit.push({table:table,id:id,action:'delete'});}
        }
      }
      await insertAudit(audit);
      lastSnapshot=current;
      lastRemoteRefresh=Date.now();
      setSyncStatus('ok','Saved');
    }catch(error){
      console.error(error);setSyncStatus('bad','Sync error');showSharedNotice(error.message,'bad');
    }finally{
      syncInFlight=false;
      if(syncQueued){syncQueued=false;scheduleSync();}
    }
  }

  function scheduleSync(){
    if(!sharedReady||!canWrite()||suppressRemoteSync)return;
    clearTimeout(syncTimer);syncTimer=setTimeout(syncChanges,SYNC_DELAY_MS);
  }

  saveData=function(){
    originalSaveData();
    scheduleSync();
  };

  clearLocalData=function(){
    if(sharedReady){
      alert('MakLom is using the shared database. Use record-level delete actions instead of clearing the browser database.');
      return;
    }
    return originalClearLocalData();
  };

  function localHasData(){
    return !!((appData.volunteers&&appData.volunteers.length)||(appData.attendanceLog&&appData.attendanceLog.length)||(appData.mergeLog&&appData.mergeLog.length));
  }

  function remoteHasData(remote){
    return !!((remote.volunteers&&remote.volunteers.length)||(remote.attendanceLog&&remote.attendanceLog.length)||(remote.mergeLog&&remote.mergeLog.length));
  }

  async function uploadLocalDatabase(){
    if(!canWrite())throw new Error('Your account does not have edit access.');
    suppressRemoteSync=true;
    try{
      lastSnapshot={volunteers:{},attendance_log:{},reporting_metrics:{},suspected_duplicates:{},merge_log:{}};
      suppressRemoteSync=false;
      await syncChanges();
      showSharedNotice('This browser database has been uploaded to the shared MakLom database.','ok');
      document.getElementById('migrationPanel').classList.add('hidden');
    }finally{suppressRemoteSync=false;}
  }

  async function adoptRemote(remote){
    suppressRemoteSync=true;
    appData=validateJsonSave(remote);
    originalSaveData();
    suppressRemoteSync=false;
    lastSnapshot=canonicalSnapshot();
    lastRemoteRefresh=Date.now();
    renderAll();
  }

  async function refreshFromRemote(force){
    if(!sharedReady||syncInFlight)return;
    if(!force&&Date.now()-lastRemoteRefresh<15000)return;
    try{
      const remote=await loadRemoteData();
      await adoptRemote(remote);
      setSyncStatus('ok','Up to date');
    }catch(error){setSyncStatus('bad','Refresh error');console.error(error);}
  }

  function setSyncStatus(kind,label){
    const el=document.getElementById('sharedSyncStatus');if(!el)return;
    el.textContent=label;el.className='pill '+(kind==='bad'?'bad':kind==='syncing'?'neutral':'ok');
  }

  function showSharedNotice(message,kind){
    const el=document.getElementById('sharedDatabaseNotice');if(!el)return;
    el.className='notice '+(kind==='bad'?'bad':kind==='warn'?'warn':'ok');el.textContent=message;el.classList.remove('hidden');
  }

  function renderAuthState(){
    const gate=document.getElementById('sharedAuthGate'),app=document.getElementById('sharedAppShell');
    if(!gate||!app)return;
    if(!sharedSession){gate.classList.remove('hidden');app.classList.add('shared-locked');return;}
    if(!sharedMember||!sharedMember.active){gate.classList.remove('hidden');app.classList.add('shared-locked');return;}
    gate.classList.add('hidden');app.classList.remove('shared-locked');
    const account=document.getElementById('sharedAccountLabel');if(account)account.textContent=(sharedSession.user&&sharedSession.user.email||'Signed in')+' · '+sharedMember.role;
  }

  function injectUi(){
    const body=document.body;
    const shell=document.createElement('div');shell.id='sharedAppShell';
    while(body.firstChild)shell.appendChild(body.firstChild);
    body.appendChild(shell);

    const gate=document.createElement('div');gate.id='sharedAuthGate';gate.className='shared-auth-gate';
    gate.innerHTML='<div class="shared-auth-card"><h1>MakLom</h1><p class="muted">Sign in with an authorised staff account to access the shared volunteer database.</p><div id="sharedAuthMessage"></div><label for="sharedEmail">Email</label><input id="sharedEmail" type="email" autocomplete="username"><label for="sharedPassword">Password</label><input id="sharedPassword" type="password" autocomplete="current-password"><button id="sharedSignIn" class="primary" type="button">Sign in</button></div>';
    body.insertBefore(gate,shell);

    const nav=shell.querySelector('nav');
    if(nav){
      const status=document.createElement('span');status.className='shared-account';status.innerHTML='<span id="sharedSyncStatus" class="pill neutral">Offline</span> <span id="sharedAccountLabel"></span> <button id="sharedRefresh" type="button" class="small">Refresh</button> <button id="sharedSignOut" type="button" class="small">Sign out</button>';nav.appendChild(status);
    }

    const main=shell.querySelector('main');
    if(main){
      const notice=document.createElement('div');notice.id='sharedDatabaseNotice';notice.className='notice hidden';main.insertBefore(notice,main.firstChild);
      const migration=document.createElement('div');migration.id='migrationPanel';migration.className='card hidden';migration.innerHTML='<h2>Move this browser database to Supabase</h2><p class="muted">The shared database is empty, but this browser contains MakLom data. Upload it once to make it available on other computers. A local JSON/XLSX backup is recommended first.</p><button id="uploadLocalDatabase" class="primary" type="button">Upload this browser database</button>';main.insertBefore(migration,notice.nextSibling);
    }

    document.getElementById('sharedSignIn').addEventListener('click',handleSignIn);
    document.getElementById('sharedPassword').addEventListener('keydown',function(e){if(e.key==='Enter')handleSignIn();});
    document.getElementById('sharedSignOut').addEventListener('click',signOut);
    document.getElementById('sharedRefresh').addEventListener('click',function(){refreshFromRemote(true);});
    document.getElementById('uploadLocalDatabase').addEventListener('click',function(){uploadLocalDatabase().catch(function(error){showSharedNotice(error.message,'bad');});});
  }

  async function handleSignIn(){
    const email=document.getElementById('sharedEmail').value.trim();
    const password=document.getElementById('sharedPassword').value;
    const message=document.getElementById('sharedAuthMessage');
    message.innerHTML='';
    try{
      await signIn(email,password);await initialiseAuthenticatedApp();
    }catch(error){message.innerHTML='<div class="notice bad">'+escapeHtml(error.message)+'</div>';}
  }

  async function initialiseAuthenticatedApp(){
    if(!sharedSession)return;
    if(tokenExpiresSoon(sharedSession))await refreshSession();
    await loadMember();
    if(!sharedMember||!sharedMember.active){
      sharedReady=false;renderAuthState();
      const message=document.getElementById('sharedAuthMessage');
      if(message)message.innerHTML='<div class="notice warn">This Supabase account exists but has not been authorised for MakLom. Ask an administrator to add it to app_members.</div>';
      return;
    }
    const browserBefore=clone(appData);
    const remote=await loadRemoteData();
    sharedReady=true;renderAuthState();
    if(!remoteHasData(remote)&&localHasData()){
      appData=browserBefore;originalSaveData();lastSnapshot={volunteers:{},attendance_log:{},reporting_metrics:{},suspected_duplicates:{},merge_log:{}};renderAll();
      document.getElementById('migrationPanel').classList.remove('hidden');
      showSharedNotice('Shared database connected. This browser still has local data that has not yet been uploaded.','warn');
    }else{
      await adoptRemote(remote);document.getElementById('migrationPanel').classList.add('hidden');
      showSharedNotice('Connected to the shared MakLom database.','ok');
    }
    setSyncStatus('ok','Up to date');
  }

  async function bootstrap(){
    injectUi();
    const stored=readStoredSession();
    if(stored){persistSession(stored);if(tokenExpiresSoon(stored))await refreshSession();}
    renderAuthState();
    if(sharedSession){
      try{await initialiseAuthenticatedApp();}catch(error){console.error(error);persistSession(null);sharedMember=null;sharedReady=false;renderAuthState();showSharedNotice('Could not connect to the shared database. '+error.message,'bad');}
    }
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')refreshFromRemote(false);});
    window.addEventListener('focus',function(){refreshFromRemote(false);});
  }

  document.addEventListener('DOMContentLoaded',function(){bootstrap();});
})();
