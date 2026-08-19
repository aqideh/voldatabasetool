(function installCentralDatabaseEventFilter(){
  function normaliseEventKey(value){return cleanText(value).toLowerCase();}

  function eventRowsForVolunteer(volunteer){
    if(typeof eventLogRowsForVolunteer==='function')return eventLogRowsForVolunteer(volunteer);
    return Array.isArray(volunteer.attendance)?volunteer.attendance:[];
  }

  function eventRowWasAttended(row){
    if(row&&Object.prototype.hasOwnProperty.call(row,'attendance')){
      if(typeof attendanceWasCaptured==='function')return attendanceWasCaptured(row);
      return cleanText(row.attendance).toLowerCase()==='yes';
    }
    return true;
  }

  function collectEventOptions(){
    const seen={};
    const options=[];
    function addEventName(value){
      const label=cleanText(value);
      const key=normaliseEventKey(label);
      if(!key||seen[key])return;
      seen[key]=true;
      options.push({key:key,label:label});
    }
    (appData.attendanceLog||[]).forEach(function(row){addEventName(row.eventName);});
    (appData.volunteers||[]).forEach(function(volunteer){
      (volunteer.attendance||[]).forEach(function(row){addEventName(row.eventName);});
    });
    options.sort(function(a,b){return a.label.localeCompare(b.label);});
    return options;
  }

  function populateEventFilter(){
    const select=document.getElementById('eventSpecificFilter');
    if(!select)return;
    const current=select.value;
    const options=collectEventOptions();
    select.innerHTML='';
    const all=document.createElement('option');
    all.value='';
    all.textContent='All events';
    select.appendChild(all);
    options.forEach(function(item){
      const option=document.createElement('option');
      option.value=item.key;
      option.textContent=item.label;
      select.appendChild(option);
    });
    select.value=options.some(function(item){return item.key===current;})?current:'';
  }

  function syncParticipationState(){
    const eventSelect=document.getElementById('eventSpecificFilter');
    const participation=document.getElementById('eventParticipationFilter');
    if(participation)participation.disabled=!(eventSelect&&eventSelect.value);
  }

  function matchesSelectedEvent(volunteer,eventKey,participation){
    return eventRowsForVolunteer(volunteer).some(function(row){
      if(normaliseEventKey(row&&row.eventName)!==eventKey)return false;
      return participation!=='attended'||eventRowWasAttended(row);
    });
  }

  function installEventFilterControls(){
    const activity=document.getElementById('activityFilter');
    if(!activity)return;
    const activityWrapper=activity.closest('div');
    const grid=activity.closest('.grid');
    if(!activityWrapper||!grid)return;

    let eventWrapper=document.getElementById('eventSpecificFilterWrapper');
    if(!eventWrapper){
      eventWrapper=document.createElement('div');
      eventWrapper.id='eventSpecificFilterWrapper';
      eventWrapper.innerHTML='<label for="eventSpecificFilter">Event</label><select id="eventSpecificFilter"><option value="">All events</option></select>';
      activityWrapper.insertAdjacentElement('afterend',eventWrapper);
      document.getElementById('eventSpecificFilter').addEventListener('change',function(){syncParticipationState();renderDatabase();});
    }

    let participationWrapper=document.getElementById('eventParticipationFilterWrapper');
    if(!participationWrapper){
      participationWrapper=document.createElement('div');
      participationWrapper.id='eventParticipationFilterWrapper';
      participationWrapper.innerHTML='<label for="eventParticipationFilter">Event participation</label><select id="eventParticipationFilter"><option value="registered">Registered</option><option value="attended">Attended</option></select>';
      eventWrapper.insertAdjacentElement('afterend',participationWrapper);
      document.getElementById('eventParticipationFilter').addEventListener('change',renderDatabase);
    }

    const clearButton=document.getElementById('clearDatabaseFilters');
    if(clearButton&&!clearButton.dataset.eventFilterClearBound){
      clearButton.dataset.eventFilterClearBound='true';
      clearButton.addEventListener('click',function(){
        const eventSelect=document.getElementById('eventSpecificFilter');
        const participation=document.getElementById('eventParticipationFilter');
        if(eventSelect)eventSelect.value='';
        if(participation)participation.value='registered';
        syncParticipationState();
        renderDatabase();
      });
    }

    populateEventFilter();
    syncParticipationState();
  }

  const originalGetFilteredVolunteersForEventFilter=getFilteredVolunteers;
  getFilteredVolunteers=function(){
    installEventFilterControls();
    populateEventFilter();
    const rows=originalGetFilteredVolunteersForEventFilter();
    const eventSelect=document.getElementById('eventSpecificFilter');
    const participationSelect=document.getElementById('eventParticipationFilter');
    const eventKey=eventSelect?eventSelect.value:'';
    if(!eventKey)return rows;
    const participation=participationSelect?participationSelect.value:'registered';
    const filtered=rows.filter(function(volunteer){return matchesSelectedEvent(volunteer,eventKey,participation);});
    if(typeof updateDatabaseMatchCount==='function')updateDatabaseMatchCount(filtered.length);
    return filtered;
  };

  const originalRenderDatabaseForEventFilter=renderDatabase;
  renderDatabase=function(){
    installEventFilterControls();
    populateEventFilter();
    syncParticipationState();
    originalRenderDatabaseForEventFilter();
  };

  function startEventFilter(){
    installEventFilterControls();
    populateEventFilter();
    syncParticipationState();
    renderDatabase();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startEventFilter);
  else startEventFilter();
})();
