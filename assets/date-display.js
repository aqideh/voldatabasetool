(function installMaklomDateDisplay(){
  'use strict';

  const ISO_DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
  const DISPLAY_DATE=/^(\d{2})(\d{2})(\d{2})$/;
  const MONTHS={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  let refreshQueued=false;

  function validDateParts(year,month,day){
    const y=Number(year),m=Number(month),d=Number(day);
    if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(d)||m<1||m>12||d<1||d>31)return false;
    const date=new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
  }

  function formatDate(value){
    const match=String(value==null?'':value).trim().match(ISO_DATE);
    if(!match||!validDateParts(match[1],match[2],match[3]))return String(value==null?'':value);
    return match[3]+match[2]+match[1].slice(-2);
  }

  function parseDisplayDate(value){
    const raw=String(value==null?'':value).trim();
    const iso=raw.match(ISO_DATE);
    if(iso&&validDateParts(iso[1],iso[2],iso[3]))return raw;
    const digits=raw.replace(/\D/g,'');
    const match=digits.match(DISPLAY_DATE);
    if(!match)return'';
    const year=2000+Number(match[3]),month=Number(match[2]),day=Number(match[1]);
    if(!validDateParts(year,month,day))return'';
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }

  function singaporeParts(value){
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return null;
    const parts={};
    new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).forEach(function(part){parts[part.type]=part.value;});
    return parts;
  }

  function formatDateTime(value){
    const parts=singaporeParts(value);
    if(!parts)return String(value==null?'':value);
    return parts.day+parts.month+parts.year.slice(-2)+' '+parts.hour+':'+parts.minute;
  }

  function replaceGeneratedDates(value){
    let text=String(value==null?'':value);
    text=text.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g,function(_,year,month,day){return validDateParts(year,month,day)?day+month+year.slice(-2):_;});
    text=text.replace(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/g,function(_,day,monthName,year){const month=MONTHS[monthName];return String(Number(day)).padStart(2,'0')+month+year.slice(-2);});
    text=text.replace(/\b(\d{6}),\s+(\d{2}:\d{2})\b/g,'$1 $2');
    return text;
  }

  function exactDisplayText(value){
    const raw=String(value==null?'':value),trimmed=raw.trim();
    if(!trimmed)return raw;
    let formatted=trimmed;
    if(ISO_DATE.test(trimmed))formatted=formatDate(trimmed);
    else if(/^20\d{2}-\d{2}-\d{2}T/.test(trimmed))formatted=formatDateTime(trimmed);
    else if(/^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}(?:,?\s+\d{2}:\d{2})?$/.test(trimmed))formatted=replaceGeneratedDates(trimmed);
    if(formatted===trimmed)return raw;
    return raw.replace(trimmed,formatted);
  }

  function formatExactTextNodes(root){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(function(node){
      const parent=node.parentElement;
      if(!parent||/^(SCRIPT|STYLE|TEXTAREA)$/.test(parent.tagName))return;
      const next=exactDisplayText(node.nodeValue);
      if(next!==node.nodeValue)node.nodeValue=next;
    });
  }

  function formatPartialElement(element){
    if(!element)return;
    const next=replaceGeneratedDates(element.textContent);
    if(next!==element.textContent)element.textContent=next;
  }

  function eventLogRowForInput(input){
    const rowElement=input&&input.closest('tr[data-event-log-row]');
    if(!rowElement||!window.appData||!Array.isArray(window.appData.attendanceLog))return null;
    return window.appData.attendanceLog.find(function(row){return row.id===rowElement.dataset.eventLogRow;})||null;
  }

  function wireEventLogDateInput(input){
    if(!input||input.dataset.maklomDateDisplay==='1'||input.type==='date')return;
    input.dataset.maklomDateDisplay='1';
    function syncDisplay(){
      const row=eventLogRowForInput(input);
      const iso=row&&row.eventDate||input.dataset.maklomIsoDate||parseDisplayDate(input.value);
      if(!iso)return;
      input.dataset.maklomIsoDate=iso;
      input.value=formatDate(iso);
      input.removeAttribute('aria-invalid');
    }
    input.addEventListener('blur',function(){setTimeout(syncDisplay,0);});
    syncDisplay();
  }

  function wrapEventLogDateEditor(){
    const current=window.editEventLogField;
    if(typeof current!=='function'||current.__maklomDdMmYyWrapped)return;
    function wrapped(id,key,value,element){
      if(key==='eventDate'&&element&&element.type!=='date'){
        const raw=String(value==null?'':value).trim();
        if(raw==='')return current.call(this,id,key,'',element);
        const parsed=parseDisplayDate(raw);
        if(!parsed){element.setAttribute('aria-invalid','true');return;}
        element.dataset.maklomIsoDate=parsed;
        element.removeAttribute('aria-invalid');
        return current.call(this,id,key,parsed,element);
      }
      return current.apply(this,arguments);
    }
    wrapped.__maklomDdMmYyWrapped=true;
    window.editEventLogField=wrapped;
  }

  function refresh(){
    refreshQueued=false;
    wrapEventLogDateEditor();

    ['databaseTable','previewTable','cleanBucket','conflictBucket','mergeLogTable','duplicateQueue','dashboardContent','formAttendanceContent','eventManagerContent'].forEach(function(id){formatExactTextNodes(document.getElementById(id));});

    [
      '#eventManagerContent .event-row-meta',
      '#eventManagerContent .event-manager-head p.muted',
      '#eventManagerContent .event-shift-row .muted',
      '#eventManagerContent .event-data-issue .muted',
      '#eventManagerContent .event-candidate-row .muted',
      '#eventBatchEvent option',
      '#eventBatchShift option',
      '#eventLogTable .event-log-card-copy > span:first-of-type',
      '#formAttendanceContent .fa-order-time strong',
      '#formAttendanceContent .fa-original-grid dl > div:first-child dd'
    ].forEach(function(selector){document.querySelectorAll(selector).forEach(formatPartialElement);});

    document.querySelectorAll('#eventLogTable .event-log-desktop input[oninput*="eventDate"]').forEach(wireEventLogDateInput);
  }

  function scheduleRefresh(){
    if(refreshQueued)return;
    refreshQueued=true;
    requestAnimationFrame(refresh);
  }

  window.MaklomDateDisplay={format:formatDate,parse:parseDisplayDate,formatDateTime:formatDateTime,refresh:scheduleRefresh};

  document.addEventListener('DOMContentLoaded',function(){
    scheduleRefresh();
    const main=document.querySelector('main');
    if(main)new MutationObserver(scheduleRefresh).observe(main,{childList:true,subtree:true,characterData:true});
  });
  window.addEventListener('maklom:access-state',scheduleRefresh);
  setTimeout(scheduleRefresh,500);
})();
