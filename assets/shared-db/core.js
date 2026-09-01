(function initMaklomSharedCore(){
  'use strict';
  const S=window.MaklomSharedDB=window.MaklomSharedDB||{};
  S.config={
    url:'https://nqthzoakznqgllhfhgpn.supabase.co',
    key:'sb_publishable_Fh4yoN-Zl5gL_-6SjKCwrw_GNEbcoU0',
    sessionKey:'maklom.supabase.session.v1',
    dirtyKey:'maklom.supabase.dirty.v1',
    localDataKey:typeof STORAGE_KEY==='string'?STORAGE_KEY:'volunteerDatabaseTool.v1',
    syncDelayMs:500,refreshEarlySeconds:60,refreshThrottleMs:15000,pageSize:1000,
    bulkDeleteMin:10,bulkDeleteRatio:0.20,
    versionedTables:['volunteers','attendance_log','reporting_metrics','suspected_duplicates'],
    syncTables:['volunteers','attendance_log','reporting_metrics','suspected_duplicates','merge_log']
  };
  S.state={session:null,member:null,ready:false,syncTimer:null,syncInFlight:false,syncQueued:false,lastSnapshot:null,remoteVersions:null,lastRemoteRefresh:0,suppressSync:false,syncBlocked:null,pendingRemoteBundle:null,approvedBulkDeleteSignature:''};
  S.originalSaveData=saveData;
  S.originalClearLocalData=clearLocalData;
  S.text=function(v){return String(v==null?'':v);};
  S.clone=function(v){return JSON.parse(JSON.stringify(v));};
  S.nonBlank=function(v){const x=S.text(v).trim();return x||null;};
  S.lower=function(v){return S.text(v).trim().toLowerCase();};
  S.phoneKey=function(v){return S.text(v).replace(/\D/g,'');};
  S.dateIso=function(v){return v?S.text(v).slice(0,10):null;};
  S.same=function(a,b){return JSON.stringify(a)===JSON.stringify(b);};
  S.mapById=function(rows){const out={};(rows||[]).forEach(function(row){out[row.id]=row;});return out;};
  S.emptySnapshot=function(){return{volunteers:{},attendance_log:{},reporting_metrics:{},suspected_duplicates:{},merge_log:{}};};
  S.emptyVersions=function(){return{volunteers:{},attendance_log:{},reporting_metrics:{},suspected_duplicates:{}};};
  S.state.lastSnapshot=S.emptySnapshot();S.state.remoteVersions=S.emptyVersions();
  S.currentUserId=function(){const x=S.state.session;return x&&x.user&&x.user.id||null;};
  S.canWrite=function(){const m=S.state.member;return !!(m&&m.active&&(m.role==='editor'||m.role==='admin'));};
  S.getAccessState=function(){const st=S.state,m=st.member;if(!st.session)return{status:'signed_out',ready:false,authenticated:false,active:false,role:null,canWrite:false,canDelete:false};if(!m)return{status:'loading',ready:false,authenticated:true,active:false,role:null,canWrite:false,canDelete:false};if(!m.active)return{status:'unauthorized',ready:false,authenticated:true,active:false,role:m.role||null,canWrite:false,canDelete:false};if(!st.ready)return{status:'loading',ready:false,authenticated:true,active:true,role:m.role||null,canWrite:false,canDelete:false};const writable=m.role==='editor'||m.role==='admin';return{status:writable?'writable':'read_only',ready:true,authenticated:true,active:true,role:m.role||null,canWrite:writable,canDelete:m.role==='admin'};};
  S.emitAccessState=function(){const detail=S.getAccessState();window.dispatchEvent(new CustomEvent('maklom:access-state',{detail:detail}));return detail;};
  S.isDirty=function(){return sessionStorage.getItem(S.config.dirtyKey)==='1'||localStorage.getItem(S.config.dirtyKey)==='1';};
  S.markDirty=function(){sessionStorage.setItem(S.config.dirtyKey,'1');localStorage.setItem(S.config.dirtyKey,'1');};
  S.clearDirty=function(){sessionStorage.removeItem(S.config.dirtyKey);localStorage.removeItem(S.config.dirtyKey);};

  S.sessionHeaders=function(extra){
    const headers={apikey:S.config.key};
    if(S.state.session&&S.state.session.access_token)headers.Authorization='Bearer '+S.state.session.access_token;
    return Object.assign(headers,extra||{});
  };
  S.apiFetch=async function(path,options){
    const opts=Object.assign({},options||{});opts.headers=Object.assign({},S.sessionHeaders(),opts.headers||{});
    let response=await fetch(S.config.url+path,opts);
    if(response.status===401&&S.state.session&&S.state.session.refresh_token){
      if(await S.refreshSession()){opts.headers=Object.assign({},S.sessionHeaders(),options&&options.headers||{});response=await fetch(S.config.url+path,opts);}
    }
    return response;
  };
  S.persistSession=function(session){
    S.state.session=session||null;localStorage.removeItem(S.config.sessionKey);
    if(S.state.session)sessionStorage.setItem(S.config.sessionKey,JSON.stringify(S.state.session));else sessionStorage.removeItem(S.config.sessionKey);
  };
  S.readStoredSession=function(){
    try{
      let raw=sessionStorage.getItem(S.config.sessionKey);
      if(!raw){raw=localStorage.getItem(S.config.sessionKey);if(raw)localStorage.removeItem(S.config.sessionKey);}
      if(!raw)return null;const parsed=JSON.parse(raw);return parsed&&parsed.access_token&&parsed.refresh_token?parsed:null;
    }catch(error){return null;}
  };
  S.tokenExpiresSoon=function(session){return !!(session&&session.expires_at&&Number(session.expires_at)-Math.floor(Date.now()/1000)<S.config.refreshEarlySeconds);};
  S.refreshSession=async function(){
    const session=S.state.session;if(!session||!session.refresh_token)return false;
    try{
      const response=await fetch(S.config.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:S.config.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
      if(!response.ok){S.persistSession(null);return false;}const data=await response.json();data.expires_at=Math.floor(Date.now()/1000)+Number(data.expires_in||3600);S.persistSession(data);return true;
    }catch(error){return false;}
  };
  S.signIn=async function(email,password){
    const response=await fetch(S.config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:S.config.key,'Content-Type':'application/json'},body:JSON.stringify({email:email,password:password})});
    const data=await response.json().catch(function(){return{};});if(!response.ok)throw new Error(data.error_description||data.msg||data.message||'Sign-in failed.');
    data.expires_at=Math.floor(Date.now()/1000)+Number(data.expires_in||3600);S.persistSession(data);return data;
  };
  S.loadMember=async function(){
    const userId=S.currentUserId();if(!userId)return null;
    const response=await S.apiFetch('/rest/v1/app_members?user_id=eq.'+encodeURIComponent(userId)+'&select=user_id,role,active',{method:'GET'});
    if(!response.ok)throw new Error('Could not verify MakLom access.');const rows=await response.json();S.state.member=rows[0]||null;return S.state.member;
  };
  S.blankLocalData=function(){return validateJsonSave({volunteers:[],attendanceLog:[],suspectedDuplicates:[],mergeLog:[],reportingMetrics:[]});};
  S.clearCachedPii=function(){localStorage.removeItem(S.config.localDataKey);S.clearDirty();appData=S.blankLocalData();pendingImport=null;expandedVolunteerId=null;};
})();