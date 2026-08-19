(function installEventLogDuplicateDetection(){
  const NAME_DISTANCE_RATIO=0.24;
  const EVENT_DISTANCE_RATIO=0.18;

  function duplicateText(value){
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }

  function editDistance(a,b){
    if(a===b)return 0;
    if(!a)return b.length;
    if(!b)return a.length;
    if(a.length>b.length){const temp=a;a=b;b=temp;}
    let previous=[];
    for(let j=0;j<=a.length;j++)previous[j]=j;
    for(let i=1;i<=b.length;i++){
      const current=[i];
      for(let j=1;j<=a.length;j++){
        const cost=b.charAt(i-1)===a.charAt(j-1)?0:1;
        current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+cost);
      }
      previous=current;
    }
    return previous[a.length];
  }

  function textIsSimilar(left,right,maxRatio,normaliser){
    const a=normaliser(left),b=normaliser(right);
    if(!a||!b)return false;
    if(a===b)return true;
    const longest=Math.max(a.length,b.length);
    if(longest<5)return false;
    return editDistance(a,b)/longest<=maxRatio;
  }

  function duplicateName(value){return typeof normalizeName==='function'?normalizeName(value):duplicateText(value);}
  function duplicateEmail(value){return typeof normalizeEmail==='function'?normalizeEmail(value):duplicateText(value);}
  function namesAreSimilar(a,b){return textIsSimilar(a,b,NAME_DISTANCE_RATIO,duplicateName);}
  function eventNamesAreSimilar(a,b){return textIsSimilar(a,b,EVENT_DISTANCE_RATIO,duplicateText);}

  function rowsAreSuspectedDuplicates(a,b){
    if(!a||!b)return false;
    if(a.id&&b.id&&a.id===b.id)return false;
    const dateA=cleanText(a.eventDate),dateB=cleanText(b.eventDate);
    if(!dateA||dateA!==dateB)return false;
    if(!eventNamesAreSimilar(a.eventName,b.eventName))return false;
    const emailA=duplicateEmail(a.email),emailB=duplicateEmail(b.email);
    if(emailA&&emailB)return emailA===emailB;
    return namesAreSimilar(a.name,b.name);
  }

  function duplicateReason(a,b){
    const emailA=duplicateEmail(a&&a.email),emailB=duplicateEmail(b&&b.email);
    return emailA&&emailB&&emailA===emailB?'same email, same event date, similar event name':'similar name, same event date, similar event name';
  }

  function detectDuplicatePairs(rows){
    const byDate={};
    (rows||[]).forEach(function(row){
      const date=cleanText(row&&row.eventDate);
      if(!date||!cleanText(row&&row.eventName))return;
      if(!byDate[date])byDate[date]=[];
      byDate[date].push(row);
    });
    const pairs=[];
    Object.keys(byDate).forEach(function(date){
      const group=byDate[date];
      for(let i=0;i<group.length;i++){
        for(let j=i+1;j<group.length;j++){
          if(rowsAreSuspectedDuplicates(group[i],group[j]))pairs.push({a:group[i],b:group[j],reason:duplicateReason(group[i],group[j])});
        }
      }
    });
    return pairs;
  }

  function duplicateKey(row){return row&&row.id?row.id:'row-'+String(row&&row.rowNumber||'');}

  function duplicateMap(rows){
    const map={};
    detectDuplicatePairs(rows).forEach(function(pair){
      [pair.a,pair.b].forEach(function(row){
        const key=duplicateKey(row);
        if(!map[key])map[key]=[];
        map[key].push(pair.reason);
      });
    });
    return map;
  }

  function appendIssue(row,message){
    const issues=row.issue?row.issue.split('; '):[];
    if(issues.indexOf(message)===-1)issues.push(message);
    row.issue=issues.join('; ');
    row.valid=false;
  }

  function markUploadedDuplicateRows(){
    const imported=(uploadedRows||[]).filter(function(row){return row&&row.valid;});
    if(!imported.length)return 0;
    const existing=Array.isArray(appData.attendanceLog)?appData.attendanceLog:[];
    const importedKeys={};
    imported.forEach(function(row){importedKeys[duplicateKey(row)]=true;});
    const flagged={};
    detectDuplicatePairs(existing.concat(imported)).forEach(function(pair){
      const aKey=duplicateKey(pair.a),bKey=duplicateKey(pair.b);
      if(importedKeys[aKey])flagged[aKey]=pair.reason;
      if(importedKeys[bKey])flagged[bKey]=pair.reason;
    });
    imported.forEach(function(row){
      const reason=flagged[duplicateKey(row)];
      if(reason)appendIssue(row,'Suspected duplicate event log entry ('+reason+')');
    });
    return Object.keys(flagged).length;
  }

  const previousValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    previousValidateAndPreviewRows(rows);
    if(uploadedType!=='attendance')return;
    const preview=document.getElementById('previewCard');
    if(!preview||preview.classList.contains('hidden'))return;
    if(markUploadedDuplicateRows())renderPreview();
  };

  function pendingDuplicateRows(){
    if(!pendingImport||pendingImport.type!=='attendanceLog')return[];
    const pending=pendingImport.clean.map(function(item){return item.incoming;});
    const pendingKeys={};
    pending.forEach(function(row){pendingKeys[duplicateKey(row)]=true;});
    const flagged={};
    detectDuplicatePairs((appData.attendanceLog||[]).concat(pending)).forEach(function(pair){
      const aKey=duplicateKey(pair.a),bKey=duplicateKey(pair.b);
      if(pendingKeys[aKey])flagged[aKey]=pair.reason;
      if(pendingKeys[bKey])flagged[bKey]=pair.reason;
    });
    return pending.filter(function(row){return flagged[duplicateKey(row)];});
  }

  const previousConfirmImport=confirmImport;
  confirmImport=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLog')return previousConfirmImport();
    const duplicates=pendingDuplicateRows();
    if(duplicates.length){
      showNotice('mergeSummary','bad','Import blocked. '+duplicates.length+' suspected duplicate event log row'+(duplicates.length===1?' was':'s were')+' detected. Remove or correct the duplicate rows before importing.');
      return;
    }
    return previousConfirmImport();
  };

  function annotateEventLogDuplicates(){
    const target=document.getElementById('eventLogTable');
    const summary=document.getElementById('eventLogSummary');
    if(!target)return;
    const map=duplicateMap(appData.attendanceLog||[]);
    const duplicateKeys=Object.keys(map);
    if(summary&&duplicateKeys.length){
      summary.insertAdjacentHTML('beforeend',' <span class="pill warn">'+duplicateKeys.length+' suspected duplicate row'+(duplicateKeys.length===1?'':'s')+'</span>');
    }
    const table=target.querySelector('table');
    if(!table)return;
    const header=table.querySelector('thead tr');
    if(header&&!header.querySelector('[data-duplicate-column]')){
      const th=document.createElement('th');
      th.dataset.duplicateColumn='true';
      th.textContent='Duplicate check';
      header.insertBefore(th,header.lastElementChild);
    }
    table.querySelectorAll('tbody tr[data-event-log-row]').forEach(function(tr){
      const id=tr.getAttribute('data-event-log-row');
      if(tr.querySelector('[data-duplicate-status]'))return;
      const td=document.createElement('td');
      td.dataset.duplicateStatus='true';
      if(map[id]){
        const uniqueReasons=map[id].filter(function(reason,index,all){return all.indexOf(reason)===index;});
        td.innerHTML='<span class="pill warn" title="'+escapeHtml(uniqueReasons.join('; '))+'">Suspected duplicate</span>';
      }else{
        td.innerHTML='<span class="muted">—</span>';
      }
      tr.insertBefore(td,tr.lastElementChild);
    });
  }

  const previousRenderEventLogEditor=renderEventLogEditor;
  renderEventLogEditor=function(){
    previousRenderEventLogEditor();
    annotateEventLogDuplicates();
  };

  window.detectEventLogDuplicatePairs=detectDuplicatePairs;
  window.eventLogRowsAreSuspectedDuplicates=rowsAreSuspectedDuplicates;
})();
