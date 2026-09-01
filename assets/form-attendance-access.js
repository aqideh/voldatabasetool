(function initFormAttendanceAccess(){
  'use strict';

  function accessState(){
    const S=window.MaklomSharedDB;
    if(!S||typeof S.getAccessState!=='function')return{status:'loading',canWrite:false,canDelete:false};
    return S.getAccessState();
  }

  function syncControls(){
    const access=accessState(),importButton=document.getElementById('faAnalyse');
    if(importButton&&importButton.textContent!=='Importing…'){
      if(access.status==='loading'){
        importButton.disabled=true;
        importButton.textContent='Connecting…';
      }else{
        importButton.textContent='Import files';
        importButton.disabled=!access.canWrite;
      }
    }

    document.querySelectorAll('[data-fa-save-row]').forEach(function(button){
      if(button.textContent!=='Saving…')button.disabled=!access.canWrite;
    });
    document.querySelectorAll('[data-fa-delete-row]').forEach(function(button){
      button.disabled=!access.canDelete;
    });
  }

  function install(){
    syncControls();
    window.addEventListener('maklom:access-state',syncControls);
    const content=document.getElementById('formAttendanceContent');
    if(content&&window.MutationObserver){
      new MutationObserver(syncControls).observe(content,{childList:true,subtree:true});
    }
  }

  document.addEventListener('DOMContentLoaded',install);
})();
