(function installWebAwesomeStaticWorkflows(){
  'use strict';

  const ROOT_SELECTOR='#uploadView,#mergeView,#exportView,#duplicatesView';
  const FIELD_SELECTOR='input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),select,textarea';

  function rootFor(element){return element&&element.closest?element.closest(ROOT_SELECTOR):null;}

  function labelText(source){
    if(!source.id)return'';
    const label=document.querySelector('label[for="'+source.id.replace(/"/g,'\\"')+'"]');
    return label?(label.textContent||'').trim():'';
  }

  function buttonVariant(button){
    if(button.classList.contains('danger'))return'danger';
    if(button.classList.contains('primary'))return'brand';
    return'neutral';
  }

  function enhanceButton(button){
    if(!button||!rootFor(button)||button.dataset.waStaticEnhanced==='true'||button.classList.contains('wa-static-source'))return;
    if(button.closest('wa-button'))return;
    button.dataset.waStaticEnhanced='true';
    button.classList.add('wa-static-source');

    const proxy=document.createElement('wa-button');
    proxy.className='maklom-wa-static-button';
    proxy.setAttribute('variant',buttonVariant(button));
    proxy.setAttribute('appearance',button.classList.contains('primary')||button.classList.contains('danger')?'filled':'outlined');
    if(button.classList.contains('small'))proxy.setAttribute('size','small');
    proxy.textContent=(button.textContent||'').trim();
    if(button.getAttribute('aria-label'))proxy.setAttribute('aria-label',button.getAttribute('aria-label'));
    proxy.toggleAttribute('disabled',!!button.disabled);
    button.parentNode.insertBefore(proxy,button);

    proxy.addEventListener('click',function(event){
      event.preventDefault();
      if(!button.disabled)button.click();
    });

    new MutationObserver(function(){
      proxy.textContent=(button.textContent||'').trim();
      proxy.toggleAttribute('disabled',!!button.disabled);
      proxy.setAttribute('variant',buttonVariant(button));
      proxy.setAttribute('appearance',button.classList.contains('primary')||button.classList.contains('danger')?'filled':'outlined');
    }).observe(button,{attributes:true,childList:true,subtree:true,characterData:true});
  }

  function fieldProxyId(source){
    if(!source.dataset.waStaticProxyId)source.dataset.waStaticProxyId='waStatic_'+(source.id||Math.random().toString(36).slice(2,10));
    return source.dataset.waStaticProxyId;
  }

  function copyCommon(source,proxy){
    const label=labelText(source);
    if(label)proxy.setAttribute('label',label);
    if(source.placeholder)proxy.setAttribute('placeholder',source.placeholder);
    proxy.toggleAttribute('disabled',!!source.disabled);
    if(source.required)proxy.setAttribute('required','');
  }

  function enhanceInput(source){
    if(!source||!rootFor(source)||source.dataset.waStaticEnhanced==='true')return;
    source.dataset.waStaticEnhanced='true';
    source.classList.add('wa-static-source');
    const proxy=document.createElement('wa-input');
    proxy.id=fieldProxyId(source);
    proxy.className='maklom-wa-static-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('type',source.type||'text');
    if(source.min)proxy.setAttribute('min',source.min);
    if(source.max)proxy.setAttribute('max',source.max);
    if(source.step)proxy.setAttribute('step',source.step);
    if((source.type||'text')==='text'||source.type==='search')proxy.setAttribute('with-clear','');
    copyCommon(source,proxy);
    proxy.value=source.value;
    source.parentNode.insertBefore(proxy,source);
    proxy.addEventListener('input',function(){source.value=proxy.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('input',function(){if(proxy.value!==source.value)proxy.value=source.value;});
    source.addEventListener('change',function(){if(proxy.value!==source.value)proxy.value=source.value;});
  }

  function rebuildSelect(source,proxy){
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
    if(!source||!rootFor(source)||source.dataset.waStaticEnhanced==='true')return;
    source.dataset.waStaticEnhanced='true';
    source.classList.add('wa-static-source');
    const proxy=document.createElement('wa-select');
    proxy.id=fieldProxyId(source);
    proxy.className='maklom-wa-static-field';
    proxy.setAttribute('size','small');
    copyCommon(source,proxy);
    source.parentNode.insertBefore(proxy,source);
    rebuildSelect(source,proxy);
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('change',function(){rebuildSelect(source,proxy);});
    new MutationObserver(function(){rebuildSelect(source,proxy);}).observe(source,{attributes:true,childList:true,subtree:true,characterData:true});
  }

  function enhanceTextarea(source){
    if(!source||!rootFor(source)||source.dataset.waStaticEnhanced==='true')return;
    source.dataset.waStaticEnhanced='true';
    source.classList.add('wa-static-source');
    const proxy=document.createElement('wa-textarea');
    proxy.id=fieldProxyId(source);
    proxy.className='maklom-wa-static-field';
    proxy.setAttribute('resize','vertical');
    copyCommon(source,proxy);
    proxy.value=source.value;
    source.parentNode.insertBefore(proxy,source);
    proxy.addEventListener('input',function(){source.value=proxy.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
    proxy.addEventListener('change',function(){source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}));});
    source.addEventListener('input',function(){if(proxy.value!==source.value)proxy.value=source.value;});
  }

  function enhanceField(source){
    if(source.tagName==='SELECT')enhanceSelect(source);
    else if(source.tagName==='TEXTAREA')enhanceTextarea(source);
    else enhanceInput(source);
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    if(scope.matches&&scope.matches(ROOT_SELECTOR+' button'))enhanceButton(scope);
    scope.querySelectorAll(ROOT_SELECTOR+' button').forEach(enhanceButton);
    if(scope.matches&&scope.matches(ROOT_SELECTOR+' '+FIELD_SELECTOR))enhanceField(scope);
    scope.querySelectorAll(ROOT_SELECTOR+' '+FIELD_SELECTOR).forEach(enhanceField);
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
