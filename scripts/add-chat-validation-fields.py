from pathlib import Path

index = Path('index.html')
readme = Path('README.md')
text = index.read_text(encoding='utf-8')

replacements = {
    "Search name, phone, email, gender, address, notes, tags": "Search name, phone, email, gender, address, chat session, interests, languages, notes, tags",
    "{key:'address',label:'Address',type:'textarea'},{key:'emergencyName'": "{key:'address',label:'Address',type:'textarea'},{key:'chatSession',label:'Chat Session',type:'text'},{key:'chatSessionDate',label:'Chat Session Date Conducted',type:'date'},{key:'interests',label:'Interests',type:'textarea'},{key:'languagesSpoken',label:'Languages Spoken',type:'textarea'},{key:'emergencyName'",
    "'Name','Phone','Email','Gender','Address','Emergency Contact Name'": "'Name','Phone','Email','Gender','Address','Chat Session','Chat Session Date Conducted','Interests','Languages Spoken','Emergency Contact Name'",
    "address:row[4],emergencyName:row[5],emergencyPhone:row[6],shirtSize:row[7],dietary:row[8],notes:row[9]": "address:row[4],chatSession:row[5],chatSessionDate:row[6],interests:row[7],languagesSpoken:row[8],emergencyName:row[9],emergencyPhone:row[10],shirtSize:row[11],dietary:row[12],notes:row[13]",
    "address:safeText(row.address,'address'),emergencyName:safeText(row.emergencyName,'emergencyName')": "address:safeText(row.address,'address'),chatSession:safeText(row.chatSession,'chatSession'),chatSessionDate:safeDate(row.chatSessionDate,'chatSessionDate'),interests:safeText(row.interests,'interests'),languagesSpoken:safeText(row.languagesSpoken,'languagesSpoken'),emergencyName:safeText(row.emergencyName,'emergencyName')",
    "(key==='address'||key==='notes')": "(key==='address'||key==='notes'||key==='interests'||key==='languagesSpoken')",
    "return cleanText(value).slice(0,limit);}\n\n// Formats Excel dates": "return cleanText(value).slice(0,limit);}\n\n// Sanitises date-like text to YYYY-MM-DD when possible.\nfunction safeDate(value,key){const text=safeText(formatExcelDate(value),key);if(!text)return '';if(/^\\d{4}-\\d{2}-\\d{2}$/.test(text))return text;const parsed=new Date(text);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);return text.slice(0,MAX_FIELD_LENGTH);}\n\n// Validates mapped import rows and returns a human-readable issue.\nfunction validateMappedRow(row,type){const issues=[];if(cleanText(row.name)==='')issues.push('Name is required');if(cleanText(row.phone)===''&&cleanText(row.email)==='')issues.push('Phone or Email is required');if(row.email&&!isValidEmail(row.email))issues.push('Email format is invalid');if(row.chatSessionDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(row.chatSessionDate))issues.push('Chat Session Date Conducted should use YYYY-MM-DD');if(type==='attendance'&&normaliseHours(row.hours)!==Number(row.hours))row.hours=normaliseHours(row.hours);return issues.join('; ');}\n\n// Checks common email address shape without blocking blank emails.\nfunction isValidEmail(value){return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(cleanText(value));}\n\n// Formats Excel dates",
    "mapped.valid=hasCriticalFields(mapped);mapped.issue=mapped.valid?'':'Missing critical fields: Name and at least one of Phone or Email are required.';": "mapped.issue=validateMappedRow(mapped,uploadedType);mapped.valid=mapped.issue==='';",
    "[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.gender,r.address,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.notes]": "[r.rowNumber,r.valid?'Ready':r.issue,r.name,r.phone,r.email,r.gender,r.address,r.chatSession,r.chatSessionDate,r.interests,r.languagesSpoken,r.emergencyName,r.emergencyPhone,r.shirtSize,r.dietary,r.notes]",
    "['name','phone','email','gender','address','emergencyName'": "['name','phone','email','gender','address','chatSession','chatSessionDate','interests','languagesSpoken','emergencyName'",
    "['gender','Gender'],['address','Address'],['emergencyName'": "['gender','Gender'],['address','Address'],['chatSession','Chat Session'],['chatSessionDate','Chat Session Date Conducted'],['interests','Interests'],['languagesSpoken','Languages Spoken'],['emergencyName'",
    "item.incoming.gender,item.incoming.address,tagsToText": "item.incoming.gender,item.incoming.address,item.incoming.chatSession,item.incoming.chatSessionDate,item.incoming.interests,item.incoming.languagesSpoken,tagsToText",
    "'Gender','Address','Staged tags'": "'Gender','Address','Chat Session','Chat Session Date Conducted','Interests','Languages Spoken','Staged tags'",
    "'<br>Address: '+escapeHtml(p.address||'')+'<br>Tags": "'<br>Address: '+escapeHtml(p.address||'')+'<br>Chat Session: '+escapeHtml(p.chatSession||'')+'<br>Chat Session Date Conducted: '+escapeHtml(p.chatSessionDate||'')+'<br>Interests: '+escapeHtml(p.interests||'')+'<br>Languages Spoken: '+escapeHtml(p.languagesSpoken||'')+'<br>Tags",
    "address:row.address||'',emergencyName": "address:row.address||'',chatSession:row.chatSession||'',chatSessionDate:row.chatSessionDate||'',interests:row.interests||'',languagesSpoken:row.languagesSpoken||'',emergencyName",
    "Gender:v.gender,Address:v.address,Tags": "Gender:v.gender,Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags",
    "Address:v.address,Tags:tagsToText": "Address:v.address,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags:tagsToText",
    "Name:v.name,Gender:v.gender,Tags": "Name:v.name,Gender:v.gender,'Chat Session':v.chatSession,'Chat Session Date Conducted':v.chatSessionDate,Interests:v.interests,'Languages Spoken':v.languagesSpoken,Tags",
    "['Jane Tan','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','John Tan','8123 4567','M','Halal','Sample only']": "['Jane Tan','+65 9123 4567','jane@example.com','Female','Blk 123 Example Street #01-01','Intro Chat','2026-01-15','Tutoring, mentoring','English, Malay','John Tan','8123 4567','M','Halal','Sample only']",
    "v.name,v.phone,v.email,v.gender,v.address,v.notes,v.dietary,tags.join(' ')": "v.name,v.phone,v.email,v.gender,v.address,v.chatSession,v.chatSessionDate,v.interests,v.languagesSpoken,v.notes,v.dietary,tags.join(' ')"
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'Missing expected text: {old[:80]}')
    text = text.replace(old, new)

# Replace the renderDatabase function with a fuller table that includes the new fields.
start = text.index("function renderDatabase(){populateTagFilter();")
end = text.index("\n\n// Returns filtered and sorted volunteers.", start)
render_database = """function renderDatabase(){populateTagFilter();populateGenderFilter();populateShirtFilter();const rows=getFilteredVolunteers();let html='<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Gender</th><th>Address</th><th>Chat Session</th><th>Chat Date</th><th>Interests</th><th>Languages</th><th>Tags</th><th>T-Shirt</th><th>Dietary</th><th>Total Hours</th><th>Last Active</th></tr></thead><tbody>';rows.forEach(function(v){html+='<tr class="clickable" onclick="toggleProfile(\\''+v.id+'\\')"><td>'+escapeHtml(v.name)+'</td><td>'+escapeHtml(v.phone)+'</td><td>'+escapeHtml(v.email)+'</td><td>'+escapeHtml(v.gender)+'</td><td>'+escapeHtml(v.address)+'</td><td>'+escapeHtml(v.chatSession)+'</td><td>'+escapeHtml(v.chatSessionDate)+'</td><td>'+escapeHtml(v.interests)+'</td><td>'+escapeHtml(v.languagesSpoken)+'</td><td>'+renderTagPills(v.tags)+'</td><td>'+escapeHtml(v.shirtSize)+'</td><td>'+escapeHtml(v.dietary)+'</td><td>'+getTotalHours(v)+'</td><td>'+escapeHtml(getLastActive(v))+'</td></tr>';if(expandedVolunteerId===v.id)html+='<tr><td colspan="14" class="profile">'+renderFullProfile(v)+'</td></tr>';});html+='</tbody></table>';document.getElementById('databaseTable').innerHTML=rows.length?html:'<p class="muted">No volunteers match the current filters.</p>';}"""
text = text[:start] + render_database + text[end:]

index.write_text(text, encoding='utf-8')

r = readme.read_text(encoding='utf-8')
r = r.replace('5. Address\n6. Emergency Contact Name', '5. Address\n6. Chat Session\n7. Chat Session Date Conducted\n8. Interests\n9. Languages Spoken\n10. Emergency Contact Name')
r = r.replace('7. Emergency Contact Phone\n8. T-Shirt Size\n9. Dietary Requirements\n10. Notes', '11. Emergency Contact Phone\n12. T-Shirt Size\n13. Dietary Requirements\n14. Notes')
r = r.replace('- Gender\n- Address\n- Emergency Contact Name', '- Gender\n- Address\n- Chat Session\n- Chat Session Date Conducted\n- Interests\n- Languages Spoken\n- Emergency Contact Name')
r = r.replace('The table shows Name, Phone, Email, Gender, Address, Tags, T-Shirt, Dietary, Total Hours, and Last Active.', 'The table shows Name, Phone, Email, Gender, Address, Chat Session, Chat Session Date Conducted, Interests, Languages Spoken, Tags, T-Shirt, Dietary, Total Hours, and Last Active.')
r = r.replace('Tags, gender, and address are included in:', 'Tags, gender, address, chat session details, interests, and languages spoken are included in:')
r = r.replace('Gender and Address are included in the schema and roster import template:', 'Gender, Address, Chat Session, Chat Session Date Conducted, Interests, and Languages Spoken are included in the schema and roster import template:')
r = r.replace("{ key:'address', label:'Address', type:'textarea' }", "{ key:'address', label:'Address', type:'textarea' }\n{ key:'chatSession', label:'Chat Session', type:'text' }\n{ key:'chatSessionDate', label:'Chat Session Date Conducted', type:'date' }\n{ key:'interests', label:'Interests', type:'textarea' }\n{ key:'languagesSpoken', label:'Languages Spoken', type:'textarea' }")
insert = "\nData validation now checks Name, Phone or Email, email format, field length limits, tag limits, hours limits, and date-like values for Chat Session Date Conducted. Use YYYY-MM-DD for Chat Session Date Conducted.\n"
if insert.strip() not in r:
    r = r.replace('Rows are flagged as invalid when they do not have Name and at least one of Phone or Email. Invalid rows are previewed but not imported.\n', 'Rows are flagged as invalid when they do not have Name and at least one of Phone or Email. Invalid rows are previewed but not imported.\n' + insert)
readme.write_text(r, encoding='utf-8')
