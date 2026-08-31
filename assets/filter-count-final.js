(function installFilteredCentralDatabaseExport(){
  'use strict';

  const EXPORT_COLUMNS=[
    ['Name',function(v){return v.name;}],
    ['Volunteer NRIC',function(v){return maskNric(v.nric);} ],
    ['Phone',function(v){return v.phone;}],
    ['Email',function(v){return v.email;}],
    ['Gender',function(v){return v.gender;}],
    ['Address',function(v){return v.address;}],
    ['Recruited Year',function(v){return v.recruitedYear;}],
    ['Chat Session',function(v){return v.chatSession;}],
    ['Chat Session Date Conducted',function(v){return v.chatSessionDate;}],
    ['Interests',function(v){return v.interests;}],
    ['Languages Spoken',function(v){return v.languagesSpoken;}],
    ['Programmes',function(v){return programmeValues(v).join('; ');}],
    ['Tags',function(v){return Array.isArray(v.tags)?v.tags.join('; '):'';}],
    ['T-Shirt Size',function(v){return v.shirtSize;}],
    ['Dietary Requirements',function(v){return v.dietary;}],
    ['Total Hours',function(v){return typeof getTotalHours==='function'?getTotalHours(v):'';}],
    ['Last Active',function(v){return typeof getLastActive==='function'?getLastActive(v):'';}]
  ];

  function text(value){return String(value==null?'':value);}
  function maskNric(value){const nric=text(value).replace(/\s+/g,'').toUpperCase();return nric.length===9?nric.slice(0,1)+'****'+nric.slice(5):nric;}
  function programmeValues(volunteer){
    if(typeof programmesToArray==='function')return programmesToArray(volunteer&&volunteer.programmesRegistered);
    const value=volunteer&&volunteer.programmesRegistered;
    if(Array.isArray(value))return value.filter(Boolean);
    if(!value)return[];
    return text(value).split(/[;,]/).map(function(item){return item.trim();}).filter(Boolean);
  }
  function csvCell(value){
    let cell=text(value).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    if(/^[\t\n\r ]*[=+\-@]/.test(cell))cell="'"+cell;
    return '"'+cell.replace(/"/g,'""')+'"';
  }
  function singaporeDate(){
    const parts={};
    new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(function(part){parts[part.type]=part.value;});
    return parts.year+'-'+parts.month+'-'+parts.day;
  }
  function setStatus(message,type){
    const el=document.getElementById('filteredCsvStatus');if(!el)return;
    el.textContent=message||'';el.className='muted'+(type==='bad'?' bad-text':'');
  }
  function currentRows(){return typeof window.getFilteredVolunteers==='function'?window.getFilteredVolunteers():[];}
  function exportFilteredCsv(){
    const rows=currentRows();
    if(!rows.length){setStatus('No volunteers match the current query.','bad');return;}
    const csvRows=[EXPORT_COLUMNS.map(function(column){return csvCell(column[0]);}).join(',')];
    rows.forEach(function(volunteer){csvRows.push(EXPORT_COLUMNS.map(function(column){return csvCell(column[1](volunteer));}).join(','));});
    const blob=new Blob(['\ufeff'+csvRows.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a'),filename='maklom-filtered-volunteers-'+singaporeDate()+'.csv';
    anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    setStatus('Exported '+rows.length+' '+(rows.length===1?'volunteer':'volunteers')+' in the current filtered and sorted order.');
  }
  function install(){
    const count=document.getElementById('databaseMatchCount');if(!count||document.getElementById('exportFilteredCentralCsv'))return;
    const toolbar=document.createElement('div');toolbar.className='row';toolbar.innerHTML='<button id="exportFilteredCentralCsv" type="button">Export filtered list (.csv)</button><span id="filteredCsvStatus" class="muted">Exports exactly the current Central Database query and sort order.</span>';
    count.insertAdjacentElement('afterend',toolbar);
    document.getElementById('exportFilteredCentralCsv').addEventListener('click',exportFilteredCsv);
  }

  window.exportFilteredCentralDatabaseCsv=exportFilteredCsv;
  document.addEventListener('DOMContentLoaded',install);
})();
