(function installWebAwesomeUi(){
  'use strict';

  const INPUT_IDS=['searchBox','eventLogSearch'];
  const SELECT_IDS=['tagFilter','genderFilter','shirtFilter','activityFilter','sortSelect','eventLogAttendanceFilter'];

  function badgeVariant(element){
    if(element.classList.contains('bad'))return'danger';
    if(element.classList.contains('warn'))return'warning';
    if(element.classList.contains('ok'))return'success';
    if(element.classList.contains('tag'))return'brand';
    return'neutral';
  }

  function enhanceBadge(element){
    if(!element||element.dataset.waEnhanced==='true'||element.tagName==='WA-BADGE'||element.id)return;
    element.dataset.waEnhanced='true';
    const badge=document.createElement('wa-badge');
    badge.className='maklom-wa-badge';
    badge.setAttribute('variant',badgeVariant(element));
    badge.setAttribute('appearance','filled');
    if(element.classList.contains('pill'))badge.setAttribute('pill','');
    badge.textContent=element.textContent.trim();
    element.replaceWith(badge);
  }

  function labelFor(source){
    return document.querySelector('label[for="'+source.id.replace(/"/g,'\\"')+'"]');
  }

  function prepareLabel(source,proxy){
    const label=labelFor(source);
    if(!label)return;
    const text=(label.textContent||'').trim();
    if(text)proxy.setAttribute('label',text);
    label.classList.add('wa-proxy-label-source');
  }

  function syncInput(source){
    const proxy=document.getElementById(source.dataset.waProxyId||'');
    if(!proxy)return;
    if(proxy.value!==source.value)proxy.value=source.value;
    proxy.toggleAttribute('disabled',!!source.disabled);
  }

  function enhanceInput(source){
    if(!source||source.dataset.waEnhanced==='true')return;
    const proxy=document.createElement('wa-input');
    const proxyId=source.id+'Wa';
    proxy.id=proxyId;
    proxy.className='maklom-wa-field';
    proxy.setAttribute('size','small');
    proxy.setAttribute('type',source.type||'text');
    if(source.placeholder)proxy.setAttribute('placeholder',source.placeholder);
    if(source.type==='text'||source.type==='search')proxy.setAttribute('with-clear','');
    prepareLabel(source,proxy);

    source.dataset.waEnhanced='true';
    source.dataset.waProxyId=proxyId;
    source.classList.add('wa-proxy-source');
    source.parentNode.insertBefore(proxy,source);
    syncInput(source);

    proxy.addEventListener('input',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('input',{bubbles:true}));
    });
    proxy.addEventListener('change',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('input',function(){syncInput(source);});
    source.addEventListener('change',function(){syncInput(source);});

    new MutationObserver(function(){syncInput(source);}).observe(source,{attributes:true,attributeFilter:['disabled','placeholder']});
  }

  function selectOptionsSignature(source){
    return JSON.stringify(Array.from(source.options||[]).map(function(option){
      return [option.value,option.textContent,!!option.disabled];
    }));
  }

  function rebuildSelect(source){
    const proxy=document.getElementById(source.dataset.waProxyId||'');
    if(!proxy)return;
    const signature=selectOptionsSignature(source);
    if(proxy.dataset.waOptionsSignature!==signature){
      proxy.replaceChildren();
      Array.from(source.options||[]).forEach(function(option){
        const item=document.createElement('wa-option');
        item.value=option.value;
        item.textContent=option.textContent;
        item.toggleAttribute('disabled',!!option.disabled);
        proxy.appendChild(item);
      });
      proxy.dataset.waOptionsSignature=signature;
    }
    if(proxy.value!==source.value)proxy.value=source.value;
    proxy.toggleAttribute('disabled',!!source.disabled);
  }

  function enhanceSelect(source){
    if(!source||source.dataset.waEnhanced==='true')return;
    const proxy=document.createElement('wa-select');
    const proxyId=source.id+'Wa';
    proxy.id=proxyId;
    proxy.className='maklom-wa-field';
    proxy.setAttribute('size','small');
    prepareLabel(source,proxy);

    source.dataset.waEnhanced='true';
    source.dataset.waProxyId=proxyId;
    source.classList.add('wa-proxy-source');
    source.parentNode.insertBefore(proxy,source);
    rebuildSelect(source);

    proxy.addEventListener('change',function(){
      source.value=proxy.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('change',function(){rebuildSelect(source);});
    new MutationObserver(function(){rebuildSelect(source);}).observe(source,{attributes:true,childList:true,subtree:true,characterData:true,attributeFilter:['disabled']});
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    INPUT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)enhanceInput(source);});
    SELECT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)enhanceSelect(source);});

    const badgeSelector='#eventsView .pill,#databaseMatchCount .pill,#eventLogSummary .pill';
    if(scope.matches&&scope.matches(badgeSelector))enhanceBadge(scope);
    scope.querySelectorAll(badgeSelector).forEach(enhanceBadge);
  }

  function start(){
    enhance(document);
    new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        mutation.addedNodes.forEach(function(node){if(node.nodeType===1)enhance(node);});
      });
    }).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
