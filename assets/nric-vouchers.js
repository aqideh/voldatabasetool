(function installNricAndGrabVoucherSupport(){
  const LEGACY_ROSTER_HEADERS=ROSTER_HEADERS.slice();
  const LEGACY_EVENT_HEADERS=EVENT_LOG_HEADERS.slice();
  const NRIC_LABEL='Volunteer NRIC';
  const GRAB_FIELDS=['grabVoucherCode1','grabVoucherCode2','grabVoucherCode3'];
  const GRAB_LABELS=['Grab Voucher Code 1','Grab Voucher Code 2','Grab Voucher Code 3'];

  function normaliseNric(value){return cleanText(value).replace(/\s+/g,'').toUpperCase().slice(0,9);}
  function isValidNric(value){return value===''||/^[ST]\d{7}[A-Z]$/.test(value);}
  function maskNric(value){const nric=normaliseNric(value);return nric.length===9?nric.slice(0,1)+'****'+nric.slice(5):nric;}
  function normaliseGrabCode(value){return cleanText(value).slice(0,MAX_FIELD_LENGTH);}
  function grabCodes(row){return GRAB_FIELDS.map(function(key){return normaliseGrabCode(row&&row[key]);}).filter(Boolean);}
  function duplicateGrabCodesInRow(row){const codes=grabCodes(row).map(function(code){return code.toLowerCase();});return codes.some(function(code,index){return codes.indexOf(code)!==index;});}
  function duplicateGrabCodeElsewhere(code,rowId){const target=normaliseGrabCode(code).toLowerCase();if(!target)return false;return (appData.attendanceLog||[]).some(function(row){return row.id!==rowId&&grabCodes(row).some(function(existing){return existing.toLowerCase()===target;});});}
  function duplicateNricElsewhere(nric,volunteerId){const target=normaliseNric(nric);if(!target)return false;return appData.volunteers.some(function(v){return v.id!==volunteerId&&normaliseNric(v.nric)===target;});}

  if(!VOLUNTEER_SCHEMA.some(function(field){return field.key==='nric';})){
    const phoneIndex=VOLUNTEER_SCHEMA.findIndex(function(field){return field.key==='phone';});
    VOLUNTEER_SCHEMA.splice(phoneIndex>-1?phoneIndex:1,0,{key:'nric',label:NRIC_LABEL,type:'text'});
  }

  const originalSafeText=safeText;
  safeText=function(value,key){
    if(key==='nric')return normaliseNric(value);
    if(GRAB_FIELDS.indexOf(key)>-1)return normaliseGrabCode(value);
    return originalSafeText(value,key);
  };

  const originalValidateVolunteer=validateVolunteer;
  validateVolunteer=function(raw){
    const volunteer=originalValidateVolunteer(raw);
    volunteer.nric=normaliseNric(raw&&raw.nric);
    return volunteer;
  };

  const originalValidateEventLogRow=validateEventLogRow;
  validateEventLogRow=function(raw){
    const row=originalValidateEventLogRow(raw);
    GRAB_FIELDS.forEach(function(key){row[key]=normaliseGrabCode(raw&&raw[key]);});
    return row;
  };

  const originalSanitizeVolunteerRow=sanitizeVolunteerRow;
  sanitizeVolunteerRow=function(row){
    const volunteer=originalSanitizeVolunteerRow(row);
    volunteer.nric=normaliseNric(row&&row.nric);
    return volunteer;
  };

  mapRosterRow=function(row,rowNumber){
    const hasNric=row.length===LEGACY_ROSTER_HEADERS.length+1;
    const offset=hasNric?1:0;
    return sanitizeVolunteerRow({
      rowNumber:rowNumber,
      name:row[0],nric:hasNric?row[1]:'',phone:row[1+offset],email:row[2+offset],gender:row[3+offset],address:row[4+offset],
      recruitedYear:row[5+offset],chatSession:row[6+offset],chatSessionDate:row[7+offset],interests:row[8+offset],languagesSpoken:row[9+offset],
      emergencyName:row[10+offset],emergencyPhone:row[11+offset],shirtSize:row[12+offset],dietary:row[13+offset],programmesRegistered:row[14+offset],notes:row[15+offset],tags:[],attendance:[]
    });
  };

  const originalValidateMappedRow=validateMappedRow;
  validateMappedRow=function(row,type){
    const base=originalValidateMappedRow(row,type);
    const issues=base?base.split('; '):[];
    if(type==='roster'&&row.nric&&!isValidNric(row.nric))issues.push('Volunteer NRIC should use S/T followed by 7 digits and a letter');
    if(type==='roster'&&row.nric&&duplicateNricElsewhere(row.nric,''))issues.push('Volunteer NRIC already exists in the database');
    if(type==='attendance'&&duplicateGrabCodesInRow(row))issues.push('Grab voucher codes must be unique within the row');
    return issues.join('; ');
  };

  const originalValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    if(uploadedType==='roster'){
      const newHeaders=LEGACY_ROSTER_HEADERS.slice();
      newHeaders.splice(1,0,NRIC_LABEL);
      if(rows.length&&headersMatch(rows[0],LEGACY_ROSTER_HEADERS))return originalValidateAndPreviewRows(rows);
      if(!rows.length||!headersMatch(rows[0],newHeaders)){
        document.getElementById('previewCard').classList.add('hidden');
        showNotice('uploadStatus','bad','Template rejected. Expected either the legacy roster columns or the new roster columns including '+NRIC_LABEL+'.');
        return;
      }
      if(rows.length-1>MAX_IMPORT_ROWS){showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');return;}
      uploadedRows=[];
      for(let i=1;i<rows.length;i++){
        if(isBlankRow(rows[i]))continue;
        const mapped=mapRosterRow(rows[i],i+1);
        mapped.issue=validateMappedRow(mapped,'roster');mapped.valid=mapped.issue==='';uploadedRows.push(mapped);
      }
      renderPreview();return;
    }
    if(uploadedType==='attendance'){
      const newHeaders=LEGACY_EVENT_HEADERS.concat(GRAB_LABELS);
      if(rows.length&&headersMatch(rows[0],LEGACY_EVENT_HEADERS))return originalValidateAndPreviewRows(rows);
      if(!rows.length||!headersMatch(rows[0],newHeaders)){
        document.getElementById('previewCard').classList.add('hidden');
        showNotice('uploadStatus','bad','Template rejected. Expected either the legacy attendance columns or the new columns with three Grab voucher code fields.');return;
      }
      if(rows.length-1>MAX_IMPORT_ROWS){showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');return;}
      uploadedRows=[];
      for(let i=1;i<rows.length;i++){
        if(isBlankRow(rows[i]))continue;
        const mapped=mapAttendanceRow(rows[i],i+1);
        GRAB_FIELDS.forEach(function(key,index){mapped[key]=normaliseGrabCode(rows[i][8+index]);});
        mapped.issue=validateMappedRow(mapped,'attendance');mapped.valid=mapped.issue==='';uploadedRows.push(mapped);
      }
      renderPreview();return;
    }
    return originalValidateAndPreviewRows(rows);
  };

  const originalRenderPreview=renderPreview;
  renderPreview=function(){
    if(uploadedType==='roster'){
      const invalid=uploadedRows.filter(function(r){return !r.valid;}).length;
      const headers=['Row','Status','Name',NRIC_LABEL].concat(LEGACY_ROSTER_HEADERS.slice(1));
      const rows=uploadedRows.map(function(r){return [r.rowNumber,r.valid?'Ready':r.issue,r.name,maskNric(r.nric),r.phone,r.email,r.gender,r.address,r.recruitedYear,r.chatSession,r.chatSessionDate,r.interests,r.languagesSpoken,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.programmesRegistered,r.notes];});
      document.getElementById('previewCard').classList.remove('hidden');document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';document.getElementById('previewTable').innerHTML=makeTable(headers,rows);showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged and will not be imported.':'Preview created. All rows are ready.');return;
    }
    if(uploadedType==='attendance'&&uploadedRows.some(function(r){return GRAB_FIELDS.some(function(key){return Object.prototype.hasOwnProperty.call(r,key);});})){
      const invalid=uploadedRows.filter(function(r){return !r.valid;}).length;
      const rows=uploadedRows.map(function(r){return [r.rowNumber,r.valid?'Ready':r.issue,r.name,r.email,r.contact,r.attendance,r.eventName,r.eventDate,r.hours,r.minutes,formatDuration(r),r.grabVoucherCode1,r.grabVoucherCode2,r.grabVoucherCode3];});
      document.getElementById('previewCard').classList.remove('hidden');document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';document.getElementById('previewTable').innerHTML=makeTable(['Row','Status'].concat(LEGACY_EVENT_HEADERS).concat(['Duration']).concat(GRAB_LABELS),rows);showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged and will not be imported.':'Preview created. Attendance event log rows are ready.');return;
    }
    return originalRenderPreview();
  };

  const originalAddNewVolunteerFromRow=addNewVolunteerFromRow;
  addNewVolunteerFromRow=function(row,type){originalAddNewVolunteerFromRow(row,type);const volunteer=appData.volunteers[appData.volunteers.length-1];if(type==='roster'&&volunteer)volunteer.nric=normaliseNric(row.nric);};

  const originalFindFieldConflicts=findFieldConflicts;
  findFieldConflicts=function(existing,incoming,type){const result=originalFindFieldConflicts(existing,incoming,type);if(type==='roster'){const a=normaliseNric(existing.nric),b=normaliseNric(incoming.nric);if(a&&b&&a!==b){result.fields.push({key:'nric',label:NRIC_LABEL,existing:a,incoming:b});result.resolvedValues.nric=a;}}return result;};

  getFilteredVolunteers=function(){
    const q=document.getElementById('searchBox').value.toLowerCase().trim();
    const tag=document.getElementById('tagFilter').value,gender=document.getElementById('genderFilter').value,shirt=document.getElementById('shirtFilter').value,activity=document.getElementById('activityFilter').value,sort=document.getElementById('sortSelect').value;
    const noValue=document.getElementById('noValueFilter')?document.getElementById('noValueFilter').value:'';
    const filtered=appData.volunteers.filter(function(v){
      const tags=Array.isArray(v.tags)?v.tags:[];
      const text=[v.name,v.nric,maskNric(v.nric),v.phone,v.email,v.gender,v.address,v.recruitedYear,v.chatSession,v.chatSessionDate,v.interests,v.languagesSpoken,v.programmesRegistered,v.notes,v.dietary,tags.join(' ')].join(' ').toLowerCase();
      const has=typeof volunteerHasCapturedAttendance==='function'?volunteerHasCapturedAttendance(v):!!(v.attendance&&v.attendance.length);
      const noValueMatch=typeof noValueFilterMatches==='function'?noValueFilterMatches(v,noValue):true;
      return(!q||text.indexOf(q)>-1)&&(!tag||tags.indexOf(tag)>-1)&&(!gender||v.gender===gender)&&(!shirt||v.shirtSize===shirt)&&(!activity||(activity==='active'&&has)||(activity==='inactive'&&!has))&&noValueMatch;
    });
    sortVolunteers(filtered,sort);return filtered;
  };

  const originalRenderDatabase=renderDatabase;
  renderDatabase=function(){
    originalRenderDatabase();
    const table=document.querySelector('#databaseTable table');if(!table)return;
    const header=table.querySelector('thead tr');if(header&&!header.querySelector('[data-nric-column]')){const th=document.createElement('th');th.dataset.nricColumn='true';th.textContent=NRIC_LABEL;header.insertBefore(th,header.children[1]);}
    const volunteers=getFilteredVolunteers();table.querySelectorAll('tbody tr.clickable').forEach(function(tr,index){const td=document.createElement('td');td.textContent=maskNric(volunteers[index]&&volunteers[index].nric);tr.insertBefore(td,tr.children[1]);});
    table.querySelectorAll('tbody tr:not(.clickable) td.profile').forEach(function(td){td.colSpan=Number(td.colSpan||0)+1;});
  };

  const originalValidateProfileDraft=validateProfileDraft;
  validateProfileDraft=function(cleaned){const issues=originalValidateProfileDraft(cleaned);if(cleaned.nric&&!isValidNric(cleaned.nric))issues.push('Volunteer NRIC must use S/T followed by 7 digits and a letter.');if(cleaned.nric&&duplicateNricElsewhere(cleaned.nric,profileEditState.volunteerId))issues.push('Volunteer NRIC is already assigned to another volunteer.');return issues;};

  const originalRenderReadonlyProfile=renderReadonlyProfile;
  renderReadonlyProfile=function(volunteer){const html=originalRenderReadonlyProfile(volunteer);return html.replace('<strong>'+NRIC_LABEL+'</strong><span>'+escapeHtml(volunteer.nric||''),'<strong>'+NRIC_LABEL+'</strong><span>'+(volunteer.nric?escapeHtml(maskNric(volunteer.nric)):''));};

  eventLogExportRows=function(){return (appData.attendanceLog||[]).map(function(row){return safeExportRow({Name:row.name,Email:row.email,Contact:row.contact,Attendance:row.attendance,'Event Name':row.eventName,'Event Date':row.eventDate,Hours:durationHoursPart(row),Minutes:durationMinutesPart(row),'Decimal Hours':durationDecimalHours(row),'Duration Minutes':row.durationMinutes,'Grab Voucher Code 1':row.grabVoucherCode1,'Grab Voucher Code 2':row.grabVoucherCode2,'Grab Voucher Code 3':row.grabVoucherCode3});});};

  exportDatabaseXlsx=function(){
    if(!confirm('Export full database? This file contains NRIC and Grab voucher code data.'))return;
    const particulars=appData.volunteers.map(function(v){return safeExportRow({Name:v.name,'Volunteer NRIC':v.nric,Phone:v.phone,Email:v.email,Gender:v.gender,Address:v.address,'Recruited Year':v.recruitedYear,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,'Programmes Registered':v.programmesRegistered,Tags:tagsToText(v.tags),'Emergency Contact Name':v.emergencyName,'Emergency Contact Phone':v.emergencyPhone,'T-Shirt Size':v.shirtSize,'Dietary Requirements':v.dietary,Notes:v.notes,'Total Hours':getTotalHours(v),'Last Active':getLastActive(v)});});
    writeWorkbook('volunteer_database.xlsx',[['Volunteer Particulars',particulars],['Attendance Event Log',eventLogExportRows()]]);
  };

  downloadSampleRoster=function(){const headers=LEGACY_ROSTER_HEADERS.slice();headers.splice(1,0,NRIC_LABEL);const sample=['Jane Tan','S1234567A','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','2026','Intro Chat','2026-01-15','Tutoring, mentoring','English, Malay','John Tan','8123 4567','M','Halal','#amPowered, RSL','Sample only'];const sheet=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Volunteer Roster');XLSX.writeFile(wb,'volunteer_roster.xlsx');};
  downloadSampleAttendance=function(){const headers=LEGACY_EVENT_HEADERS.concat(GRAB_LABELS);const sheet=XLSX.utils.aoa_to_sheet([headers,['Jane Tan','jane@example.com','9123 4567','yes','Community Event','2026-01-15',4,30,'GRAB-001','GRAB-002',''],['Ali Ahmad','ali@example.com','8123 4567','','Community Event','2026-01-15',0,0,'','','']]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Attendance Event Log');XLSX.writeFile(wb,'attendance_event_log.xlsx');};

  const originalRenderEventLogEditor=renderEventLogEditor;
  renderEventLogEditor=function(){
    originalRenderEventLogEditor();
    const table=document.querySelector('#eventLogTable table');if(!table)return;
    const header=table.querySelector('thead tr');GRAB_LABELS.forEach(function(label){const th=document.createElement('th');th.textContent=label;header.insertBefore(th,header.lastElementChild);});
    const rows=getFilteredEventLogRows();table.querySelectorAll('tbody tr').forEach(function(tr,index){const row=rows[index];GRAB_FIELDS.forEach(function(key){const td=document.createElement('td');const input=document.createElement('input');input.maxLength=MAX_FIELD_LENGTH;input.value=row[key]||'';input.addEventListener('input',function(){row[key]=normaliseGrabCode(input.value);eventLogEditorDirty=true;saveData();});input.addEventListener('blur',function(){if(duplicateGrabCodesInRow(row)||duplicateGrabCodeElsewhere(row[key],row.id))input.setCustomValidity('This Grab voucher code is duplicated.');else input.setCustomValidity('');input.reportValidity();commitEventLogEdit();});td.appendChild(input);tr.insertBefore(td,tr.lastElementChild);});});
  };

  const originalRenderEventLogSummary=renderEventLogSummary;
  renderEventLogSummary=function(rows,totalRows){const base=originalRenderEventLogSummary(rows,totalRows);const count=(appData.attendanceLog||[]).reduce(function(total,row){return total+grabCodes(row).length;},0);return base.replace('</p>',' <span class="pill neutral">'+count+' Grab codes recorded</span></p>');};

  const originalRenderAttendanceEditor=renderAttendanceEditor;
  renderAttendanceEditor=function(v){const rows=eventLogRowsForVolunteer(v).sort(function(a,b){return(a.eventDate||'').localeCompare(b.eventDate||'');});if(!rows.length)return originalRenderAttendanceEditor(v);return makeTable(['Attendance','Event Name','Event Date','Hours','Minutes','Duration','Grab codes'],rows.map(function(row){return[row.attendance,row.eventName,row.eventDate,durationHoursPart(row),durationMinutesPart(row),formatDuration(row),grabCodes(row).length];}));};

  if(typeof NO_VALUE_FILTER_FIELDS!=='undefined'&&!NO_VALUE_FILTER_FIELDS.some(function(field){return field.key==='nric';}))NO_VALUE_FILTER_FIELDS.splice(2,0,{key:'nric',label:NRIC_LABEL});

  document.addEventListener('DOMContentLoaded',function(){const search=document.getElementById('searchBox');if(search)search.placeholder='Search name, NRIC, phone, email, gender, address, recruited year, chat session, interests, languages, programmes, notes, tags';});
})();
