(function installCellTooltips(){
  'use strict';

  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}

  function controlValue(control){
    if(!control)return'';
    if(control.tagName==='SELECT'){
      const option=control.options&&control.selectedIndex>=0?control.options[control.selectedIndex]:null;
      return clean(option?option.textContent:control.value);
    }
    return clean(control.value);
  }

  function cellText(cell){
    if(!cell)return'';
    const controls=Array.from(cell.querySelectorAll('input,textarea,select'));
    if(controls.length){
      const values=controls.map(controlValue).filter(Boolean);
      if(values.length)return values.join(' · ');
    }
    return clean(cell.innerText||cell.textContent||'');
  }

  function applyTooltip(cell){
    if(!cell||cell.tagName!=='TD')return;
    const text=cellText(cell);
    if(text)cell.setAttribute('title',text);
    else cell.removeAttribute('title');

    cell.querySelectorAll('input,textarea,select').forEach(function(control){
      const value=controlValue(control);
      if(value)control.setAttribute('title',value);
      else control.removeAttribute('title');
    });
  }

  function refresh(root){
    const scope=root&&root.querySelectorAll?root:document;
    if(scope.matches&&scope.matches('td'))applyTooltip(scope);
    scope.querySelectorAll('td').forEach(applyTooltip);
  }

  document.addEventListener('mouseover',function(event){
    const cell=event.target.closest&&event.target.closest('td');
    if(cell)applyTooltip(cell);
  },true);

  document.addEventListener('input',function(event){
    const control=event.target.closest&&event.target.closest('input,textarea,select');
    if(!control)return;
    const cell=control.closest('td');
    if(cell)applyTooltip(cell);
  },true);

  document.addEventListener('change',function(event){
    const control=event.target.closest&&event.target.closest('input,textarea,select');
    if(!control)return;
    const cell=control.closest('td');
    if(cell)applyTooltip(cell);
  },true);

  document.addEventListener('DOMContentLoaded',function(){
    refresh(document);
    const main=document.querySelector('main');
    if(main&&window.MutationObserver){
      new MutationObserver(function(mutations){
        mutations.forEach(function(mutation){
          mutation.addedNodes.forEach(function(node){
            if(node&&node.nodeType===1)refresh(node);
          });
        });
      }).observe(main,{childList:true,subtree:true});
    }
  });

  window.MaklomCellTooltips={refresh:refresh};
})();
