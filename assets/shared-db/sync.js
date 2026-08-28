(function initMaklomSharedSync(){
  'use strict';
  const S=window.MaklomSharedDB,st=S.state;
  S.conflictError=function(table,id,action){const e=new Error('Another staff member changed or deleted this '+S.humanTable(table).replace(/s$/,'')+' after you loaded it. Your '+action+' was not allowed to overwrite the newer server version.');e.code='SYNC_CONFLICT';e.table=table;e.id=id;return e;};
  S.insertVersionedRow=async function(table,row){const r=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});if(!r.ok)throw new Error(table+' insert failed: '+await r.text());const rows=await r.json();if(!rows.length)throw new Error(table+' insert returned no record.');st.remoteVersions[table][row.id]=Number(rows[0].row_version)||1;};
  S.updateVersionedRow=async function(table,row,expected){const r=await S.apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(expected),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)});if(!r.ok)throw new Error(table+' update failed: '+await r.text());const rows=await r.json();if(!rows.length)throw S.conflictError(table,row.id,'edit');st.remoteVersions[table][row.id]=Number(rows[0].row_version)||expected+1;};
  S.deleteVersionedRow=async function(table,id,expected){const r=await S.apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id)+'&row_version=eq.'+encodeURIComponent(expected),{method:'DELETE',headers:{Prefer:'return=representation'}});if(!r.ok)throw new Error(table+' delete failed: '+await r.text());const rows=await r.json();if(!rows.length)throw S.conflictError(table,id,'delete');delete st.remoteVersions[table][id];};
  S.appendMergeRows=async function(rows){if(!rows.length)return;const r=await S.apiFetch('/rest/v1/merge_log?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});if(!r.ok)throw new Error('merge_log save failed: '+await r.text());};
  S.bulkDeleteInfo=function(table,removed,count){if(removed.length<S.config.bulkDeleteMin||removed.length<Math.ceil(count*S.config.bulkDeleteRatio))return null;const sig=table+'|'+removed.slice().sort().join('|');return st.approvedBulkDeleteSignature===sig?null:{table:table,removed:removed.slice(),previousCount:count,signature:sig};};
  S.localDifferencesRemain=function(){const c=S.canonicalSnapshot();return S.config.syncTables.some(function(table){const a=c[table],b=st.lastSnapshot[table]||{},ids=new Set(Object.keys(a).concat(Object.keys(b)));for(const id of ids){if(!a[id]||!b[id]||!S.same(a[id],b[id]))return true;}return false;});};
  S.syncChanges=async function(){
    if(!st.ready||!S.canWrite()||st.suppressSync||st.syncBlocked)return;
    if(!navigator.onLine){S.setSyncStatus('bad','Offline — cached');return;}
    if(st.syncInFlight){st.syncQueued=true;return;}
    clearTimeout(st.syncTimer);st.syncInFlight=true;S.setSyncStatus('syncing','Saving…');let drafts=0;
    try{
      const current=S.canonicalSnapshot(),previous=st.lastSnapshot||S.emptySnapshot();
      for(const table of S.config.versionedTables){
        const changed=Object.keys(current[table]).filter(function(id){return !previous[table][id]||!S.same(current[table][id],previous[table][id]);});
        for(const id of changed){
          const row=current[table][id],existed=!!previous[table][id];
          if(!S.recordValidForWrite(table,row)){if(!existed){drafts++;continue;}const e=new Error('This '+S.humanTable(table).replace(/s$/,'')+' has required fields missing. Fix the row before it can be saved.');e.code='VALIDATION';throw e;}
          if(existed){const expected=st.remoteVersions[table]&&st.remoteVersions[table][id];if(!expected)throw S.conflictError(table,id,'edit');await S.updateVersionedRow(table,row,expected);}else await S.insertVersionedRow(table,row);
          st.lastSnapshot[table][id]=S.clone(row);
        }
        const removed=Object.keys(previous[table]).filter(function(id){return !current[table][id];}),bulk=S.bulkDeleteInfo(table,removed,Object.keys(previous[table]).length);
        if(bulk){st.syncBlocked={type:'bulk-delete',info:bulk};S.showSafetyPanel(st.syncBlocked);S.setSyncStatus('bad','Delete review');return;}
        for(const id of removed){const expected=st.remoteVersions[table]&&st.remoteVersions[table][id];if(!expected)throw S.conflictError(table,id,'delete');await S.deleteVersionedRow(table,id,expected);delete st.lastSnapshot[table][id];}
      }
      const newMerge=Object.keys(current.merge_log).filter(function(id){return !previous.merge_log[id];}).map(function(id){return current.merge_log[id];});await S.appendMergeRows(newMerge);newMerge.forEach(function(row){st.lastSnapshot.merge_log[row.id]=S.clone(row);});
      st.approvedBulkDeleteSignature='';st.lastRemoteRefresh=Date.now();
      if(S.localDifferencesRemain()){S.markDirty();S.setSyncStatus('syncing',drafts?'Draft not saved':'Pending');}else{S.clearDirty();S.setSyncStatus('ok','Saved');}
    }catch(error){
      console.error(error);S.markDirty();
      if(error.code==='SYNC_CONFLICT'){st.syncBlocked={type:'conflict',info:{table:error.table,id:error.id,message:error.message}};S.showSafetyPanel(st.syncBlocked);S.setSyncStatus('bad','Conflict');}
      else{S.setSyncStatus('bad',error.code==='VALIDATION'?'Needs attention':'Sync error');S.showSharedNotice(error.message,'bad');}
    }finally{st.syncInFlight=false;if(st.syncQueued&&!st.syncBlocked){st.syncQueued=false;S.scheduleSync();}else st.syncQueued=false;}
  };
  S.scheduleSync=function(){if(!st.ready||!S.canWrite()||st.suppressSync||st.syncBlocked)return;clearTimeout(st.syncTimer);st.syncTimer=setTimeout(S.syncChanges,S.config.syncDelayMs);};

  saveData=function(){
    if(st.ready&&!S.canWrite()){S.showSharedNotice('This account has read-only access. Local edits were discarded.','warn');setTimeout(function(){S.refreshFromRemote(true,true);},0);return;}
    S.originalSaveData();
    if(st.ready&&S.canWrite()){S.markDirty();S.setSyncStatus(navigator.onLine?'syncing':'bad',navigator.onLine?'Unsaved':'Offline — cached');S.scheduleSync();}
  };
  clearLocalData=function(){if(st.ready){alert('MakLom is using the shared database. Use record-level delete actions instead of clearing the browser cache.');return;}return S.originalClearLocalData();};

  S.adoptRemote=async function(bundle){st.suppressSync=true;appData=validateJsonSave(bundle.data);S.originalSaveData();st.suppressSync=false;st.remoteVersions=S.clone(bundle.versions||S.emptyVersions());st.lastSnapshot=S.canonicalSnapshot();st.lastRemoteRefresh=Date.now();S.clearDirty();st.syncBlocked=null;st.pendingRemoteBundle=null;S.hideSafetyPanel();renderAll();};
  S.refreshFromRemote=async function(force,discardLocal){
    if(!st.ready||st.syncInFlight)return;if(!force&&Date.now()-st.lastRemoteRefresh<S.config.refreshThrottleMs)return;if((S.isDirty()||st.syncBlocked)&&!discardLocal){S.setSyncStatus('syncing','Unsaved');return;}
    try{await S.loadMember();if(!st.member||!st.member.active){st.ready=false;S.clearCachedPii();S.renderAuthState();const m=document.getElementById('sharedAuthMessage');if(m)m.innerHTML='<div class="notice warn">This account is no longer authorised for MakLom.</div>';return;}const b=await S.loadRemoteBundle();await S.adoptRemote(b);S.setSyncStatus('ok','Up to date');}
    catch(error){S.setSyncStatus('bad','Refresh error');S.showSharedNotice(error.message,'bad');console.error(error);}
  };
  S.uploadLocalDatabase=async function(){if(!S.canWrite())throw new Error('Your account does not have edit access.');if(S.remoteHasData(st.pendingRemoteBundle))throw new Error('The shared database is no longer empty. Reload the server copy instead of running the one-time upload.');st.lastSnapshot=S.emptySnapshot();st.remoteVersions=S.emptyVersions();st.syncBlocked=null;S.markDirty();await S.syncChanges();if(!S.isDirty()){S.showSharedNotice('This browser database has been uploaded to the shared MakLom database.','ok');document.getElementById('migrationPanel').classList.add('hidden');}};
})();