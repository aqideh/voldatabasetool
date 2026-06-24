const profileEditState={volunteerId:null,mode:'view',draft:null};

function resetProfileEditState(){
  profileEditState.volunteerId=null;
  profileEditState.mode='view';
  profileEditState.draft=null;
}

function toggleProfile(id){
  if(expandedVolunteerId===id){
    expandedVolunteerId=null;
    resetProfileEditState();
  }else{
    expandedVolunteerId=id;
    resetProfileEditState();
  }
  renderDatabase();
}

function getProfileFieldValue(volunteer,key){
  return key==='tags'?tagsToText(volunteer.tags):(volunteer[key]||'');
}

function makeProfileDraft(volunteer){
  const draft={};
  VOLUNTEER_SCHEMA.forEach(function(field){
    draft[field.key]=getProfileFieldValue(volunteer,field.key);
  });
  return draft;
}

function ensureProfileState(volunteer){
  if(profileEditState.volunteerId!==volunteer.id){
    profileEditState.volunteerId=volunteer.id;
    profileEditState.mode='view';
    profileEditState.draft=makeProfileDraft(volunteer);
  }
}

function startProfileEdit(id){
  const volunteer=getVolunteer(id);
  if(!volunteer)return;
  profileEditState.volunteerId=id;
  profileEditState.mode='edit';
  profileEditState.draft=makeProfileDraft(volunteer);
  renderDatabase();
}

function setProfileDraftValue(key,value){
  if(!profileEditState.draft)return;
  profileEditState.draft[key]=value;
}

function reviewProfileEdits(id){
  if(profileEditState.volunteerId!==id||!profileEditState.draft)return;
  profileEditState.mode='review';
  renderDatabase();
}

function backToProfileEdit(id){
  if(profileEditState.volunteerId!==id||!profileEditState.draft)return;
  profileEditState.mode='edit';
  renderDatabase();
}

function discardProfileEdits(){
  resetProfileEditState();
  renderDatabase();
}

function cleanProfileDraft(draft){
  const cleaned={};
  VOLUNTEER_SCHEMA.forEach(function(field){
    if(field.key==='tags')cleaned.tags=parseTags(draft.tags||'');
    else if(field.key==='chatSessionDate')cleaned.chatSessionDate=safeDate(draft.chatSessionDate,field.key);
    else cleaned[field.key]=safeText(draft[field.key],field.key);
  });
  return cleaned;
}

function validateProfileDraft(cleaned){
  const issues=[];
  if(cleanText(cleaned.name)==='')issues.push('Name is required.');
  if(cleanText(cleaned.phone)===''&&cleanText(cleaned.email)==='')issues.push('Phone or Email is required.');
  if(cleaned.email&&!isValidEmail(cleaned.email))issues.push('Email format is invalid.');
  if(cleaned.chatSessionDate&&!/^\d{4}-\d{2}-\d{2}$/.test(cleaned.chatSessionDate))issues.push('Chat Session Date Conducted must use YYYY-MM-DD.');
  return issues;
}

function getProfileChanges(volunteer,cleaned){
  const changes=[];
  VOLUNTEER_SCHEMA.forEach(function(field){
    const before=field.key==='tags'?tagsToText(volunteer.tags):safeText(volunteer[field.key],field.key);
    const after=field.key==='tags'?tagsToText(cleaned.tags):cleaned[field.key];
    if(before!==after)changes.push({key:field.key,label:field.label,before:before,after:after});
  });
  return changes;
}

function confirmProfileEdits(id){
  const volunteer=getVolunteer(id);
  if(!volunteer||profileEditState.volunteerId!==id||!profileEditState.draft)return;
  const cleaned=cleanProfileDraft(profileEditState.draft);
  const issues=validateProfileDraft(cleaned);
  if(issues.length){
    alert('Cannot confirm edits:\n\n'+issues.join('\n'));
    return;
  }
  VOLUNTEER_SCHEMA.forEach(function(field){
    if(field.key==='tags')volunteer.tags=cleaned.tags;
    else volunteer[field.key]=cleaned[field.key];
  });
  saveData();
  resetProfileEditState();
  renderDatabase();
}

function renderReadonlyProfile(volunteer){
  let html='<div class="profile-actions"><button class="danger" onclick="startProfileEdit(\''+volunteer.id+'\')">Edit profile</button></div>';
  html+='<div class="profile-readonly-grid">';
  VOLUNTEER_SCHEMA.forEach(function(field){
    const raw=getProfileFieldValue(volunteer,field.key);
    html+='<div class="profile-readonly-field"><strong>'+escapeHtml(field.label)+'</strong><span>'+(raw?escapeHtml(raw):'<span class="muted">Blank</span>')+'</span></div>';
  });
  html+='</div>';
  return html;
}

function renderProfileEditForm(volunteer){
  const draft=profileEditState.draft||makeProfileDraft(volunteer);
  let html='<div class="profile-actions"><button class="primary" onclick="reviewProfileEdits(\''+volunteer.id+'\')">Review changes</button><button class="danger" onclick="discardProfileEdits()">Discard edits</button></div>';
  html+='<p class="muted">Changes are not saved until you review and confirm them.</p><div class="grid">';
  VOLUNTEER_SCHEMA.forEach(function(field){
    const value=escapeHtml(draft[field.key]||'');
    if(field.type==='textarea'){
      html+='<div><label>'+escapeHtml(field.label)+'</label><textarea maxlength="'+MAX_LONG_FIELD_LENGTH+'" oninput="setProfileDraftValue(\''+field.key+'\', this.value)">'+value+'</textarea></div>';
    }else{
      html+='<div><label>'+escapeHtml(field.label)+'</label><input type="text" maxlength="'+(field.key==='tags'?500:MAX_FIELD_LENGTH)+'" value="'+value+'" oninput="setProfileDraftValue(\''+field.key+'\', this.value)">';
      if(field.key==='tags')html+='<p class="muted">Use comma-separated tags, for example: youth, logistics, befriender</p>';
      html+='</div>';
    }
  });
  html+='</div>';
  return html;
}

function renderProfileReview(volunteer){
  const cleaned=cleanProfileDraft(profileEditState.draft||makeProfileDraft(volunteer));
  const issues=validateProfileDraft(cleaned);
  const changes=getProfileChanges(volunteer,cleaned);
  let html='<div class="profile-actions"><button class="primary" onclick="confirmProfileEdits(\''+volunteer.id+'\')" '+(issues.length?'disabled':'')+'>Confirm edits</button><button onclick="backToProfileEdit(\''+volunteer.id+'\')">Back</button><button class="danger" onclick="discardProfileEdits()">Discard edits</button></div>';
  if(issues.length){
    html+='<div class="notice bad"><strong>Fix before confirming:</strong><br>'+issues.map(escapeHtml).join('<br>')+'</div>';
  }
  if(!changes.length){
    html+='<div class="notice warn">No changed fields detected.</div>';
    return html;
  }
  const rows=changes.map(function(change){return[change.label,change.before||'(blank)',change.after||'(blank)'];});
  html+='<div class="table-wrap profile-review-table">'+makeTable(['Field','Current value','New value'],rows)+'</div>';
  return html;
}

function renderFullProfile(volunteer){
  ensureProfileState(volunteer);
  let html='<h3>Full profile</h3>';
  if(profileEditState.mode==='edit')html+=renderProfileEditForm(volunteer);
  else if(profileEditState.mode==='review')html+=renderProfileReview(volunteer);
  else html+=renderReadonlyProfile(volunteer);
  html+='<h3>Attendance log</h3>'+renderAttendanceEditor(volunteer);
  return html;
}
