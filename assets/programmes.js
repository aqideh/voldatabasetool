const PROGRAMME_OPTIONS=['#amPowered','RSL','Befrienders','Community Volunteers'];

function normaliseProgrammeName(value){
  const text=cleanText(value);
  const found=PROGRAMME_OPTIONS.find(function(option){return option.toLowerCase()===text.toLowerCase();});
  return found||'';
}

function parseProgrammesRegistered(value){
  const out=[];
  cleanText(value).split(',').forEach(function(item){
    const programme=normaliseProgrammeName(item);
    if(programme&&out.indexOf(programme)===-1)out.push(programme);
  });
  return out.join(', ');
}

function programmesToArray(value){
  return parseProgrammesRegistered(value).split(',').map(function(item){return cleanText(item);}).filter(Boolean);
}

function renderProgrammeOptions(){return PROGRAMME_OPTIONS.map(function(option){return '<span class="pill tag">'+escapeHtml(option)+'</span>';}).join(' ');}

function renderProgrammePills(value){
  const programmes=programmesToArray(value);
  if(!programmes.length)return '<span class="muted">No programmes</span>';
  return programmes.map(function(programme){return '<span class="pill tag">'+escapeHtml(programme)+'</span>';}).join('');
}

(function installProgrammeSchema(){
  if(!VOLUNTEER_SCHEMA.some(function(field){return field.key==='programmesRegistered';})){
    const tagIndex=VOLUNTEER_SCHEMA.findIndex(function(field){return field.key==='tags';});
    const field={key:'programmesRegistered',label:'Programmes Registered',type:'textarea'};
    if(tagIndex>-1)VOLUNTEER_SCHEMA.splice(tagIndex,0,field);else VOLUNTEER_SCHEMA.push(field);
  }
  if(ROSTER_HEADERS.indexOf('Programmes Registered')===-1){
    const notesIndex=ROSTER_HEADERS.indexOf('Notes');
    if(notesIndex>-1)ROSTER_HEADERS.splice(notesIndex,0,'Programmes Registered');else ROSTER_HEADERS.push('Programmes Registered');
  }
})();

const originalSafeTextForProgrammes=safeText;
safeText=function(value,key){
  if(key==='programmesRegistered')return parseProgrammesRegistered(value).slice(0,MAX_LONG_FIELD_LENGTH);
  return originalSafeTextForProgrammes(value,key);
};

mapRosterRow=function(row,rowNumber){return sanitizeVolunteerRow({rowNumber:rowNumber,name:row[0],phone:row[1],email:row[2],gender:row[3],address:row[4],chatSession:row[5],chatSessionDate:row[6],interests:row[7],languagesSpoken:row[8],emergencyName:row[9],emergencyPhone:row[10],shirtSize:row[11],dietary:row[12],programmesRegistered:row[13],notes:row[14],tags:[],attendance:[]});};

sanitizeVolunteerRow=function(row){return{rowNumber:row.rowNumber||0,name:safeText(row.name,'name'),phone:safeText(row.phone,'phone'),email:safeText(row.email,'email'),gender:safeText(row.gender,'gender'),address:safeText(row.address,'address'),chatSession:safeText(row.chatSession,'chatSession'),chatSessionDate:safeDate(row.chatSessionDate,'chatSessionDate'),interests:safeText(row.interests,'interests'),languagesSpoken:safeText(row.languagesSpoken,'languagesSpoken'),emergencyName:safeText(row.emergencyName,'emergencyName'),emergencyPhone:safeText(row.emergencyPhone,'emergencyPhone'),shirtSize:safeText(row.shirtSize,'shirtSize'),dietary:safeText(row.dietary,'dietary'),programmesRegistered:safeText(row.programmesRegistered,'programmesRegistered'),notes:safeText(row.notes,'notes'),tags:sanitiseTags(row.tags),attendance:Array.isArray(row.attendance)?row.attendance:[]};};

addNewVolunteerFromRow=function(row,type){const v=validateVolunteer({id:makeId('vol'),name:row.name,phone:row.phone,email:row.email,gender:row.gender||'',address:row.address||'',chatSession:row.chatSession||'',chatSessionDate:row.chatSessionDate||'',interests:row.interests||'',languagesSpoken:row.languagesSpoken||'',emergencyName:row.emergencyName||'',emergencyPhone:row.emergencyPhone||'',shirtSize:row.shirtSize||'',dietary:row.dietary||'',programmesRegistered:row.programmesRegistered||'',tags:Array.isArray(row.tags)?row.tags:[],notes:row.notes||'',attendance:[]});if(type==='attendance')v.attendance.push(makeAttendanceFromRow(row));appData.volunteers.push(v);};

renderMiniProfile=function(p){if(!p)return'<p class="muted">Missing record</p>';return'<p>Name: '+escapeHtml(p.name)+'<br>Phone: '+escapeHtml(p.phone)+'<br>Email: '+escapeHtml(p.email)+'<br>Gender: '+escapeHtml(p.gender||'')+'<br>Address: '+escapeHtml(p.address||'')+'<br>Chat Session: '+escapeHtml(p.chatSession||'')+'<br>Chat Session Date Conducted: '+escapeHtml(p.chatSessionDate||'')+'<br>Interests: '+escapeHtml(p.interests||'')+'<br>Languages Spoken: '+escapeHtml(p.languagesSpoken||'')+'<br>Programmes Registered: '+escapeHtml(p.programmesRegistered||'')+'<br>Tags: '+escapeHtml(tagsToText(p.tags))+'</p>';};

renderDatabase=function(){populateTagFilter();populateGenderFilter();populateShirtFilter();const rows=getFilteredVolunteers();let html='<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Gender</th><th>Address</th><th>Chat Session</th><th>Chat Date</th><th>Interests</th><th>Languages</th><th>Programmes</th><th>Tags</th><th>T-Shirt</th><th>Dietary</th><th>Total Hours</th><th>Last Active</th></tr></thead><tbody>';rows.forEach(function(v){html+='<tr class="clickable" onclick="toggleProfile(\''+v.id+'\')"><td>'+escapeHtml(v.name)+'</td><td>'+escapeHtml(v.phone)+'</td><td>'+escapeHtml(v.email)+'</td><td>'+escapeHtml(v.gender)+'</td><td>'+escapeHtml(v.address)+'</td><td>'+escapeHtml(v.chatSession)+'</td><td>'+escapeHtml(v.chatSessionDate)+'</td><td>'+escapeHtml(v.interests)+'</td><td>'+escapeHtml(v.languagesSpoken)+'</td><td>'+renderProgrammePills(v.programmesRegistered)+'</td><td>'+renderTagPills(v.tags)+'</td><td>'+escapeHtml(v.shirtSize)+'</td><td>'+escapeHtml(v.dietary)+'</td><td>'+getTotalHours(v)+'</td><td>'+escapeHtml(getLastActive(v))+'</td></tr>';if(expandedVolunteerId===v.id)html+='<tr><td colspan="15" class="profile">'+renderFullProfile(v)+'</td></tr>';});html+='</tbody></table>';document.getElementById('databaseTable').innerHTML=rows.length?html:'<p class="muted">No volunteers match the current filters.</p>';};

const originalRenderPreviewForProgrammes=renderPreview;
renderPreview=function(){
  const invalid=uploadedRows.filter(function(r){return !r.valid;}).length;
  const headers=uploadedType==='roster'?['Row','Status'].concat(ROSTER_HEADERS):['Row','Status'].concat(ATTENDANCE_HEADERS);
  const rows=uploadedRows.map(function(r){return uploadedType==='roster'?[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.gender,r.address,r.chatSession,r.chatSessionDate,r.interests,r.languagesSpoken,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.programmesRegistered,r.notes]:[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.eventName,r.date,r.hours,r.role];});
  document.getElementById('previewCard').classList.remove('hidden');
  document.getElementById('previewMeta').innerHTML='<p><span class="pill neutral">'+uploadedRows.length+' rows</span> <span class="pill '+(invalid?'bad':'ok')+'">'+invalid+' invalid rows</span></p>';
  document.getElementById('previewTable').innerHTML=makeTable(headers,rows);
  showNotice('uploadStatus',invalid?'warn':'ok',invalid?'Preview created. Invalid rows are flagged and will not be imported.':'Preview created. All rows have required critical fields.');
};

const originalExportDatabaseXlsxForProgrammes=exportDatabaseXlsx;
exportDatabaseXlsx=function(){
  if(!confirm('Export full database? This file will contain volunteer personal data.'))return;
  const particulars=appData.volunteers.map(function(v){return safeExportRow({Name:v.name,Phone:v.phone,Email:v.email,Gender:v.gender,Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,'Programmes Registered':v.programmesRegistered,Tags:tagsToText(v.tags),'Emergency Contact Name':v.emergencyName,'Emergency Contact Phone':v.emergencyPhone,'T-Shirt Size':v.shirtSize,'Dietary Requirements':v.dietary,Notes:v.notes,'Total Hours':getTotalHours(v),'Last Active':getLastActive(v)});});
  const attendance=[];
  appData.volunteers.forEach(function(v){(v.attendance||[]).forEach(function(a){attendance.push(safeExportRow({Name:v.name,Phone:v.phone,Email:v.email,Gender:v.gender,Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,'Programmes Registered':v.programmesRegistered,Tags:tagsToText(v.tags),'Event Name':a.eventName,Date:a.date,Hours:a.hours,Role:a.role}));});});
  writeWorkbook('volunteer_database.xlsx',[['Volunteer Particulars',particulars],['Attendance Log',attendance]]);
};

const originalExportRedactedXlsxForProgrammes=exportRedactedXlsx;
exportRedactedXlsx=function(){
  const rows=appData.volunteers.map(function(v){return safeExportRow({Name:v.name,Gender:v.gender,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,'Programmes Registered':v.programmesRegistered,Tags:tagsToText(v.tags),'T-Shirt Size':v.shirtSize,'Dietary Requirements':v.dietary,'Total Hours':getTotalHours(v),'Last Active':getLastActive(v)});});
  writeWorkbook('volunteer_redacted_roster.xlsx',[['Redacted Roster',rows]]);
};

downloadSampleRoster=function(){const sheet=XLSX.utils.aoa_to_sheet([ROSTER_HEADERS,['Jane Tan','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','Intro Chat','2026-01-15','Tutoring, mentoring','English, Malay','John Tan','8123 4567','M','Halal','#amPowered, RSL','Sample only']]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Volunteer Roster');XLSX.writeFile(wb,'volunteer_roster.xlsx');};
