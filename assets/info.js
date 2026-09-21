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
