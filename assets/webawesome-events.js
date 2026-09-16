(function installWebAwesomeEvents(){
  'use strict';

  function buttonVariant(button){
    if(button.classList.contains('danger')) return 'danger';
    if(button.classList.contains('primary')) return 'brand';
    return 'neutral';
  }

  function buttonAppearance(button){
    if(button.classList.contains('primary') || button.classList.contains('danger')) return 'filled';
    return 'outlined';
  }

  function enhanceButton(button){
    if(!button || button.classList.contains('wa-proxy-source') || button.dataset.waEnhanced==='true') return;
    if(button.closest('wa-button')) return;

    button.dataset.waEnhanced='true';
    button.classList.add('wa-proxy-source');

    const proxy=document.createElement('wa-button');
    proxy.className='maklom-wa-button';
    proxy.setAttribute('variant',buttonVariant(button));
    proxy.setAttribute('appearance',buttonAppearance(button));
    if(button.classList.contains('small')) proxy.setAttribute('size','small');
    if(button.disabled) proxy.setAttribute('disabled','');
    proxy.textContent=button.textContent.trim();
    if(button.getAttribute('aria-label')) proxy.setAttribute('aria-label',button.getAttribute('aria-label'));
    if(button.title) proxy.title=button.title;

    proxy.addEventListener('click',function(event){
      event.preventDefault();
      if(button.disabled) return;
      button.click();
    });

    button.parentNode.insertBefore(proxy,button);
  }

  function badgeVariant(element){
    if(element.classList.contains('bad')) return 'danger';
    if(element.classList.contains('warn')) return 'warning';
    if(element.classList.contains('ok')) return 'success';
    if(element.classList.contains('tag')) return 'brand';
    return 'neutral';
  }

  function enhanceBadge(element){
    if(!element || element.dataset.waEnhanced==='true' || element.tagName==='WA-BADGE') return;
    element.dataset.waEnhanced='true';
    const badge=document.createElement('wa-badge');
    badge.className='maklom-wa-badge';
    badge.setAttribute('variant',badgeVariant(element));
    badge.setAttribute('appearance','filled');
    badge.textContent=element.textContent.trim();
    element.replaceWith(badge);
  }

  function enhance(root){
    const scope=root && root.querySelectorAll ? root : document;
    if(scope.matches && scope.matches('#eventsView button')) enhanceButton(scope);
    if(scope.matches && scope.matches('#eventsView .pill')) enhanceBadge(scope);
    scope.querySelectorAll('#eventsView button:not(.wa-proxy-source)').forEach(enhanceButton);
    scope.querySelectorAll('#eventsView .pill').forEach(enhanceBadge);
  }

  function start(){
    enhance(document);
    const eventsView=document.getElementById('eventsView');
    if(!eventsView) return;
    const observer=new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        mutation.addedNodes.forEach(function(node){
          if(node.nodeType===1) enhance(node);
        });
      });
    });
    observer.observe(eventsView,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
