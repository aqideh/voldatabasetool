(function installEventCountSorting(){
  function eventRegistrationCount(volunteer){
    if(typeof eventLogRowsForVolunteer==='function')return eventLogRowsForVolunteer(volunteer).length;
    return Array.isArray(volunteer.attendance)?volunteer.attendance.length:0;
  }

  function eventAttendanceCount(volunteer){
    if(typeof eventLogRowsForVolunteer==='function'){
      return eventLogRowsForVolunteer(volunteer).filter(function(row){
        return typeof attendanceWasCaptured==='function'?attendanceWasCaptured(row):cleanText(row.attendance).toLowerCase()==='yes';
      }).length;
    }
    return Array.isArray(volunteer.attendance)?volunteer.attendance.length:0;
  }

  function installSortOptions(){
    const select=document.getElementById('sortSelect');
    if(!select)return;
    if(!select.querySelector('option[value="eventsAttended"]')){
      const attended=document.createElement('option');
      attended.value='eventsAttended';
      attended.textContent='Events attended high-low';
      select.appendChild(attended);
    }
    if(!select.querySelector('option[value="eventsRegistered"]')){
      const registered=document.createElement('option');
      registered.value='eventsRegistered';
      registered.textContent='Events registered high-low';
      select.appendChild(registered);
    }
  }

  const originalSortVolunteers=sortVolunteers;
  sortVolunteers=function(rows,sort){
    if(sort==='eventsAttended'){
      rows.sort(function(a,b){
        return eventAttendanceCount(b)-eventAttendanceCount(a)||eventRegistrationCount(b)-eventRegistrationCount(a)||a.name.localeCompare(b.name);
      });
      return;
    }
    if(sort==='eventsRegistered'){
      rows.sort(function(a,b){
        return eventRegistrationCount(b)-eventRegistrationCount(a)||eventAttendanceCount(b)-eventAttendanceCount(a)||a.name.localeCompare(b.name);
      });
      return;
    }
    originalSortVolunteers(rows,sort);
  };

  window.getEventRegistrationCount=eventRegistrationCount;
  window.getEventAttendanceCount=eventAttendanceCount;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSortOptions);
  else installSortOptions();
})();
