(function loadPortableWorkbookModules(){
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

document.addEventListener('DOMContentLoaded',function(){
  const tab=document.getElementById('infoTab');
  const panel=document.getElementById('infoPanel');
  const closeButton=document.getElementById('closeInfoPanel');
  if(!tab||!panel||!closeButton)return;

  function setOpen(open){
    panel.classList.toggle('hidden',!open);
    tab.setAttribute('aria-expanded',open?'true':'false');
  }

  tab.addEventListener('click',function(){
    setOpen(panel.classList.contains('hidden'));
  });

  closeButton.addEventListener('click',function(){
    setOpen(false);
    tab.focus();
  });

  document.addEventListener('keydown',function(event){
    if(event.key==='Escape')setOpen(false);
  });

  document.addEventListener('click',function(event){
    if(panel.classList.contains('hidden'))return;
    if(panel.contains(event.target)||tab.contains(event.target))return;
    setOpen(false);
  });
});
