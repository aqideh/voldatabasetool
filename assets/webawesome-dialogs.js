(function installMaklomDialogs(){
  'use strict';

  const nativeConfirm=window.confirm.bind(window);
  let dialog=null;
  let resolver=null;
  let promptInput=null;
  let currentActionTarget=null;
  let allowNextConfirm=false;

  function ensureDialog(){
    if(dialog)return dialog;
    dialog=document.createElement('wa-dialog');
    dialog.id='maklomDialog';
    dialog.className='maklom-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('wa-after-hide',function(){
      if(resolver){const done=resolver;resolver=null;done({confirmed:false,value:null});}
    });
    return dialog;
  }

  function close(result){
    const active=resolver;resolver=null;
    if(dialog)dialog.removeAttribute('open');
    if(active)active(result);
  }

  function button(label,variant,action){
    const b=document.createElement('wa-button');
    b.textContent=label;
    b.setAttribute('slot','footer');
    b.setAttribute('variant',variant||'neutral');
    b.setAttribute('appearance',variant==='brand'||variant==='danger'?'filled':'outlined');
    b.addEventListener('click',action);
    return b;
  }

  function open(options){
    const d=ensureDialog();
    if(resolver)close({confirmed:false,value:null});
    d.replaceChildren();
    d.setAttribute('label',options.title||'MakLom');
    const message=document.createElement('div');
    message.className='maklom-dialog-message';
    message.textContent=String(options.message||'');
    d.appendChild(message);
    promptInput=null;
    if(options.prompt){
      promptInput=document.createElement('wa-input');
      promptInput.className='maklom-dialog-input';
      promptInput.value=options.value==null?'':String(options.value);
      if(options.placeholder)promptInput.setAttribute('placeholder',options.placeholder);
      d.appendChild(promptInput);
    }
    const promise=new Promise(function(resolve){resolver=resolve;});
    if(options.showCancel!==false)d.appendChild(button(options.cancelLabel||'Cancel','neutral',function(){close({confirmed:false,value:null});}));
    d.appendChild(button(options.confirmLabel||'Confirm',options.danger?'danger':'brand',function(){close({confirmed:true,value:promptInput?promptInput.value:null});}));
    d.setAttribute('open','');
    if(promptInput)setTimeout(function(){promptInput.focus();},0);
    return promise;
  }

  function isDangerousMessage(message){return /\b(delete|clear|replace|remove|overwrite|discard)\b/i.test(String(message||''));}

  window.MaklomDialogs={
    confirm:function(message,options){options=options||{};return open({title:options.title||'Confirm action',message:message,confirmLabel:options.confirmLabel||'Confirm',cancelLabel:options.cancelLabel||'Cancel',danger:!!options.danger,showCancel:true}).then(function(result){return result.confirmed;});},
    alert:function(message,options){options=options||{};return open({title:options.title||'Notice',message:message,confirmLabel:options.confirmLabel||'OK',danger:false,showCancel:false}).then(function(){return true;});},
    prompt:function(message,value,options){options=options||{};return open({title:options.title||'Edit value',message:message,prompt:true,value:value,placeholder:options.placeholder||'',confirmLabel:options.confirmLabel||'Save',cancelLabel:options.cancelLabel||'Cancel',danger:false,showCancel:true}).then(function(result){return result.confirmed?result.value:null;});}
  };

  document.addEventListener('click',function(event){
    const target=event.target&&event.target.closest?event.target.closest('button,wa-button,[role="button"]'):null;
    if(target)currentActionTarget=target;
    setTimeout(function(){if(currentActionTarget===target)currentActionTarget=null;},0);
  },true);

  window.confirm=function(message){
    if(allowNextConfirm){allowNextConfirm=false;return true;}
    const target=currentActionTarget;
    if(!target)return nativeConfirm(message);
    window.MaklomDialogs.confirm(message,{danger:isDangerousMessage(message)}).then(function(confirmed){
      if(!confirmed||!target.isConnected)return;
      allowNextConfirm=true;
      target.click();
    });
    return false;
  };

  window.alert=function(message){window.MaklomDialogs.alert(message,{title:'MakLom'});};

  if(typeof window.importJsonSave==='function'){
    window.importJsonSave=function(event){
      const file=event.target.files[0];if(!file)return;
      if(file.size>MAX_JSON_BYTES){window.alert('JSON restore file rejected. Maximum file size is 10 MB.');event.target.value='';return;}
      const reader=new FileReader();
      reader.onload=function(load){
        try{
          const parsed=JSON.parse(load.target.result);const cleaned=validateJsonSave(parsed);
          window.MaklomDialogs.confirm('Replace the current local database with this validated JSON save file?',{danger:true,confirmLabel:'Replace database'}).then(function(confirmed){
            if(!confirmed)return;appData=cleaned;saveData();renderAll();
          });
        }catch(error){window.alert('This JSON file is not a valid save file.');}
      };
      reader.readAsText(file);event.target.value='';
    };
  }
})();
