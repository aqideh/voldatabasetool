(function installCentralDatabaseProgrammeFilter(){
  function installProgrammeFilterControl(){
    const tagFilter=document.getElementById('tagFilter');
    if(!tagFilter||document.getElementById('programmeFilter'))return;
    const wrapper=document.createElement('div');
    wrapper.id='programmeFilterWrapper';
    wrapper.innerHTML='<label for="programmeFilter">Programme</label><select id="programmeFilter"><option value="">All programmes</option></select>';
    tagFilter.closest('div').insertAdjacentElement('afterend',wrapper);
    document.getElementById('programmeFilter').addEventListener('change',renderDatabase);
    populateProgrammeFilter();
  }

  function populateProgrammeFilter(){
    const select=document.getElementById('programmeFilter');
    if(!select)return;
    const current=select.value;
    const options=Array.isArray(PROGRAMME_OPTIONS)?PROGRAMME_OPTIONS.slice():[];
    select.innerHTML='<option value="">All programmes</option>'+options.map(function(programme){return '<option value="'+escapeHtml(programme)+'">'+escapeHtml(programme)+'</option>';}).join('');
    select.value=options.indexOf(current)>-1?current:'';
  }

  function volunteerHasProgramme(volunteer,programme){
    if(!programme)return true;
    const programmes=typeof programmesToArray==='function'?programmesToArray(volunteer&&volunteer.programmesRegistered):[];
    return programmes.indexOf(programme)>-1;
  }

  function bindClearProgrammeFilter(){
    const clearButton=document.getElementById('clearDatabaseFilters');
    if(!clearButton||clearButton.dataset.programmeFilterClearBound)return;
    clearButton.dataset.programmeFilterClearBound='true';
    clearButton.addEventListener('click',function(){
      const select=document.getElementById('programmeFilter');
      if(select)select.value='';
      renderDatabase();
    });
  }

  function installProgrammeFilter(){
    installProgrammeFilterControl();
    populateProgrammeFilter();
    bindClearProgrammeFilter();
  }

  const previousGetFilteredVolunteers=getFilteredVolunteers;
  getFilteredVolunteers=function(){
    installProgrammeFilter();
    const rows=previousGetFilteredVolunteers();
    const select=document.getElementById('programmeFilter');
    const programme=select?select.value:'';
    if(!programme)return rows;
    const filtered=rows.filter(function(volunteer){return volunteerHasProgramme(volunteer,programme);});
    if(typeof updateDatabaseMatchCount==='function')updateDatabaseMatchCount(filtered.length);
    return filtered;
  };

  const previousRenderDatabase=renderDatabase;
  renderDatabase=function(){
    installProgrammeFilter();
    previousRenderDatabase();
  };

  function startProgrammeFilter(){
    installProgrammeFilter();
    renderDatabase();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startProgrammeFilter);
  else startProgrammeFilter();
})();
