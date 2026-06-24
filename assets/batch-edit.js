document.addEventListener('DOMContentLoaded',function(){
  const databaseView=document.getElementById('databaseView');
  if(!databaseView)return;

  const tableCard=document.getElementById('databaseTable').closest('.card');
  const card=document.createElement('div');
  card.className='card batch-edit-card collapsed';
  card.innerHTML=[
    '<button id="toggleDbBatchEdit" class="batch-edit-toggle" type="button" aria-expanded="false" aria-controls="batchDbBody">',
      '<span>Batch Edit Visible Volunteers</span>',
      '<span class="batch-edit-toggle-text">Open</span>',
    '</button>',
    '<div id="batchDbBody" class="batch-edit-body hidden">',
      '<p class="muted">Applies only to volunteers currently visible after search, filters, and sort. Preview before applying.</p>',
      '<div class="notice warn"><strong>Before batch editing:</strong> export a JSON backup if the current database contains real volunteer data.</div>',
      '<div class="grid">',
        '<div><label for="batchDbField">Field to edit</label><select id="batchDbField">',
          '<option value="tags">Tags</option>',
          '<option value="gender">Gender</option>',
          '<option value="chatSession">Chat Session</option>',
          '<option value="chatSessionDate">Chat Session Date Conducted</option>',
          '<option value="interests">Interests</option>',
          '<option value="languagesSpoken">Languages Spoken</option>',
          '<option value="shirtSize">T-Shirt Size</option>',
          '<option value="dietary">Dietary Requirements</option>',
          '<option value="notes">Notes</option>',
        '</select></div>',
        '<div><label for="batchDbAction">Action</label><select id="batchDbAction"></select></div>',
      '</div>',
      '<label for="batchDbValue">Value</label>',
      '<textarea id="batchDbValue" maxlength="2000" placeholder="Enter the value to apply"></textarea>',
      '<div class="row"><button id="previewDbBatchEdit" class="primary">Preview changes</button><button id="applyDbBatchEdit">Apply batch edit</button><button id="clearDbBatchEdit">Clear</button></div>',
      '<div id="batchDbStatus"></div>',
      '<div id="batchDbPreview" class="table-wrap hidden"></div>',
    '</div>'
  ].join('');
  databaseView.insertBefore(card,tableCard);

  const toggleEl=document.getElementById('toggleDbBatchEdit');
  const bodyEl=document.getElementById('batchDbBody');
  const toggleTextEl=toggleEl.querySelector('.batch-edit-toggle-text');
  const fieldEl=document.getElementById('batchDbField');
  const actionEl=document.getElementById('batchDbAction');
  const valueEl=document.getElementById('batchDbValue');
  const statusEl=document.getElementById('batchDbStatus');
  const previewEl=document.getElementById('batchDbPreview');

  const fieldLabels={tags:'Tags',gender:'Gender',chatSession:'Chat Session',chatSessionDate:'Chat Session Date Conducted',interests:'Interests',languagesSpoken:'Languages Spoken',shirtSize:'T-Shirt Size',dietary:'Dietary Requirements',notes:'Notes'};
  const longFields=['interests','languagesSpoken','dietary','notes'];

  function setBatchEditOpen(open){
    card.classList.toggle('collapsed',!open);
    bodyEl.classList.toggle('hidden',!open);
    toggleEl.setAttribute('aria-expanded',open?'true':'false');
    toggleTextEl.textContent=open?'Minimise':'Open';
  }

  function actionsForField(field){
    if(field==='tags')return[['add','Add tags'],['replace','Replace tags'],['clear','Clear tags']];
    if(longFields.indexOf(field)>-1)return[['replace','Replace value'],['append','Append value'],['clear','Clear value']];
    return[['replace','Replace value'],['clear','Clear value']];
  }

  function refreshActions(){
    const current=actionEl.value;
    const actions=actionsForField(fieldEl.value);
    actionEl.innerHTML=actions.map(function(a){return '<option value="'+a[0]+'">'+a[1]+'</option>';}).join('');
    if(actions.some(function(a){return a[0]===current;}))actionEl.value=current;
    valueEl.disabled=actionEl.value==='clear';
    valueEl.placeholder=fieldEl.value==='tags'?'Comma-separated tags, for example: youth, logistics':'Enter the value to apply';
  }

  function visibleVolunteers(){
    if(typeof getFilteredVolunteers!=='function')return[];
    return getFilteredVolunteers();
  }

  function normaliseBatchValue(field,action,value){
    if(action==='clear')return'';
    if(field==='tags'){
      const tags=parseTags(value);
      if(!tags.length)throw new Error('Enter at least one valid tag.');
      return tags;
    }
    if(field==='chatSessionDate'){
      const date=safeDate(value,field);
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Chat Session Date Conducted must use YYYY-MM-DD.');
      return date;
    }
    const cleaned=safeText(value,field);
    if(!cleaned)throw new Error('Enter a value, or choose Clear value.');
    return cleaned;
  }

  function computeNextValue(volunteer,field,action,value){
    if(field==='tags'){
      if(action==='clear')return[];
      if(action==='replace')return value;
      return mergeTags(volunteer.tags||[],value);
    }
    if(action==='clear')return'';
    if(action==='append'){
      const existing=safeText(volunteer[field]||'',field);
      return existing?safeText(existing+', '+value,field):value;
    }
    return value;
  }

  function renderStatus(type,message){
    statusEl.innerHTML='<div class="notice '+type+'">'+escapeHtml(message)+'</div>';
  }

  function buildPreview(){
    const rows=visibleVolunteers();
    const field=fieldEl.value;
    const action=actionEl.value;
    const value=normaliseBatchValue(field,action,valueEl.value);
    if(!rows.length)throw new Error('No visible volunteers match the current filters.');
    const preview=rows.map(function(v){
      const before=field==='tags'?tagsToText(v.tags):(v[field]||'');
      const next=computeNextValue(v,field,action,value);
      const after=field==='tags'?tagsToText(next):next;
      return{volunteer:v,before:before,after:after};
    });
    return{field:field,action:action,value:value,preview:preview};
  }

  function previewBatchEdit(){
    try{
      const plan=buildPreview();
      const rows=plan.preview.slice(0,50).map(function(p){return[p.volunteer.name,p.volunteer.phone,p.before,p.after];});
      previewEl.classList.remove('hidden');
      previewEl.innerHTML=makeTable(['Name','Phone','Current '+fieldLabels[plan.field],'New '+fieldLabels[plan.field]],rows);
      renderStatus('warn','Previewing '+plan.preview.length+' visible volunteer(s). Only the first 50 are shown.');
    }catch(error){
      previewEl.classList.add('hidden');
      previewEl.innerHTML='';
      renderStatus('bad',error.message);
    }
  }

  function applyBatchEdit(){
    let plan;
    try{plan=buildPreview();}catch(error){renderStatus('bad',error.message);return;}
    const actionLabel=actionEl.options[actionEl.selectedIndex].textContent;
    const message='Apply batch edit to '+plan.preview.length+' visible volunteer(s)?\n\nField: '+fieldLabels[plan.field]+'\nAction: '+actionLabel+'\n\nThis cannot be undone except by restoring a JSON backup.';
    if(!confirm(message))return;
    plan.preview.forEach(function(p){
      p.volunteer[plan.field]=computeNextValue(p.volunteer,plan.field,plan.action,plan.value);
    });
    saveData();
    renderAll();
    previewEl.classList.add('hidden');
    previewEl.innerHTML='';
    renderStatus('ok','Batch edit applied to '+plan.preview.length+' visible volunteer(s).');
  }

  function clearBatchEdit(){
    valueEl.value='';
    previewEl.classList.add('hidden');
    previewEl.innerHTML='';
    statusEl.innerHTML='';
  }

  toggleEl.addEventListener('click',function(){setBatchEditOpen(bodyEl.classList.contains('hidden'));});
  fieldEl.addEventListener('change',refreshActions);
  actionEl.addEventListener('change',refreshActions);
  document.getElementById('previewDbBatchEdit').addEventListener('click',previewBatchEdit);
  document.getElementById('applyDbBatchEdit').addEventListener('click',applyBatchEdit);
  document.getElementById('clearDbBatchEdit').addEventListener('click',clearBatchEdit);
  refreshActions();
  setBatchEditOpen(false);
});
