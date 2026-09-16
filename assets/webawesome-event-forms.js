(function installWebAwesomeEventForms(){
  'use strict';

  function sourceLabel(source){
    const explicit=source.id&&document.querySelector('label[for="'+source.id.replace(/"/g,'\\"')+'"]');
    if(explicit)return explicit;
    return source.closest('label');
  }

  function labelText(source){
    const label=sourceLabel(source);
    if(!label)return'';
    return Array.from(label.childNodes).filter(function(node){return node!==source&&node.nodeType===Node.TEXT_NODE;}).map(function(node){return node.textContent;}).join(' ').trim();
  }

  function proxyId(source,suffix){
    if(!source.id)source.id='eventField_'+Math.random().toString(36).slice(2,10);
    return source.id+suffix;
  }

  function copyInputAttributes(source,proxy){
    ['placeholder','min','max','step','maxlength'].forEach(function(name){
      const value=source.getAttribute(name);
      if(value!==null)proxy.setAttribute(name,value);
    });
    proxy.toggleAttribute('disabled',!!source.disabled);
    proxy.toggleAttribute('required',!!source.required);
  }

  function syncValue(source){
    const proxy=document.getElementById(source.dataset.waEventProxy||'');
    if(!proxy)return;
    if(proxy.value!==source.value)proxy.value=source.value;
    proxy.toggleAttribute('disabled',!!source.disabled);
  }

  function enhanceInput(source){
    if(!source||source.dataset.waEventEnhanced==='true'||source.classList.contains('wa-proxy-source'))return;
    const type=(source.type||'text').toLowerCase();
    if(['checkbox','radio','file','date','time','datetime-local','hidden'].includes(type))return;

    const proxy=document.createElement('wa-input');
    proxy.id=proxyId(source,'EventWa');
    proxy.className='maklom-wa-event-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('type',type==='email'?'email':type==='number'?'number':'text');
    const label=labelText(source);
    if(label)proxy.setAttribute('label',label);
    if(type==='text'||type==='search'||type==='email')proxy.setAttribute('with-clear','');
    copyInputAttributes(source,proxy);

    source.dataset.waEventEnhanced='true';
    source.dataset.waEventProxy=proxy.id;
    source.classList.add('wa-event-source');
    source.parentNode.insertBefore(proxy,source);
    syncValue(source);

    proxy.addEventListener('input',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('input',{bubbles:true}));
    });
    proxy.addEventListener('change',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('input',function(){syncValue(source);});
    source.addEventListener('change',function(){syncValue(source);});
    new MutationObserver(function(){copyInputAttributes(source,proxy);syncValue(source);}).observe(source,{attributes:true});
  }

  function rebuildSelect(source){
    const proxy=document.getElementById(source.dataset.waEventProxy||'');
    if(!proxy)return;
    proxy.replaceChildren();
    Array.from(source.options||[]).forEach(function(option){
      const item=document.createElement('wa-option');
      item.value=option.value;
      item.textContent=option.textContent;
      item.toggleAttribute('disabled',!!option.disabled);
      proxy.appendChild(item);
    });
    proxy.value=source.value;
    proxy.toggleAttribute('disabled',!!source.disabled);
  }

  function enhanceSelect(source){
    if(!source||source.dataset.waEventEnhanced==='true'||source.classList.contains('wa-proxy-source'))return;
    const proxy=document.createElement('wa-select');
    proxy.id=proxyId(source,'EventWa');
    proxy.className='maklom-wa-event-field';
    proxy.setAttribute('size','small');
    const label=labelText(source);
    if(label)proxy.setAttribute('label',label);

    source.dataset.waEventEnhanced='true';
    source.dataset.waEventProxy=proxy.id;
    source.classList.add('wa-event-source');
    source.parentNode.insertBefore(proxy,source);
    rebuildSelect(source);

    proxy.addEventListener('change',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('change',function(){rebuildSelect(source);});
    new MutationObserver(function(){rebuildSelect(source);}).observe(source,{attributes:true,childList:true,subtree:true,characterData:true});
  }

  function enhanceTextarea(source){
    if(!source||source.dataset.waEventEnhanced==='true'||source.classList.contains('wa-proxy-source'))return;
    const proxy=document.createElement('wa-textarea');
    proxy.id=proxyId(source,'EventWa');
    proxy.className='maklom-wa-event-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('resize','vertical');
    const label=labelText(source);
    if(label)proxy.setAttribute('label',label);
    if(source.placeholder)proxy.setAttribute('placeholder',source.placeholder);

    source.dataset.waEventEnhanced='true';
    source.dataset.waEventProxy=proxy.id;
    source.classList.add('wa-event-source');
    source.parentNode.insertBefore(proxy,source);
    syncValue(source);

    proxy.addEventListener('input',function(){source.value=proxy.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('input',function(){syncValue(source);});
    source.addEventListener('change',function(){syncValue(source);});
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    if(scope.matches&&scope.matches('#eventsView input'))enhanceInput(scope);
    if(scope.matches&&scope.matches('#eventsView select'))enhanceSelect(scope);
    if(scope.matches&&scope.matches('#eventsView textarea'))enhanceTextarea(scope);
    scope.querySelectorAll('#eventsView input').forEach(enhanceInput);
    scope.querySelectorAll('#eventsView select').forEach(enhanceSelect);
    scope.querySelectorAll('#eventsView textarea').forEach(enhanceTextarea);
  }

  function start(){
    enhance(document);
    const view=document.getElementById('eventsView');
    if(!view)return;
    new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){mutation.addedNodes.forEach(function(node){if(node.nodeType===1)enhance(node);});});
    }).observe(view,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
