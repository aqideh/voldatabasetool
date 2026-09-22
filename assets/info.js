(function installMaklomInfo(){
  'use strict';

  function setOpen(open){
    const tab=document.getElementById('infoTab');
    const panel=document.getElementById('infoPanel');
    if(!tab||!panel)return;
    panel.classList.toggle('hidden',!open);
    tab.setAttribute('aria-expanded',open?'true':'false');
    if(open){
      const close=document.getElementById('closeInfoPanel');
      if(close&&typeof close.focus==='function')close.focus();
    }else if(typeof tab.focus==='function'){
      tab.focus();
    }
  }

  function start(){
    const tab=document.getElementById('infoTab');
    const panel=document.getElementById('infoPanel');
    const close=document.getElementById('closeInfoPanel');
    if(!tab||!panel)return;

    setOpen(false);

    tab.addEventListener('click',function(){
      setOpen(panel.classList.contains('hidden'));
    });

    if(close)close.addEventListener('click',function(){setOpen(false);});

    document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&!panel.classList.contains('hidden'))setOpen(false);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();

  if(document.querySelector('script[data-maklom-module="portable-workbook"]'))return;
  const portable=document.createElement('script');
  portable.src='assets/portable-workbook.js?v=20260828-1';
  portable.dataset.maklomModule='portable-workbook';
  portable.onload=function(){
    const compat=document.createElement('script');
    compat.src='assets/portable-workbook-compat.js?v=20260828-1';
    compat.dataset.maklomModule='portable-workbook-compat';
    document.head.appendChild(compat);
  };
  document.head.appendChild(portable);
})();