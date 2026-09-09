(function installEventLogDuplicateFilter(){
  'use strict';
  const S=window.MaklomSharedDB;
  let duplicateOnly=false;

  function clean(value){return String(value==null?'':value).trim();}
  function rowKey(row){return row&&row.id?row.id:'row-'+String(row&&row.rowNumber||'');}

  // Keep structured event/shift links in the browser model so ordinary Event Log
  // edits do not lose the relationship and duplicate checks can distinguish shifts.
  if(typeof validateEventLogRow==='function'){
    const previousValidateEventLogRow=validateEventLogRow;
    validateEventLogRow=function(raw){
      const row=previousValidateEventLogRow(raw);
      row.eventId=safeText(raw&&raw.eventId,'id');
      row.shiftId=safeText(raw&&raw.shiftId,'id');
      return row;
    };
  }

  if(S&&typeof S.dbEventToLocal==='function'&&typeof S.eventToDb==='function'){
    const previousDbEventToLocal=S.dbEventToLocal;
    const previousEventToDb=S.eventToDb;
    S.dbEventToLocal=function(row){
      const local=previousDbEventToLocal(row);
      local.eventId=row&&row.event_id||'';
      local.shiftId=row&&row.shift_id||'';
      return local;
    };
    S.eventToDb=function(row){
      const db=previousEventToDb(row);
      db.event_id=S.nonBlank(row&&row.eventId);
      db.shift_id=S.nonBlank(row&&row.shiftId);
      return db;
    };
  }

  function crossShiftPair(pair){
    const a=pair&&pair.a,b=pair&&pair.b;
    return !!(a&&b&&clean(a.eventId)&&clean(b.eventId)&&a.eventId===b.eventId&&clean(a.shiftId)&&clean(b.shiftId)&&a.shiftId!==b.shiftId);
  }

  function duplicatePairs(rows){
    const detector=window.detectEventLogDuplicatePairs;
    if(typeof detector!=='function')return[];
    return detector(rows||[]).filter(function(pair){return !crossShiftPair(pair);});
  }

  function duplicateMap(rows){
    const map={};
    duplicatePairs(rows).forEach(function(pair){
      [pair.a,pair.b].forEach(function(row){
        const key=rowKey(row);
        if(!map[key])map[key]=[];
        if(pair.reason&&map[key].indexOf(pair.reason)===-1)map[key].push(pair.reason);
      });
    });
    return map;
  }

  function ensureDuplicateFilterControls(){
    const primary=document.getElementById('eventLogAttendanceFilter');
    if(primary&&!document.getElementById('eventLogDuplicateFilterTop')){
      const holder=document.createElement('div');
      holder.dataset.eventLogDuplicateFilter='true';
      holder.innerHTML='<label for="eventLogDuplicateFilterTop">Duplicate status</label><select id="eventLogDuplicateFilterTop"><option value="">All rows</option><option value="duplicates">Suspected duplicates only</option></select>';
      primary.closest('div').insertAdjacentElement('afterend',holder);
      holder.querySelector('select').addEventListener('change',function(event){
        duplicateOnly=event.target.value==='duplicates';
        syncDuplicateControls();
        if(typeof updateEventLogFilterBadge==='function')updateEventLogFilterBadge();
        if(typeof renderEventLogEditor==='function')renderEventLogEditor();
      });
    }

    const fields=document.querySelector('#eventLogFilterSheet .event-filter-fields');
    if(fields&&!document.getElementById('eventLogDuplicateFilterSheet')){
      const holder=document.createElement('div');
      holder.dataset.eventLogDuplicateFilter='true';
      holder.innerHTML='<label for="eventLogDuplicateFilterSheet">Duplicate status</label><select id="eventLogDuplicateFilterSheet"><option value="">All rows</option><option value="duplicates">Suspected duplicates only</option></select>';
      const sort=document.getElementById('eventLogSortSheet');
      const sortHolder=sort&&sort.closest('div');
      if(sortHolder)fields.insertBefore(holder,sortHolder);else fields.appendChild(holder);
    }
    syncDuplicateControls();
  }

  function syncDuplicateControls(){
    const value=duplicateOnly?'duplicates':'';
    const top=document.getElementById('eventLogDuplicateFilterTop');
    const sheet=document.getElementById('eventLogDuplicateFilterSheet');
    if(top)top.value=value;
    if(sheet)sheet.value=value;
  }

  if(typeof ensureEventLogFilterUi==='function'){
    const previousEnsureEventLogFilterUi=ensureEventLogFilterUi;
    ensureEventLogFilterUi=function(){
      previousEnsureEventLogFilterUi();
      ensureDuplicateFilterControls();
    };
  }

  if(typeof syncEventLogFilterControls==='function'){
    const previousSyncEventLogFilterControls=syncEventLogFilterControls;
    syncEventLogFilterControls=function(){
      previousSyncEventLogFilterControls();
      syncDuplicateControls();
    };
  }

  if(typeof activeEventLogFilterCount==='function'){
    const previousActiveEventLogFilterCount=activeEventLogFilterCount;
    activeEventLogFilterCount=function(){return previousActiveEventLogFilterCount()+(duplicateOnly?1:0);};
  }

  if(typeof openEventLogFilterSheet==='function'){
    const previousOpenEventLogFilterSheet=openEventLogFilterSheet;
    openEventLogFilterSheet=function(){
      ensureDuplicateFilterControls();
      previousOpenEventLogFilterSheet();
      syncDuplicateControls();
    };
  }

  if(typeof applyEventLogFilterSheet==='function'){
    const previousApplyEventLogFilterSheet=applyEventLogFilterSheet;
    applyEventLogFilterSheet=function(){
      const select=document.getElementById('eventLogDuplicateFilterSheet');
      duplicateOnly=!!(select&&select.value==='duplicates');
      previousApplyEventLogFilterSheet();
    };
  }

  if(typeof clearEventLogFilters==='function'){
    const previousClearEventLogFilters=clearEventLogFilters;
    clearEventLogFilters=function(){
      duplicateOnly=false;
      previousClearEventLogFilters();
      syncDuplicateControls();
    };
  }

  if(typeof getFilteredEventLogRows==='function'){
    const previousGetFilteredEventLogRows=getFilteredEventLogRows;
    getFilteredEventLogRows=function(){
      const rows=previousGetFilteredEventLogRows();
      if(!duplicateOnly)return rows;
      const map=duplicateMap(appData.attendanceLog||[]);
      return rows.filter(function(row){return !!map[rowKey(row)];});
    };
  }

  function correctDuplicateAnnotations(){
    const map=duplicateMap(appData.attendanceLog||[]);
    const keys=Object.keys(map);
    const summary=document.getElementById('eventLogSummary');
    if(summary){
      summary.querySelectorAll('.pill.warn').forEach(function(pill){
        if(/suspected duplicate row/i.test(pill.textContent||''))pill.remove();
      });
      if(keys.length)summary.insertAdjacentHTML('beforeend',' <span class="pill warn">'+keys.length+' suspected duplicate row'+(keys.length===1?'':'s')+'</span>');
    }

    document.querySelectorAll('#eventLogTable tr[data-event-log-row]').forEach(function(tr){
      const id=tr.getAttribute('data-event-log-row');
      const cell=tr.querySelector('[data-duplicate-status]');
      if(!cell)return;
      if(map[id]){
        cell.innerHTML='<span class="pill warn" title="'+escapeHtml(map[id].join('; '))+'">Suspected duplicate</span>';
      }else cell.innerHTML='<span class="muted">—</span>';
    });

    document.querySelectorAll('#eventLogTable [data-duplicate-card-status]').forEach(function(node){node.remove();});
    document.querySelectorAll('#eventLogTable [data-event-log-card]').forEach(function(card){
      const id=card.getAttribute('data-event-log-card');
      if(!map[id])return;
      const copy=card.querySelector('.event-log-card-copy');
      if(copy)copy.insertAdjacentHTML('beforeend','<span data-duplicate-card-status class="pill warn" title="'+escapeHtml(map[id].join('; '))+'">Suspected duplicate</span>');
    });
  }

  if(typeof renderEventLogEditor==='function'){
    const previousRenderEventLogEditor=renderEventLogEditor;
    renderEventLogEditor=function(){
      previousRenderEventLogEditor();
      ensureDuplicateFilterControls();
      correctDuplicateAnnotations();
    };
  }

  document.addEventListener('DOMContentLoaded',function(){
    ensureDuplicateFilterControls();
    if(typeof updateEventLogFilterBadge==='function')updateEventLogFilterBadge();
  });

  window.getShiftAwareEventLogDuplicatePairs=duplicatePairs;
})();
