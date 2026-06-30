const NO_VALUE_FILTER_FIELDS=[
  {key:'',label:'No value filter'},
  {key:'name',label:'Name'},
  {key:'phone',label:'Phone'},
  {key:'email',label:'Email'},
  {key:'gender',label:'Gender'},
  {key:'address',label:'Address'},
  {key:'recruitedYear',label:'Recruited Year'},
  {key:'chatSession',label:'Chat Session'},
  {key:'chatSessionDate',label:'Chat Session Date Conducted'},
  {key:'interests',label:'Interests'},
  {key:'languagesSpoken',label:'Languages Spoken'},
  {key:'programmesRegistered',label:'Programmes Registered'},
  {key:'tags',label:'Tags'},
  {key:'shirtSize',label:'T-Shirt Size'},
  {key:'dietary',label:'Dietary Requirements'},
  {key:'totalHours',label:'Total Hours'},
  {key:'lastActive',label:'Last Active'}
];

function installNoValueFilter(){
  const searchBox=document.getElementById('searchBox');
  if(!searchBox||document.getElementById('noValueFilter'))return;
  const container=searchBox.closest('.grid');
  const wrapper=document.createElement('div');
  wrapper.innerHTML='<label for="noValueFilter">No value filter</label><select id="noValueFilter">'+NO_VALUE_FILTER_FIELDS.map(function(field){return '<option value="'+field.key+'">'+field.label+'</option>';}).join('')+'</select>';
  container.appendChild(wrapper);
  document.getElementById('noValueFilter').addEventListener('change',renderDatabase);
}

function installClearFiltersButton(){
  const searchBox=document.getElementById('searchBox');
  if(!searchBox||document.getElementById('clearDatabaseFilters'))return;
  const container=searchBox.closest('.grid');
  const wrapper=document.createElement('div');
  wrapper.innerHTML='<label>&nbsp;</label><button id="clearDatabaseFilters" type="button">Clear filters</button>';
  container.appendChild(wrapper);
  document.getElementById('clearDatabaseFilters').addEventListener('click',clearDatabaseFilters);
}

function clearDatabaseFilters(){
  const ids=['searchBox','tagFilter','genderFilter','shirtFilter','activityFilter','noValueFilter'];
  ids.forEach(function(id){const el=document.getElementById(id);if(el)el.value='';});
  const sort=document.getElementById('sortSelect');
  if(sort)sort.value='name';
  renderDatabase();
}

function installDatabaseFilterControls(){installNoValueFilter();installClearFiltersButton();}

const originalWireDatabaseControls=wireDatabaseControls;
wireDatabaseControls=function(){
  originalWireDatabaseControls();
  installDatabaseFilterControls();
};

const originalRenderDatabase=renderDatabase;
renderDatabase=function(){
  installDatabaseFilterControls();
  originalRenderDatabase();
};

function noValueFilterValue(volunteer,key){
  if(key==='tags')return Array.isArray(volunteer.tags)&&volunteer.tags.length?tagsToText(volunteer.tags):'';
  if(key==='totalHours')return getTotalHours(volunteer)>0?String(getTotalHours(volunteer)):'';
  if(key==='lastActive')return getLastActive(volunteer);
  return cleanText(volunteer[key]);
}

function noValueFilterMatches(volunteer,key){
  if(!key)return true;
  return noValueFilterValue(volunteer,key)==='';
}

function volunteerHasCapturedAttendance(volunteer){return typeof eventLogRowsForVolunteer==='function'?eventLogRowsForVolunteer(volunteer).some(attendanceWasCaptured):!!(volunteer.attendance&&volunteer.attendance.length>0);}

function getFilteredVolunteers(){
  const q=document.getElementById('searchBox').value.toLowerCase().trim();
  const tag=document.getElementById('tagFilter').value;
  const gender=document.getElementById('genderFilter').value;
  const shirt=document.getElementById('shirtFilter').value;
  const activity=document.getElementById('activityFilter').value;
  const sort=document.getElementById('sortSelect').value;
  const noValue=document.getElementById('noValueFilter')?document.getElementById('noValueFilter').value:'';
  const filtered=appData.volunteers.filter(function(v){
    const tags=Array.isArray(v.tags)?v.tags:[];
    const text=[v.name,v.phone,v.email,v.gender,v.address,v.recruitedYear,v.chatSession,v.chatSessionDate,v.interests,v.languagesSpoken,v.programmesRegistered,v.notes,v.dietary,tags.join(' ')].join(' ').toLowerCase();
    const has=volunteerHasCapturedAttendance(v);
    return(!q||text.indexOf(q)>-1)&&(!tag||tags.indexOf(tag)>-1)&&(!gender||v.gender===gender)&&(!shirt||v.shirtSize===shirt)&&(!activity||(activity==='active'&&has)||(activity==='inactive'&&!has))&&noValueFilterMatches(v,noValue);
  });
  sortVolunteers(filtered,sort);
  return filtered;
}

document.addEventListener('DOMContentLoaded',installDatabaseFilterControls);
