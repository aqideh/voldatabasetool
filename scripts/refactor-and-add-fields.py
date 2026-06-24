from pathlib import Path

root = Path('.')
index_path = root / 'index.html'
assets_dir = root / 'assets'
assets_dir.mkdir(exist_ok=True)

html = index_path.read_text(encoding='utf-8')

# Extract inline CSS.
style_start = html.index('<style>')
style_content_start = style_start + len('<style>')
style_end = html.index('</style>', style_content_start)
css = html[style_content_start:style_end].strip() + '\n'

# Extract the application script. The vendor script tags live before this; use the final <script>.
script_start = html.rindex('<script>')
script_content_start = script_start + len('<script>')
script_end = html.index('</script>', script_content_start)
js = html[script_content_start:script_end].strip() + '\n'

# Split CSS and JS into assets.
(root / 'assets' / 'app.css').write_text(css, encoding='utf-8')
(root / 'assets' / 'app.js').write_text(js, encoding='utf-8')

# Replace inline CSS and JS references in index.html.
html = html[:style_start] + '<link rel="stylesheet" href="assets/app.css">' + html[style_end + len('</style>'):]
script_start = html.rindex('<script>')
script_end = html.index('</script>', script_start)
html = html[:script_start] + '<script src="assets/app.js"></script>' + html[script_end + len('</script>'):]

# Tighten CSP for repository-owned scripts and styles, while retaining inline handler allowance only for now.
html = html.replace("style-src 'self' 'unsafe-inline'", "style-src 'self'")
# inline event handlers in generated HTML still require unsafe-inline until the next refactor.
html = html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline'")

index_path.write_text(html, encoding='utf-8')

app = (assets_dir / 'app.js').read_text(encoding='utf-8')

replacements = {
    "const VOLUNTEER_SCHEMA=[{key:'name',label:'Name',type:'text'},{key:'phone',label:'Phone',type:'text'},{key:'email',label:'Email',type:'email'},{key:'gender',label:'Gender',type:'text'},{key:'address',label:'Address',type:'textarea'},{key:'emergencyName'": "const VOLUNTEER_SCHEMA=[{key:'name',label:'Name',type:'text'},{key:'phone',label:'Phone',type:'text'},{key:'email',label:'Email',type:'email'},{key:'gender',label:'Gender',type:'text'},{key:'address',label:'Address',type:'textarea'},{key:'chatSession',label:'Chat Session',type:'text'},{key:'chatSessionDate',label:'Chat Session Date Conducted',type:'date'},{key:'interests',label:'Interests',type:'textarea'},{key:'languagesSpoken',label:'Languages Spoken',type:'textarea'},{key:'emergencyName'",
    "const ROSTER_HEADERS=['Name','Phone','Email','Gender','Address','Emergency Contact Name','Emergency Contact Phone','T-Shirt Size','Dietary Requirements','Notes'];": "const ROSTER_HEADERS=['Name','Phone','Email','Gender','Address','Chat Session','Chat Session Date Conducted','Interests','Languages Spoken','Emergency Contact Name','Emergency Contact Phone','T-Shirt Size','Dietary Requirements','Notes'];",
    "function mapRosterRow(row,rowNumber){return sanitizeVolunteerRow({rowNumber:rowNumber,name:row[0],phone:row[1],email:row[2],gender:row[3],address:row[4],emergencyName:row[5],emergencyPhone:row[6],shirtSize:row[7],dietary:row[8],notes:row[9],tags:[],attendance:[]});}": "function mapRosterRow(row,rowNumber){return sanitizeVolunteerRow({rowNumber:rowNumber,name:row[0],phone:row[1],email:row[2],gender:row[3],address:row[4],chatSession:row[5],chatSessionDate:row[6],interests:row[7],languagesSpoken:row[8],emergencyName:row[9],emergencyPhone:row[10],shirtSize:row[11],dietary:row[12],notes:row[13],tags:[],attendance:[]});}",
    "function sanitizeVolunteerRow(row){return{rowNumber:row.rowNumber||0,name:safeText(row.name,'name'),phone:safeText(row.phone,'phone'),email:safeText(row.email,'email'),gender:safeText(row.gender,'gender'),address:safeText(row.address,'address'),emergencyName:safeText(row.emergencyName,'emergencyName'),emergencyPhone:safeText(row.emergencyPhone,'emergencyPhone'),shirtSize:safeText(row.shirtSize,'shirtSize'),dietary:safeText(row.dietary,'dietary'),notes:safeText(row.notes,'notes'),tags:sanitiseTags(row.tags),attendance:Array.isArray(row.attendance)?row.attendance:[]};}": "function sanitizeVolunteerRow(row){return{rowNumber:row.rowNumber||0,name:safeText(row.name,'name'),phone:safeText(row.phone,'phone'),email:safeText(row.email,'email'),gender:safeText(row.gender,'gender'),address:safeText(row.address,'address'),chatSession:safeText(row.chatSession,'chatSession'),chatSessionDate:safeDate(row.chatSessionDate,'chatSessionDate'),interests:safeText(row.interests,'interests'),languagesSpoken:safeText(row.languagesSpoken,'languagesSpoken'),emergencyName:safeText(row.emergencyName,'emergencyName'),emergencyPhone:safeText(row.emergencyPhone,'emergencyPhone'),shirtSize:safeText(row.shirtSize,'shirtSize'),dietary:safeText(row.dietary,'dietary'),notes:safeText(row.notes,'notes'),tags:sanitiseTags(row.tags),attendance:Array.isArray(row.attendance)?row.attendance:[]};}",
    "function safeText(value,key){const limit=(key==='address'||key==='notes')?MAX_LONG_FIELD_LENGTH:MAX_FIELD_LENGTH;return cleanText(value).slice(0,limit);}": "function safeText(value,key){const limit=(key==='address'||key==='notes'||key==='interests'||key==='languagesSpoken')?MAX_LONG_FIELD_LENGTH:MAX_FIELD_LENGTH;return cleanText(value).slice(0,limit);}\n\n// Sanitises date-like values to YYYY-MM-DD when possible.\nfunction safeDate(value,key){const text=safeText(formatExcelDate(value),key);if(!text)return '';if(/^\\d{4}-\\d{2}-\\d{2}$/.test(text))return text;const parsed=new Date(text);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);return text;}\n\n// Validates a mapped import row and returns a human-readable issue list.\nfunction validateMappedRow(row,type){const issues=[];if(cleanText(row.name)==='')issues.push('Name is required');if(cleanText(row.phone)===''&&cleanText(row.email)==='')issues.push('Phone or Email is required');if(row.email&&!isValidEmail(row.email))issues.push('Email format is invalid');if(row.chatSessionDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(row.chatSessionDate))issues.push('Chat Session Date Conducted should use YYYY-MM-DD');if(type==='attendance')row.hours=normaliseHours(row.hours);return issues.join('; ');}\n\n// Checks a common email address shape without blocking blank emails.\nfunction isValidEmail(value){return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(cleanText(value));}",
    "mapped.valid=hasCriticalFields(mapped);mapped.issue=mapped.valid?'':'Missing critical fields: Name and at least one of Phone or Email are required.';": "mapped.issue=validateMappedRow(mapped,uploadedType);mapped.valid=mapped.issue==='';",
    "[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.gender,r.address,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.notes]": "[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.gender,r.address,r.chatSession,r.chatSessionDate,r.interests,r.languagesSpoken,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.notes]",
    "const fields=type==='roster'?['name','phone','email','gender','address','emergencyName','emergencyPhone','shirtSize','dietary','notes']": "const fields=type==='roster'?['name','phone','email','gender','address','chatSession','chatSessionDate','interests','languagesSpoken','emergencyName','emergencyPhone','shirtSize','dietary','notes']",
    "const roster=[['gender','Gender'],['address','Address'],['emergencyName'": "const roster=[['gender','Gender'],['address','Address'],['chatSession','Chat Session'],['chatSessionDate','Chat Session Date Conducted'],['interests','Interests'],['languagesSpoken','Languages Spoken'],['emergencyName'",
    "item.incoming.gender,item.incoming.address,tagsToText(item.incoming.tags),item.reason": "item.incoming.gender,item.incoming.address,item.incoming.chatSession,item.incoming.chatSessionDate,item.incoming.interests,item.incoming.languagesSpoken,tagsToText(item.incoming.tags),item.reason",
    "['Action','Name','Phone','Email','Gender','Address','Staged tags','Reason']": "['Action','Name','Phone','Email','Gender','Address','Chat Session','Chat Session Date Conducted','Interests','Languages Spoken','Staged tags','Reason']",
    "'<br>Address: '+escapeHtml(p.address||'')+'<br>Tags": "'<br>Address: '+escapeHtml(p.address||'')+'<br>Chat Session: '+escapeHtml(p.chatSession||'')+'<br>Chat Session Date Conducted: '+escapeHtml(p.chatSessionDate||'')+'<br>Interests: '+escapeHtml(p.interests||'')+'<br>Languages Spoken: '+escapeHtml(p.languagesSpoken||'')+'<br>Tags",
    "address:row.address||'',emergencyName": "address:row.address||'',chatSession:row.chatSession||'',chatSessionDate:row.chatSessionDate||'',interests:row.interests||'',languagesSpoken:row.languagesSpoken||'',emergencyName",
    "v.name,v.phone,v.email,v.gender,v.address,v.notes,v.dietary,tags.join(' ')": "v.name,v.phone,v.email,v.gender,v.address,v.chatSession,v.chatSessionDate,v.interests,v.languagesSpoken,v.notes,v.dietary,tags.join(' ')"
}
for old, new in replacements.items():
    if old not in app:
        raise SystemExit(f'Missing expected JS text: {old[:100]}')
    app = app.replace(old, new)

# Replace central database rendering to include the new fields.
start = app.index("function renderDatabase(){populateTagFilter();")
end = app.index("\n\n// Returns filtered and sorted volunteers.", start)
app = app[:start] + """function renderDatabase(){populateTagFilter();populateGenderFilter();populateShirtFilter();const rows=getFilteredVolunteers();let html='<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Gender</th><th>Address</th><th>Chat Session</th><th>Chat Date</th><th>Interests</th><th>Languages</th><th>Tags</th><th>T-Shirt</th><th>Dietary</th><th>Total Hours</th><th>Last Active</th></tr></thead><tbody>';rows.forEach(function(v){html+='<tr class="clickable" onclick="toggleProfile(\\''+v.id+'\\')"><td>'+escapeHtml(v.name)+'</td><td>'+escapeHtml(v.phone)+'</td><td>'+escapeHtml(v.email)+'</td><td>'+escapeHtml(v.gender)+'</td><td>'+escapeHtml(v.address)+'</td><td>'+escapeHtml(v.chatSession)+'</td><td>'+escapeHtml(v.chatSessionDate)+'</td><td>'+escapeHtml(v.interests)+'</td><td>'+escapeHtml(v.languagesSpoken)+'</td><td>'+renderTagPills(v.tags)+'</td><td>'+escapeHtml(v.shirtSize)+'</td><td>'+escapeHtml(v.dietary)+'</td><td>'+getTotalHours(v)+'</td><td>'+escapeHtml(getLastActive(v))+'</td></tr>';if(expandedVolunteerId===v.id)html+='<tr><td colspan="14" class="profile">'+renderFullProfile(v)+'</td></tr>';});html+='</tbody></table>';document.getElementById('databaseTable').innerHTML=rows.length?html:'<p class="muted">No volunteers match the current filters.</p>';}""" + app[end:]

# Replace export functions for full and redacted XLSX.
start = app.index("function exportDatabaseXlsx(){")
end = app.index("\n\n// Exports a redacted roster", start)
app = app[:start] + """function exportDatabaseXlsx(){if(!confirm('Export full database? This file will contain volunteer personal data.'))return;const particulars=appData.volunteers.map(function(v){return safeExportRow({Name:v.name,Phone:v.phone,Email:v.email,Gender:v.gender,Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags:tagsToText(v.tags),'Emergency Contact Name':v.emergencyName,'Emergency Contact Phone':v.emergencyPhone,'T-Shirt Size':v.shirtSize,'Dietary Requirements':v.dietary,Notes:v.notes,'Total Hours':getTotalHours(v),'Last Active':getLastActive(v)});});const attendance=[];appData.volunteers.forEach(function(v){(v.attendance||[]).forEach(function(a){attendance.push(safeExportRow({Name:v.name,Phone:v.phone,Email:v.email,Gender:v.gender,Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags:tagsToText(v.tags),'Event Name':a.eventName,Date:a.date,Hours:a.hours,Role:a.role}));});});writeWorkbook('volunteer_database.xlsx',[['Volunteer Particulars',particulars],['Attendance Log',attendance]]);}""" + app[end:]

start = app.index("function exportRedactedXlsx(){")
end = app.index("\n\n// Exports merge log", start)
app = app[:start] + """function exportRedactedXlsx(){const rows=appData.volunteers.map(function(v){return safeExportRow({Name:v.name,Gender:v.gender,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags:tagsToText(v.tags),'T-Shirt Size':v.shirtSize,'Dietary Requirements':v.dietary,'Total Hours':getTotalHours(v),'Last Active':getLastActive(v)});});writeWorkbook('volunteer_redacted_roster.xlsx',[['Redacted Roster',rows]]);}""" + app[end:]

# Update sample roster row.
app = app.replace("['Jane Tan','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','John Tan','8123 4567','M','Halal','Sample only']", "['Jane Tan','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','Intro Chat','2026-01-15','Tutoring, mentoring','English, Malay','John Tan','8123 4567','M','Halal','Sample only']")

(assets_dir / 'app.js').write_text(app, encoding='utf-8')

# Update static search placeholder in index.
html = index_path.read_text(encoding='utf-8')
html = html.replace('Search name, phone, email, gender, address, notes, tags', 'Search name, phone, email, gender, address, chat session, interests, languages, notes, tags')
index_path.write_text(html, encoding='utf-8')

# Update README.
readme = Path('README.md')
r = readme.read_text(encoding='utf-8')
r = r.replace('5. Address\n6. Emergency Contact Name\n7. Emergency Contact Phone\n8. T-Shirt Size\n9. Dietary Requirements\n10. Notes', '5. Address\n6. Chat Session\n7. Chat Session Date Conducted\n8. Interests\n9. Languages Spoken\n10. Emergency Contact Name\n11. Emergency Contact Phone\n12. T-Shirt Size\n13. Dietary Requirements\n14. Notes')
r = r.replace('- Gender\n- Address\n- Emergency Contact Name', '- Gender\n- Address\n- Chat Session\n- Chat Session Date Conducted\n- Interests\n- Languages Spoken\n- Emergency Contact Name')
r = r.replace('The table shows Name, Phone, Email, Gender, Address, Tags, T-Shirt, Dietary, Total Hours, and Last Active.', 'The table shows Name, Phone, Email, Gender, Address, Chat Session, Chat Session Date Conducted, Interests, Languages Spoken, Tags, T-Shirt, Dietary, Total Hours, and Last Active.')
r = r.replace('Tags, gender, and address are included in:', 'Tags, gender, address, chat session details, interests, and languages spoken are included in:')
r = r.replace('Gender and Address are included in the schema and roster import template:', 'Gender, Address, Chat Session, Chat Session Date Conducted, Interests, and Languages Spoken are included in the schema and roster import template:')
r = r.replace("{ key:'address', label:'Address', type:'textarea' }", "{ key:'address', label:'Address', type:'textarea' }\n{ key:'chatSession', label:'Chat Session', type:'text' }\n{ key:'chatSessionDate', label:'Chat Session Date Conducted', type:'date' }\n{ key:'interests', label:'Interests', type:'textarea' }\n{ key:'languagesSpoken', label:'Languages Spoken', type:'textarea' }")
validation_note = 'Data validation checks Name, Phone or Email, email format, field length limits, tag limits, hours limits, and date-like values for Chat Session Date Conducted. Use YYYY-MM-DD for Chat Session Date Conducted.'
if validation_note not in r:
    r = r.replace('Rows are flagged as invalid when they do not have Name and at least one of Phone or Email. Invalid rows are previewed but not imported.\n', 'Rows are flagged as invalid when they do not have Name and at least one of Phone or Email. Invalid rows are previewed but not imported.\n\n' + validation_note + '\n')
readme.write_text(r, encoding='utf-8')
