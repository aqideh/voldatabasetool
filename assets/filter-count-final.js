(function installFinalDatabaseMatchCount(){
  const finalGetFilteredVolunteers=getFilteredVolunteers;
  getFilteredVolunteers=function(){
    const rows=finalGetFilteredVolunteers();
    if(typeof updateDatabaseMatchCount==='function')updateDatabaseMatchCount(rows.length);
    return rows;
  };
})();
