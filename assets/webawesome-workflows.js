(function installWebAwesomeWorkflows(){
  'use strict';

  const SCOPES=['#formAttendanceView','#databaseTable'];
  const FIELD_TYPES=['text','email','number','search','tel','url','password'];

  function inScope(node){
    return !!(node&&node.closest&&SCOPES.some(function(selector){return node.closest(selector);}));
  }

  function proxyId(source,prefix){
    if(source.id)return source.id+'Wa';
    return prefix+'_'+Math.random().toString(36).slice(2,10);
  }

  function explicitLabel(source){
    if(!source.id)return null;
    try{return document.querySelector('label[for="'+CSS.escape(source.id)+'"]');}catch(error){return null;}
  }

  function prepareLabel(source,proxy){
    const wrapping=source.closest('label');
    if(wrapping&&wrapping.contains(source))return;
    const label=explicitLabel(source);
    if(!label)return;
    const text=(label.textContent||'').trim();
    if(text)proxy.setAttribute('label',text);
    label.classList.add('wa-workflow-label-source');
  }

  function syncCommon(source,proxy){
    proxy.toggleAttribute('disabled',!!source.disabled);
    if(source.getAttribute('aria-label'))proxy.setAttribute('aria-label',source.getAttribute('aria-label'));
    if(source.title)proxy.title=source.title;
    if(source.placeholder!==undefined&&source.placeholder)proxy.setAttribute('placeholder',source.placeholder);
  }

  function buttonVariant(button){
    if(button.classList.contains('danger'))return'danger';
    if(button.classList.contains('primary')||button.classList.contains('active'))return'brand';
    return'neutral';
  }

  function buttonAppearance(button){
    if(button.classList.contains('primary')||button.classList.contains('danger')||button.classList.contains('active'))return'filled';
    return'outlined';
  }

  function syncButton(button){
    const proxy=document.getElementById(button.dataset.waWorkflowProxy||'');
    if(!proxy)return;
    syncCommon(button,proxy);
    proxy.setAttribute('variant',buttonVariant(button));
    proxy.setAttribute('appearance',buttonAppearance(button));
    if(button.classList.contains('small'))proxy.setAttribute('size','small');else proxy.removeAttribute('size');
    proxy.classList.toggle('is-active',button.classList.contains('active'));
    const label=(button.textContent||'').trim();
    if(proxy.textContent!==label)proxy.textContent=label;
  }

  function enhanceButton(button){
    if(!button||!inScope(button)||button.dataset.waWorkflowEnhanced==='true'||button.dataset.waEnhanced==='true'||button.dataset.waStaticEnhanced==='true'||button.classList.contains('wa-proxy-source')||button.classList.contains('wa-static-source')||button.classList.contains('wa-workflow-source'))return;
    if(button.closest('wa-button'))return;

    const proxy=document.createElement('wa-button');
    proxy.id=proxyId(button,'waWorkflowButton');
    proxy.className='maklom-wa-workflow-button';
    button.dataset.waWorkflowEnhanced='true';
    button.dataset.waWorkflowProxy=proxy.id;
    button.classList.add('wa-workflow-source');
    button.parentNode.insertBefore(proxy,button);
    syncButton(button);

    proxy.addEventListener('click',function(event){
      event.preventDefault();
      if(button.disabled)return;
      button.click();
    });

    new MutationObserver(function(){syncButton(button);}).observe(button,{attributes:true,childList:true,subtree:true,characterData:true});
  }

  function copyNumericAttrs(source,proxy){
    ['min','max','step','maxlength'].forEach(function(name){
      const value=source.getAttribute(name);
      if(value!==null)proxy.setAttribute(name,value);
    });
  }

  function syncInput(source){
    const proxy=document.getElementById(source.dataset.waWorkflowProxy||'');
    if(!proxy)return;
    syncCommon(source,proxy);
    copyNumericAttrs(source,proxy);
    if(proxy.value!==source.value)proxy.value=source.value;
  }

  function enhanceInput(source){
    if(!source||!inScope(source)||source.dataset.waWorkflowEnhanced==='true'||source.dataset.waEnhanced==='true'||source.dataset.waStaticEnhanced==='true'||source.classList.contains('wa-proxy-source')||source.classList.contains('wa-static-source')||source.classList.contains('wa-workflow-source'))return;
    const type=(source.type||'text').toLowerCase();
    if(FIELD_TYPES.indexOf(type)===-1)return;

    const proxy=document.createElement('wa-input');
    proxy.id=proxyId(source,'waWorkflowInput');
    proxy.className='maklom-wa-workflow-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('type',type);
    if(type==='text'||type==='search'||type==='email'||type==='tel')proxy.setAttribute('with-clear','');
    prepareLabel(source,proxy);

    source.dataset.waWorkflowEnhanced='true';
    source.dataset.waWorkflowProxy=proxy.id;
    source.classList.add('wa-workflow-source');
    source.parentNode.insertBefore(proxy,source);
    syncInput(source);

    proxy.addEventListener('input',function(){source.value=proxy.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('input',function(){syncInput(source);});
    source.addEventListener('change',function(){syncInput(source);});
    new MutationObserver(function(){syncInput(source);}).observe(source,{attributes:true,attributeFilter:['disabled','placeholder','min','max','step','maxlength']});
  }

  function rebuildSelect(source){
    const proxy=document.getElementById(source.dataset.waWorkflowProxy||'');
    if(!proxy)return;
    syncCommon(source,proxy);
    const value=source.value;
    proxy.replaceChildren();
    Array.from(source.options||[]).forEach(function(option){
      const item=document.createElement('wa-option');
      item.value=option.value;
      item.textContent=option.textContent;
      item.toggleAttribute('disabled',!!option.disabled);
      proxy.appendChild(item);
    });
    proxy.value=value;
  }

  function enhanceSelect(source){
    if(!source||!inScope(source)||source.dataset.waWorkflowEnhanced==='true'||source.dataset.waEnhanced==='true'||source.dataset.waStaticEnhanced==='true'||source.classList.contains('wa-proxy-source')||source.classList.contains('wa-static-source')||source.classList.contains('wa-workflow-source'))return;
    const proxy=document.createElement('wa-select');
    proxy.id=proxyId(source,'waWorkflowSelect');
    proxy.className='maklom-wa-workflow-field';
    proxy.setAttribute('size','small');
    prepareLabel(source,proxy);

    source.dataset.waWorkflowEnhanced='true';
    source.dataset.waWorkflowProxy=proxy.id;
    source.classList.add('wa-workflow-source');
    source.parentNode.insertBefore(proxy,source);
    rebuildSelect(source);

    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('change',function(){rebuildSelect(source);});
    new MutationObserver(function(){rebuildSelect(source);}).observe(source,{attributes:true,childList:true,subtree:true,characterData:true});
  }

  function syncTextarea(source){
    const proxy=document.getElementById(source.dataset.waWorkflowProxy||'');
    if(!proxy)return;
    syncCommon(source,proxy);
    const maxlength=source.getAttribute('maxlength');
    if(maxlength!==null)proxy.setAttribute('maxlength',maxlength);
    if(proxy.value!==source.value)proxy.value=source.value;
  }

  function enhanceTextarea(source){
    if(!source||!inScope(source)||source.dataset.waWorkflowEnhanced==='true'||source.dataset.waEnhanced==='true'||source.dataset.waStaticEnhanced==='true'||source.classList.contains('wa-proxy-source')||source.classList.contains('wa-static-source')||source.classList.contains('wa-workflow-source'))return;
    const proxy=document.createElement('wa-textarea');
    proxy.id=proxyId(source,'waWorkflowTextarea');
    proxy.className='maklom-wa-workflow-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('resize','vertical');
    prepareLabel(source,proxy);

    source.dataset.waWorkflowEnhanced='true';
    source.dataset.waWorkflowProxy=proxy.id;
    source.classList.add('wa-workflow-source');
    source.parentNode.insertBefore(proxy,source);
    syncTextarea(source);

    proxy.addEventListener('input',function(){source.value=proxy.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('input',function(){syncTextarea(source);});
    source.addEventListener('change',function(){syncTextarea(source);});
    new MutationObserver(function(){syncTextarea(source);}).observe(source,{attributes:true,attributeFilter:['disabled','placeholder','maxlength']});
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    if(scope.matches){
      if(scope.matches('button'))enhanceButton(scope);
      if(scope.matches('input'))enhanceInput(scope);
      if(scope.matches('select'))enhanceSelect(scope);
      if(scope.matches('textarea'))enhanceTextarea(scope);
    }
    scope.querySelectorAll('button').forEach(enhanceButton);
    scope.querySelectorAll('input').forEach(enhanceInput);
    scope.querySelectorAll('select').forEach(enhanceSelect);
    scope.querySelectorAll('textarea').forEach(enhanceTextarea);
  }

  function start(){
    enhance(document);
    new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){mutation.addedNodes.forEach(function(node){if(node.nodeType===1)enhance(node);});});
    }).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
