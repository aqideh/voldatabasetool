(function installWebAwesomeUi(){
  'use strict';

  const BUTTON_SELECTOR=[
    'nav button[data-view]',
    '#infoTab',
    '#closeInfoPanel',
    '#clearEventLogFilters',
    '.event-log-compact-add',
    '#eventsView button'
  ].join(',');
  const INPUT_IDS=['searchBox','eventLogSearch'];
  const SELECT_IDS=['tagFilter','genderFilter','shirtFilter','activityFilter','sortSelect','eventLogAttendanceFilter'];

  function directButtonLabel(button){
    if(button.querySelector('#dupCount')){
      return Array.from(button.childNodes).filter(function(node){return node.nodeType===Node.TEXT_NODE;}).map(function(node){return node.textContent;}).join(' ').trim()||'Suspected Duplicates';
    }
    return button.textContent.trim();
  }

  function buttonVariant(button){
    if(button.classList.contains('danger'))return'danger';
    if(button.classList.contains('primary')||button.classList.contains('active')||button.classList.contains('info-tab'))return'brand';
    return'neutral';
  }

  function buttonAppearance(button){
    if(button.classList.contains('primary')||button.classList.contains('danger')||button.classList.contains('active')||button.classList.contains('info-tab'))return'filled';
    if(button.matches('nav button[data-view]'))return'plain';
    return'outlined';
  }

  function syncButton(button){
    const proxyId=button.dataset.waProxyId;
    if(!proxyId)return;
    const proxy=document.getElementById(proxyId);
    if(!proxy)return;

    proxy.setAttribute('variant',buttonVariant(button));
    proxy.setAttribute('appearance',buttonAppearance(button));
    proxy.toggleAttribute('disabled',!!button.disabled);
    proxy.classList.toggle('is-active',button.classList.contains('active'));
    proxy.classList.toggle('maklom-wa-nav',button.matches('nav button[data-view]'));
    proxy.classList.toggle('maklom-wa-info',button.id==='infoTab');
    if(button.classList.contains('small'))proxy.setAttribute('size','small');else proxy.removeAttribute('size');
    if(button.getAttribute('aria-expanded')!==null)proxy.setAttribute('aria-expanded',button.getAttribute('aria-expanded'));
    if(button.getAttribute('aria-label'))proxy.setAttribute('aria-label',button.getAttribute('aria-label'));
    if(button.title)proxy.title=button.title;

    const label=directButtonLabel(button);
    if(button.querySelector('#dupCount')){
      proxy.replaceChildren(document.createTextNode(label));
      const badge=document.createElement('wa-badge');
      badge.className='maklom-wa-nav-count';
      badge.setAttribute('pill','');
      badge.setAttribute('variant','neutral');
      badge.textContent=(button.querySelector('#dupCount').textContent||'0').trim();
      proxy.appendChild(badge);
    }else if(proxy.textContent!==label){
      proxy.textContent=label;
    }
  }

  function enhanceButton(button){
    if(!button||button.dataset.waEnhanced==='true'||button.classList.contains('wa-proxy-source'))return;
    if(button.closest('wa-button'))return;
    if(button.id==='addEventLogRow')return;

    const proxy=document.createElement('wa-button');
    const proxyId='waButton_'+Math.random().toString(36).slice(2,10);
    proxy.id=proxyId;
    proxy.className='maklom-wa-button';
    button.dataset.waEnhanced='true';
    button.dataset.waProxyId=proxyId;
    button.classList.add('wa-proxy-source');
    button.parentNode.insertBefore(proxy,button);
    syncButton(button);

    proxy.addEventListener('click',function(event){
      event.preventDefault();
      if(button.disabled)return;
      button.click();
      setTimeout(syncAllFields,0);
      requestAnimationFrame(syncAllFields);
    });

    const observer=new MutationObserver(function(){syncButton(button);});
    observer.observe(button,{attributes:true,childList:true,subtree:true,characterData:true});
  }

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

    const observer=new MutationObserver(function(){syncInput(source);});
    observer.observe(source,{attributes:true,attributeFilter:['disabled','placeholder']});
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

    const observer=new MutationObserver(function(){rebuildSelect(source);});
    observer.observe(source,{attributes:true,childList:true,subtree:true,characterData:true,attributeFilter:['disabled']});
  }

  function syncAllFields(){
    INPUT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)syncInput(source);});
    SELECT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)rebuildSelect(source);});
  }

  function enhance(root){
    const scope=root&&root.querySelectorAll?root:document;
    if(scope.matches&&scope.matches(BUTTON_SELECTOR))enhanceButton(scope);
    scope.querySelectorAll(BUTTON_SELECTOR).forEach(enhanceButton);

    INPUT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)enhanceInput(source);});
    SELECT_IDS.forEach(function(id){const source=document.getElementById(id);if(source)enhanceSelect(source);});

    const badgeSelector='#eventsView .pill,#databaseMatchCount .pill,#eventLogSummary .pill';
    if(scope.matches&&scope.matches(badgeSelector))enhanceBadge(scope);
    scope.querySelectorAll(badgeSelector).forEach(enhanceBadge);
  }

  function start(){
    enhance(document);
    const observer=new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        mutation.addedNodes.forEach(function(node){if(node.nodeType===1)enhance(node);});
      });
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
