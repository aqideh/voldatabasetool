(function installShiftTimeEditor(){
  'use strict';

  const S=window.MaklomSharedDB;
  if(!S)return;

  let activePanel=null;

  function clean(value){return String(value==null?'':value).trim();}
  function esc(value){
    if(typeof escapeHtml==='function')return escapeHtml(clean(value));
    return clean(value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});
  }
  function timeValue(value){return clean(value).slice(0,5);}

  async function fetchShift(shiftId){
    const response=await S.apiFetch('/rest/v1/event_shifts?select=*&id=eq.'+encodeURIComponent(shiftId),{method:'GET'});
    if(!response.ok)throw new Error(await response.text());
    const rows=await response.json();
    if(!rows.length)throw new Error('Shift could not be found.');
    return rows[0];
  }

  function closeEditor(){
    if(activePanel&&activePanel.isConnected)activePanel.remove();
    activePanel=null;
  }

  function normalizeTime(input,label){
    const helper=window.MaklomTime24h&&window.MaklomTime24h.normalize;
    const raw=clean(input.value);
    const normalized=helper?helper(raw):(raw||'');
    if(normalized===null){
      input.setAttribute('aria-invalid','true');
      input.focus();
      alert(label+' must use 24-hour HH:mm format, for example 09:00 or 14:30.');
      return null;
    }
    input.removeAttribute('aria-invalid');
    input.value=normalized;
    return normalized;
  }

  async function refreshEvents(){
    if(S.refreshFromRemote){
      try{await S.refreshFromRemote(true,true);}catch(error){console.warn(error);}
    }
    const eventsButton=document.querySelector('nav button[data-view="eventsView"]');
    if(eventsButton)eventsButton.click();
  }

  async function saveShift(shift,panel){
    const nameInput=panel.querySelector('[data-shift-edit-name]');
    const dateInput=panel.querySelector('[data-shift-edit-date]');
    const startInput=panel.querySelector('[data-shift-edit-start]');
    const endInput=panel.querySelector('[data-shift-edit-end]');
    const saveButton=panel.querySelector('[data-save-shift-time]');

    const name=clean(nameInput.value);
    const date=clean(dateInput.value).slice(0,10);
    if(!name||!date){
      alert('Shift name and date are required.');
      return;
    }

    const start=normalizeTime(startInput,'Start time');
    if(start===null)return;
    const end=normalizeTime(endInput,'End time');
    if(end===null)return;

    saveButton.disabled=true;
    saveButton.textContent='Saving…';

    try{
      const response=await S.apiFetch('/rest/v1/event_shifts?id=eq.'+encodeURIComponent(shift.id)+'&row_version=eq.'+encodeURIComponent(shift.row_version),{
        method:'PATCH',
        headers:{'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({
          name:name,
          shift_date:date,
          start_time:start||null,
          end_time:end||null
        })
      });
      if(!response.ok)throw new Error(await response.text());
      const updated=await response.json();
      if(!updated.length)throw new Error('This shift was changed in another browser. Reload the event and try again.');
      closeEditor();
      await refreshEvents();
    }catch(error){
      console.error(error);
      alert('Could not save shift: '+error.message);
      saveButton.disabled=false;
      saveButton.textContent='Save shift';
    }
  }

  async function openEditor(button,shiftId){
    closeEditor();
    const row=button.closest('.event-shift-row');
    if(!row)return;

    const originalLabel=button.textContent;
    button.disabled=true;
    button.textContent='Loading…';

    try{
      const shift=await fetchShift(shiftId);
      const panel=document.createElement('div');
      panel.className='notice';
      panel.dataset.shiftTimeEditor=shift.id;
      panel.innerHTML='<div class="grid">'+
        '<label>Shift name<input data-shift-edit-name maxlength="120" value="'+esc(shift.name)+'"></label>'+
        '<label>Date<input data-shift-edit-date type="date" value="'+esc(clean(shift.shift_date).slice(0,10))+'"></label>'+
        '<label>Start time<input data-shift-edit-start type="time" value="'+esc(timeValue(shift.start_time))+'"></label>'+
        '<label>End time<input data-shift-edit-end type="time" value="'+esc(timeValue(shift.end_time))+'"></label>'+
        '</div><div class="row"><button type="button" class="primary" data-save-shift-time>Save shift</button><button type="button" class="small" data-cancel-shift-time>Cancel</button></div>';

      row.insertAdjacentElement('afterend',panel);
      activePanel=panel;

      if(window.MaklomTime24h&&window.MaklomTime24h.refresh)window.MaklomTime24h.refresh();

      panel.querySelector('[data-cancel-shift-time]').addEventListener('click',closeEditor);
      panel.querySelector('[data-save-shift-time]').addEventListener('click',function(){saveShift(shift,panel);});
      panel.querySelector('[data-shift-edit-name]').focus();
    }catch(error){
      console.error(error);
      alert('Could not load shift: '+error.message);
    }finally{
      button.disabled=false;
      button.textContent=originalLabel;
    }
  }

  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('[data-edit-shift]');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openEditor(button,button.dataset.editShift);
  },true);
})();
