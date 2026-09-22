(function installWebAwesomeOverlays(){
  'use strict';

  function syncProxy(source){
    if(!source)return;
    const proxyId=source.dataset&&source.dataset.waProxyId;
    const proxy=proxyId?document.getElementById(proxyId):null;
    if(proxy&&'value' in proxy)proxy.value=source.value;
  }

  function installInfoDrawer(){
    // MakLom info uses the native side panel so it behaves consistently
    // on both GitHub Pages and the Vercel build.
  }

  function createFilterFab(){
    const existing=document.getElementById('eventLogFilterFab');
    if(existing&&existing.tagName==='WA-BUTTON')return existing;
    if(existing)existing.remove();

    const fab=document.createElement('wa-button');
    fab.id='eventLogFilterFab';
    fab.className='event-filter-fab maklom-filter-fab';
    fab.setAttribute('variant','brand');
    fab.setAttribute('appearance','filled');
    fab.setAttribute('circle','');
    fab.setAttribute('aria-label','Open event log filters');
    fab.setAttribute('aria-expanded','false');
    fab.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.4 7.2v5.2l-3.2 1.6v-6.8L4 5z"></path></svg><wa-badge id="eventLogFilterBadge" class="event-filter-badge hidden" pill variant="neutral">0</wa-badge>';
    fab.addEventListener('click',function(){window.openEventLogFilterSheet();});
    document.body.appendChild(fab);
    return fab;
  }

  function createFilterDrawer(){
    const existing=document.getElementById('eventLogFilterSheet');
    if(existing&&existing.tagName==='WA-DRAWER')return existing;
    if(existing)existing.remove();

    const drawer=document.createElement('wa-drawer');
    drawer.id='eventLogFilterSheet';
    drawer.className='maklom-filter-drawer';
    drawer.setAttribute('label','Filters');
    drawer.setAttribute('placement','bottom');
    drawer.innerHTML=[
      '<p class="muted maklom-filter-hint">Narrow the roster without taking up screen space.</p>',
      '<div class="event-filter-fields">',
        '<div><label for="eventLogAttendanceFilterSheet">Attendance</label><select id="eventLogAttendanceFilterSheet"><option value="">All rows</option><option value="yes">Attended</option><option value="blank">No-show / blank</option></select></div>',
        '<div><label for="eventLogEventFilterSheet">Event</label><select id="eventLogEventFilterSheet"><option value="">All events</option></select></div>',
        '<div><label for="eventLogSortSheet">Sort</label><select id="eventLogSortSheet"><option value="newest">Newest event first</option><option value="name">Volunteer name A-Z</option><option value="event">Event name A-Z</option></select></div>',
      '</div>',
      '<wa-button id="resetEventLogFiltersSheet" slot="footer" appearance="outlined" variant="neutral">Reset</wa-button>',
      '<wa-button id="applyEventLogFiltersSheet" slot="footer" appearance="filled" variant="brand">Apply</wa-button>'
    ].join('');

    drawer.querySelector('#resetEventLogFiltersSheet').addEventListener('click',function(){window.clearEventLogFilters();});
    drawer.querySelector('#applyEventLogFiltersSheet').addEventListener('click',function(){window.applyEventLogFilterSheet();});
    drawer.addEventListener('wa-after-hide',function(){
      const fab=document.getElementById('eventLogFilterFab');
      if(fab)fab.setAttribute('aria-expanded','false');
    });
    document.body.appendChild(drawer);
    return drawer;
  }

  if(typeof window.ensureEventLogFilterUi==='function'){
    window.ensureEventLogFilterUi=function(){
      createFilterFab();
      createFilterDrawer();
    };
  }

  if(typeof window.openEventLogFilterSheet==='function'){
    window.openEventLogFilterSheet=function(){
      window.ensureEventLogFilterUi();
      if(typeof window.populateEventLogEventFilter==='function')window.populateEventLogEventFilter();
      if(typeof window.syncEventLogFilterControls==='function')window.syncEventLogFilterControls();

      ['eventLogAttendanceFilterSheet','eventLogEventFilterSheet','eventLogSortSheet'].forEach(function(id){
        const source=document.getElementById(id);
        syncProxy(source);
      });

      const drawer=document.getElementById('eventLogFilterSheet');
      const fab=document.getElementById('eventLogFilterFab');
      if(drawer)drawer.setAttribute('open','');
      if(fab)fab.setAttribute('aria-expanded','true');
    };
  }

  if(typeof window.closeEventLogFilterSheet==='function'){
    window.closeEventLogFilterSheet=function(){
      const drawer=document.getElementById('eventLogFilterSheet');
      const fab=document.getElementById('eventLogFilterFab');
      if(drawer)drawer.removeAttribute('open');
      if(fab)fab.setAttribute('aria-expanded','false');
      document.body.classList.remove('event-filter-open');
    };
  }

  function start(){
    installInfoDrawer();
    if(typeof window.ensureEventLogFilterUi==='function')window.ensureEventLogFilterUi();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
