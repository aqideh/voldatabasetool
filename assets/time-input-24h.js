(function install24HourTimeInputs(){
  'use strict';

  function clean(value){return String(value==null?'':value).trim();}

  function normalizeTime(value){
    const raw=clean(value).replace(/\s+/g,'');
    if(!raw)return'';
    let hours,minutes;
    let match=raw.match(/^(\d{1,2}):(\d{2})$/);
    if(match){hours=Number(match[1]);minutes=Number(match[2]);}
    else{
      match=raw.match(/^(\d{3,4})$/);
      if(!match)return null;
      const digits=match[1];
      hours=Number(digits.slice(0,-2));
      minutes=Number(digits.slice(-2));
    }
    if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||hours>23||minutes<0||minutes>59)return null;
    return String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');
  }

  function enhance(input){
    if(!input||input.dataset.time24h==='true')return;
    input.dataset.time24h='true';
    input.type='text';
    input.inputMode='numeric';
    input.maxLength=5;
    input.placeholder='HH:mm';
    input.autocomplete='off';
    input.setAttribute('pattern','(?:[01]\\d|2[0-3]):[0-5]\\d');
    input.setAttribute('aria-label',(input.getAttribute('aria-label')||'Time')+' in 24-hour HH:mm format');
    input.title='Use 24-hour time, e.g. 09:00, 14:30, 18:00';

    input.addEventListener('blur',function(){
      const normalized=normalizeTime(input.value);
      if(normalized!==null){input.value=normalized;input.removeAttribute('aria-invalid');}
      else if(clean(input.value)){input.setAttribute('aria-invalid','true');}
    });
  }

  function enhanceAll(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('input[type="time"], input[data-time24h]').forEach(enhance);
  }

  function validateShiftTimeInput(id,label){
    const input=document.getElementById(id);
    if(!input)return true;
    const normalized=normalizeTime(input.value);
    if(normalized===null){
      input.setAttribute('aria-invalid','true');
      input.focus();
      alert(label+' must use 24-hour HH:mm format, for example 09:00 or 14:30.');
      return false;
    }
    input.value=normalized;
    input.removeAttribute('aria-invalid');
    return true;
  }

  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('#addStructuredShift');
    if(!button)return;
    if(!validateShiftTimeInput('newShiftStart','Start time')||!validateShiftTimeInput('newShiftEnd','End time')){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);

  document.addEventListener('DOMContentLoaded',function(){
    enhanceAll(document);
    const main=document.querySelector('main');
    if(main)new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        mutation.addedNodes.forEach(function(node){
          if(node.nodeType!==1)return;
          if(node.matches&&node.matches('input[type="time"], input[data-time24h]'))enhance(node);
          enhanceAll(node);
        });
      });
    }).observe(main,{childList:true,subtree:true});
  });

  window.MaklomTime24h={normalize:normalizeTime,refresh:function(){enhanceAll(document);}};
})();
