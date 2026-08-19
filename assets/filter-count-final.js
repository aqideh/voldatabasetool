(function installFinalDatabaseMatchCount(){
  const finalGetFilteredVolunteers=getFilteredVolunteers;
  getFilteredVolunteers=function(){
    const rows=finalGetFilteredVolunteers();
    if(typeof updateDatabaseMatchCount==='function')updateDatabaseMatchCount(rows.length);
    return rows;
  };
})();

(function loadEventCountSorting(){
  if(document.querySelector('script[data-event-count-sort]'))return;
  const script=document.createElement('script');
  script.src='assets/event-count-sort.js?v=20260819-1';
  script.dataset.eventCountSort='true';
  document.head.appendChild(script);
})();
