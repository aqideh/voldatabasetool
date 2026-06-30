function yearFromDate(value){const text=cleanText(value);const match=text.match(/^(\d{4})-/);return match?match[1]:'';}
function yearFromValue(value){const text=cleanText(value);const match=text.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);return match?match[1]:'';}

function countByYearFromVolunteers(yearGetter){
  const counts={};
  appData.volunteers.forEach(function(volunteer){
    const year=yearGetter(volunteer);
    if(year)counts[year]=(counts[year]||0)+1;
  });
  return counts;
}

function deployedByYear(){
  const yearToVolunteerIds={};
  appData.volunteers.forEach(function(volunteer){
    (volunteer.attendance||[]).forEach(function(attendance){
      const year=yearFromDate(attendance.date);
      if(!year)return;
      if(!yearToVolunteerIds[year])yearToVolunteerIds[year]=[];
      if(yearToVolunteerIds[year].indexOf(volunteer.id)===-1)yearToVolunteerIds[year].push(volunteer.id);
    });
  });
  const counts={};
  Object.keys(yearToVolunteerIds).forEach(function(year){counts[year]=yearToVolunteerIds[year].length;});
  return counts;
}

function programmeCounts(){
  const counts={};
  PROGRAMME_OPTIONS.forEach(function(programme){counts[programme]=0;});
  let none=0;
  appData.volunteers.forEach(function(volunteer){
    const programmes=programmesToArray(volunteer.programmesRegistered);
    if(!programmes.length){none++;return;}
    programmes.forEach(function(programme){counts[programme]=(counts[programme]||0)+1;});
  });
  counts['No programme recorded']=none;
  return counts;
}

function activeVolunteerCount(){return appData.volunteers.filter(function(v){return(v.attendance||[]).length>0;}).length;}
function totalDeploymentRows(){return appData.volunteers.reduce(function(total,v){return total+(v.attendance||[]).length;},0);}
function totalHoursAll(){return appData.volunteers.reduce(function(total,v){return total+getTotalHours(v);},0);}
function recruitedCount(){return appData.volunteers.filter(function(v){return yearFromValue(v.recruitedYear);}).length;}

function sortedYearsFrom(){
  const years={};
  Array.prototype.slice.call(arguments).forEach(function(counts){Object.keys(counts).forEach(function(year){years[year]=true;});});
  return Object.keys(years).sort();
}

function renderMetricCard(label,value,note){return '<div class="dashboard-kpi"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong><em>'+escapeHtml(note||'')+'</em></div>';}

function renderBarChart(title,counts,emptyText){
  const keys=Object.keys(counts).filter(function(key){return counts[key]>0;});
  if(!keys.length)return '<div class="card"><h3>'+escapeHtml(title)+'</h3><p class="muted">'+escapeHtml(emptyText||'No data available.')+'</p></div>';
  const max=Math.max.apply(null,keys.map(function(key){return counts[key];}));
  let html='<div class="card"><h3>'+escapeHtml(title)+'</h3><div class="dashboard-bars">';
  keys.forEach(function(key){
    const value=counts[key];
    const width=max?Math.max(4,Math.round((value/max)*100)):0;
    html+='<div class="dashboard-bar-row"><div class="dashboard-bar-label">'+escapeHtml(key)+'</div><div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:'+width+'%"></div></div><div class="dashboard-bar-value">'+value+'</div></div>';
  });
  html+='</div></div>';
  return html;
}

function renderYearTable(recruited,deployed){
  const years=sortedYearsFrom(recruited,deployed);
  if(!years.length)return '<div class="card"><h3>Recruited and Deployed by Year</h3><p class="muted">No recruitment or deployment years available.</p></div>';
  const rows=years.map(function(year){return[year,recruited[year]||0,deployed[year]||0];});
  return '<div class="card"><h3>Recruited and Deployed by Year</h3>'+makeTable(['Year','Recruited','Deployed'],rows)+'</div>';
}

function renderDashboard(){
  const target=document.getElementById('dashboardContent');
  if(!target)return;
  const recruited=countByYearFromVolunteers(function(v){return yearFromValue(v.recruitedYear);});
  const deployed=deployedByYear();
  const programmes=programmeCounts();
  const total=appData.volunteers.length;
  const active=activeVolunteerCount();
  const inactive=total-active;
  target.innerHTML=[
    '<div class="card"><h2>Analytics Dashboard</h2><p class="muted">Recruitment is counted using <strong>Recruited Year</strong>. Deployment is counted using attendance dates; one volunteer is counted once per deployment year even if they have multiple attendance rows in that year.</p></div>',
    '<div class="dashboard-kpis">',
      renderMetricCard('Total Volunteers',String(total),'all records'),
      renderMetricCard('Recruited',String(recruitedCount()),'with recruited year'),
      renderMetricCard('Active / Deployed',String(active),'with attendance'),
      renderMetricCard('Total Hours',String(totalHoursAll()),'verified attendance hours'),
      renderMetricCard('Deployment Rows',String(totalDeploymentRows()),'attendance records'),
      renderMetricCard('Inactive',String(inactive),'no attendance'),
    '</div>',
    '<div class="grid dashboard-grid">',
      renderBarChart('Volunteers Recruited by Year',recruited,'No Recruited Year values found.'),
      renderBarChart('Volunteers Deployed by Year',deployed,'No attendance dates found.'),
    '</div>',
    '<div class="grid dashboard-grid">',
      renderBarChart('Programmes Registered',programmes,'No programme data available.'),
      renderYearTable(recruited,deployed),
    '</div>'
  ].join('');
}

const originalRenderAllForDashboard=renderAll;
renderAll=function(){originalRenderAllForDashboard();renderDashboard();};

document.addEventListener('DOMContentLoaded',renderDashboard);
