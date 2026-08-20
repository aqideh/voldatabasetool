(function installDashboardEventRetention(){
  function analyticsOptions(){
    return{
      today:new Date().toISOString().slice(0,10),
      isAttended:attendanceWasCaptured,
      volunteerKey:function(row){return normalizeEmail(row.email)||normalizePhone(row.contact);},
      normaliseEventName:function(value){return cleanText(value).toLowerCase().replace(/\s+/g,' ');}
    };
  }
  function analyticsYears(){return EventRetentionAnalytics.years(dashboardEventLog(),analyticsOptions());}
  function defaultAnalyticsYear(){const years=analyticsYears(),current=String(new Date().getFullYear());return years.indexOf(current)>-1?current:(years.length?years[years.length-1]:current);}
  function selectedYear(){const select=document.getElementById('dashboardAnalyticsYear');return select&&select.value?select.value:defaultAnalyticsYear();}
  function selectedWindow(){const select=document.getElementById('dashboardRetentionWindow'),value=select?Number(select.value):90;return[30,60,90].indexOf(value)>-1?value:90;}
  function formatPercent(value){return value==null?'—':String(value.toFixed(1))+'%';}
  function formatRateWithCount(rate,numerator,denominator){return rate==null?'—':formatPercent(rate)+' ('+numerator+'/'+denominator+')';}
  function monthLabel(month){return['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month)-1]||month;}

  function renderPercentBarChart(title,items,emptyText){
    if(!items.length)return '<div class="card"><h3>'+escapeHtml(title)+'</h3><p class="muted">'+escapeHtml(emptyText||'No data available.')+'</p></div>';
    let html='<div class="card"><h3>'+escapeHtml(title)+'</h3><div class="dashboard-bars">';
    items.forEach(function(item){const width=item.rate==null?0:Math.max(0,Math.min(100,item.rate));html+='<div class="dashboard-bar-row"><div class="dashboard-bar-label">'+escapeHtml(item.label)+'</div><div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:'+width+'%"></div></div><div class="dashboard-bar-value">'+escapeHtml(item.rate==null?'—':formatPercent(item.rate))+'</div></div>';});
    return html+'</div></div>';
  }
  function renderEventNoShowTable(items){
    if(!items.length)return '<div class="card"><h3>Event-level No-show Rate</h3><p class="muted">No completed events available for the selected year.</p></div>';
    const rows=items.map(function(item){return[item.eventName,item.eventDate,item.total,item.attended,item.noShow,formatPercent(item.rate)];});
    return '<div class="card"><h3>Event-level No-show Rate</h3><p class="muted">Each row is one event occurrence, identified by event name and event date. Future events are excluded.</p>'+makeTable(['Event','Date','Deployed','Attended','No-show','Rate'],rows)+'</div>';
  }
  function renderCohortTable(items){
    if(!items.length)return '<div class="card"><h3>First-event Cohort Retention</h3><p class="muted">No first-time attendance cohorts available for the selected year.</p></div>';
    const rows=items.map(function(item){
      function cell(days){const metric=item.windows[days];return metric&&metric.mature?formatRateWithCount(metric.rate,metric.retained,metric.eligible):'Not mature';}
      const ninety=item.windows[90],drop=ninety&&ninety.mature?formatRateWithCount(ninety.dropOffRate,ninety.dropped,ninety.eligible):'Not mature';
      return[monthLabel(item.month),item.cohortTotal,cell(30),cell(60),cell(90),drop];
    });
    return '<div class="card"><h3>First-event Cohort Retention</h3><p class="muted">Cohorts are grouped by the month of a volunteer\'s first attended event. A month is Not mature until the full follow-up window has elapsed after month-end.</p>'+makeTable(['First-event month','First-time attendees','30d retained','60d retained','90d retained','90d drop-off'],rows)+'</div>';
  }
  function renderRetentionSection(){
    const rows=dashboardEventLog(),options=analyticsOptions(),years=analyticsYears(),year=selectedYear(),windowDays=selectedWindow();
    const noShow=EventRetentionAnalytics.noShowSummary(rows,year,options);
    const r30=EventRetentionAnalytics.retentionSummary(rows,year,30,options);
    const r60=EventRetentionAnalytics.retentionSummary(rows,year,60,options);
    const r90=EventRetentionAnalytics.retentionSummary(rows,year,90,options);
    const selected=EventRetentionAnalytics.retentionSummary(rows,year,windowDays,options);
    const monthlyNoShow=EventRetentionAnalytics.monthlyNoShow(rows,year,options).map(function(item){return{label:monthLabel(item.month),rate:item.rate};});
    const eventNoShow=EventRetentionAnalytics.eventNoShow(rows,year,options);
    const monthlyRetention=EventRetentionAnalytics.monthlyRetention(rows,year,[30,60,90],options);
    const dataThrough=EventRetentionAnalytics.latestCompletedDate(rows,options);
    const yearOptions=(years.length?years:[year]).map(function(value){return '<option value="'+escapeHtml(value)+'" '+(value===year?'selected':'')+'>'+escapeHtml(value)+'</option>';}).join('');
    return [
      '<div class="card dashboard-retention-header"><div><h2>Event Participation & Retention</h2><p class="muted">No-show is based on completed deployment rows. Retention follows volunteers from their first attended event to a second distinct attended event. Recent cohorts are excluded until the follow-up window is complete.</p></div><div class="dashboard-retention-controls"><div><label for="dashboardAnalyticsYear">Year</label><select id="dashboardAnalyticsYear">'+yearOptions+'</select></div><div><label for="dashboardRetentionWindow">Drop-off window</label><select id="dashboardRetentionWindow"><option value="30" '+(windowDays===30?'selected':'')+'>30 days</option><option value="60" '+(windowDays===60?'selected':'')+'>60 days</option><option value="90" '+(windowDays===90?'selected':'')+'>90 days</option></select></div></div></div>',
      '<div class="dashboard-kpis dashboard-retention-kpis">',
        renderMetricCard('No-show Rate',formatRateWithCount(noShow.rate,noShow.noShow,noShow.total),'completed deployment rows'),
        renderMetricCard('30d Retention',formatRateWithCount(r30.rate,r30.retained,r30.eligible),r30.immature+' immature first-timer'+(r30.immature===1?'':'s')),
        renderMetricCard('60d Retention',formatRateWithCount(r60.rate,r60.retained,r60.eligible),r60.immature+' immature first-timer'+(r60.immature===1?'':'s')),
        renderMetricCard('90d Retention',formatRateWithCount(r90.rate,r90.retained,r90.eligible),r90.immature+' immature first-timer'+(r90.immature===1?'':'s')),
        renderMetricCard('First→Second Drop-off',formatRateWithCount(selected.dropOffRate,selected.dropped,selected.eligible),'within '+windowDays+' days'),
      '</div>',
      '<div class="grid dashboard-grid">',
        renderPercentBarChart('Monthly Event No-show Rate — '+year,monthlyNoShow,'No completed deployment rows for this year.'),
        '<div class="card"><h3>Retention Data Quality</h3><p><strong>Data through:</strong> '+escapeHtml(dataThrough||'No completed event date')+'</p><p><strong>First-time attendees in '+escapeHtml(year)+':</strong> '+selected.cohortTotal+'</p><p><strong>Eligible for '+windowDays+'d evaluation:</strong> '+selected.eligible+'</p><p><strong>Not yet mature:</strong> '+selected.immature+'</p><p><strong>Attended rows excluded from retention due to missing email/phone:</strong> '+selected.missingIdentityRows+'</p><p class="muted">No-show uses deployment rows, so missing volunteer identity does not affect that metric.</p></div>',
      '</div>',
      renderEventNoShowTable(eventNoShow),
      renderCohortTable(monthlyRetention)
    ].join('');
  }
  function wireControls(){['dashboardAnalyticsYear','dashboardRetentionWindow'].forEach(function(id){const el=document.getElementById(id);if(el&&!el.dataset.dashboardRetentionBound){el.dataset.dashboardRetentionBound='true';el.addEventListener('change',renderDashboard);}});}
  function appendSection(){const target=document.getElementById('dashboardContent');if(!target||typeof EventRetentionAnalytics==='undefined')return;const old=document.getElementById('dashboardRetentionSection');if(old)old.remove();const section=document.createElement('div');section.id='dashboardRetentionSection';section.innerHTML=renderRetentionSection();target.appendChild(section);wireControls();}

  const previousRenderDashboard=renderDashboard;
  renderDashboard=function(){previousRenderDashboard();appendSection();};
  renderDashboard();
})();
