(function installEventReportCsvImport(){
  'use strict';

  const S=window.MaklomSharedDB;
  const Core=window.MaklomEventReportImportCore;
  if(!S||!Core)return;

  let currentAnalysis=null;
  let currentFileName='';

  function esc(value){return typeof escapeHtml==='function'?escapeHtml(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});}
  function clean(value){return Core.clean(value);}
  function lower(value){return Core.lower(value);}
  function phone(value){return Core.phone(value);}
  function canWrite(){const a=S.getAccessState&&S.getAccessState();return !!(a&&a.canWrite);}
  function id(prefix,key){return prefix+'_'+Core.hashString(key);}

  function parseCsv(text){
    const rows=[];let row=[],field='',quoted=false;
    const input=String(text==null?'':text).replace(/^\uFEFF/,'');
    for(let i=0;i<input.length;i++){
      const ch=input[i];
      if(quoted){
        if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
        else if(ch==='"')quoted=false;
        else field+=ch;
      }else{
        if(ch==='"')quoted=true;
        else if(ch===','){row.push(field);field='';}
        else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
        else if(ch!=='\r')field+=ch;
      }
    }
    if(field!==''||row.length){row.push(field);rows.push(row);}
    while(rows.length&&rows[rows.length-1].every(function(v){return !clean(v);})){rows.pop();}
    if(!rows.length)return{headers:[],rows:[]};
    const headers=rows[0].map(clean);
    return{
      headers:headers,
      rows:rows.slice(1).map(function(values){
        const out={};headers.forEach(function(h,index){out[h]=values[index]==null?'':values[index];});return out;
      })
    };
  }

  async function fetchRows(table,select,filter,order){
    let path='/rest/v1/'+table+'?select='+encodeURIComponent(select||'*');
    if(filter)path+='&'+filter;
    if(order)path+='&order='+encodeURIComponent(order);
    const response=await S.apiFetch(path,{method:'GET'});
    if(!response.ok)throw new Error('Could not load '+table+': '+await response.text());
    return response.json();
  }
  async function insertRows(table,rows){
    if(!rows.length)return[];
    const response=await S.apiFetch('/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(rows)});
    if(!response.ok)throw new Error('Could not insert '+table+': '+await response.text());
    return response.json();
  }
  async function updateRow(table,idValue,row,version){
    const response=await S.apiFetch('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(idValue)+'&row_version=eq.'+encodeURIComponent(version),{
      method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)
    });
    if(!response.ok)throw new Error('Could not update '+table+': '+await response.text());
    const rows=await response.json();
    if(!rows.length)throw new Error('A '+table+' row changed in another browser. Reload and import again.');
    return rows[0];
  }

  function findToolbar(){
    const head=document.querySelector('#eventManagerContent .event-manager-head');
    return head;
  }
  function ensureImportButton(){
    const head=findToolbar();
    if(!head||document.getElementById('openEventReportImport'))return;
    const actions=head.lastElementChild&&head.lastElementChild.tagName==='BUTTON'?head:null;
    const button=document.createElement('button');
    button.id='openEventReportImport';button.type='button';button.textContent='Import event report CSV';
    if(!canWrite())button.disabled=true;
    if(actions)head.appendChild(button);
    else head.appendChild(button);
    button.addEventListener('click',openImporter);
  }
  function renderIntoCreatePanel(html){
    const panel=document.getElementById('eventCreatePanel');
    if(!panel)return null;
    panel.innerHTML=html;
    return panel;
  }
  function openImporter(){
    if(!canWrite())return;
    currentAnalysis=null;currentFileName='';
    const panel=renderIntoCreatePanel([
      '<div class="card event-report-import-card">',
      '<div class="event-manager-head"><div><h3>Import event report CSV</h3><p class="muted">Upload an event report export. MakLom will preview the event, shifts and attendance rows before saving anything.</p></div><button id="closeEventReportImport" type="button" class="small">Close</button></div>',
      '<label for="eventReportCsvFile">CSV report</label>',
      '<input id="eventReportCsvFile" type="file" accept=".csv,text/csv">',
      '<div id="eventReportImportStatus" class="event-report-import-status"></div>',
      '<div id="eventReportImportPreview"></div>',
      '</div>'
    ].join(''));
    if(!panel)return;
    document.getElementById('closeEventReportImport').addEventListener('click',function(){panel.innerHTML='';});
    document.getElementById('eventReportCsvFile').addEventListener('change',handleFile);
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function warningLabels(w){
    const out=[];
    if(w.checkoutAfterShiftEnd)out.push(w.checkoutAfterShiftEnd+' checkout timestamp'+(w.checkoutAfterShiftEnd===1?'':'s')+' after shift end');
    if(w.checkinBeforeShiftStart)out.push(w.checkinBeforeShiftStart+' check-in'+(w.checkinBeforeShiftStart===1?'':'s')+' before shift start');
    if(w.checkedInWithoutCheckout)out.push(w.checkedInWithoutCheckout+' checked-in row'+(w.checkedInWithoutCheckout===1?'':'s')+' without checkout');
    if(w.invalidShiftTimestamps)out.push(w.invalidShiftTimestamps+' row'+(w.invalidShiftTimestamps===1?'':'s')+' with invalid shift timestamps');
    if(w.missingIdentity)out.push(w.missingIdentity+' row'+(w.missingIdentity===1?'':'s')+' without a usable volunteer identity');
    return out;
  }

  function renderPreview(analysis){
    const target=document.getElementById('eventReportImportPreview');if(!target)return;
    if(!analysis.ok){
      target.innerHTML='<div class="notice bad">This does not match the expected event-report format. Missing columns: '+esc(analysis.missingHeaders.join(', '))+'</div>';
      return;
    }
    const s=analysis.summary,warnings=warningLabels(s.warnings);
    const status=Object.keys(s.statusCounts).sort().map(function(k){return'<span class="pill neutral">'+esc(k)+': '+s.statusCounts[k]+'</span>';}).join(' ');
    target.innerHTML=[
      '<div class="event-report-summary">',
        '<div><span>Event'+(s.events===1?'':'s')+'</span><strong>'+s.events+'</strong></div>',
        '<div><span>Shifts</span><strong>'+s.shifts+'</strong></div>',
        '<div><span>Volunteer-shift rows</span><strong>'+s.rows+'</strong></div>',
        '<div><span>Calculated hours</span><strong>'+Math.round((s.creditedMinutes/60)*10)/10+'</strong></div>',
      '</div>',
      '<div class="event-report-statuses">'+status+'</div>',
      warnings.length?'<div class="notice warn"><strong>Review notes:</strong> '+esc(warnings.join('; '))+'. Credited time will be capped to shift windows, and overlapping continuous attendance will be allocated without double-counting.</div>':'',
      analysis.events.map(function(e){
        return'<div class="event-report-event-preview"><strong>'+esc(e.title)+'</strong><div class="muted">'+esc(e.start_date)+(e.end_date!==e.start_date?' to '+esc(e.end_date):'')+(e.venue?' · '+esc(e.venue):'')+'</div><div>'+e.shiftList.map(function(sh){return'<span class="pill neutral">'+esc(sh.name)+' · '+esc(sh.date)+(sh.start_time?' '+esc(sh.start_time):'')+(sh.end_time?'–'+esc(sh.end_time):'')+'</span>';}).join(' ')+'</div></div>';
      }).join(''),
      '<div class="row event-report-import-actions"><button id="commitEventReportImport" type="button" class="primary">Import to MakLom</button><span class="muted">Existing matching events, shifts and attendance are reused rather than duplicated.</span></div>'
    ].join('');
    document.getElementById('commitEventReportImport').addEventListener('click',commitImport);
  }

  async function handleFile(event){
    const file=event.target.files&&event.target.files[0];
    if(!file)return;
    currentFileName=file.name;
    const status=document.getElementById('eventReportImportStatus');
    if(status)status.innerHTML='<div class="notice">Reading '+esc(file.name)+'…</div>';
    try{
      const parsed=parseCsv(await file.text());
      currentAnalysis=Core.analyse(parsed.rows,parsed.headers);
      if(status)status.innerHTML='';
      renderPreview(currentAnalysis);
    }catch(error){
      currentAnalysis=null;
      if(status)status.innerHTML='<div class="notice bad">Could not read this CSV: '+esc(error.message)+'</div>';
    }
  }

  function exactEventMatch(events,event){
    const same=events.filter(function(e){
      return lower(e.name)===lower(event.title)&&clean(e.start_date)===event.start_date&&clean(e.end_date)===event.end_date;
    });
    if(!event.venue)return same[0]||null;
    return same.find(function(e){return lower(e.venue)===lower(event.venue);})||null;
  }
  function exactShiftMatch(shifts,eventId,shift){
    return shifts.find(function(s){
      return s.event_id===eventId&&clean(s.shift_date)===shift.date&&lower(s.name)===lower(shift.name);
    })||null;
  }
  function volunteerIdentityKey(row){
    const email=lower(row.email);
    if(email)return'email:'+email;
    const p=phone(row.contact_number);
    if(p)return'phone:'+p;
    const name=lower(row.volunteer_name);
    return name?'name:'+name:'';
  }
  function uniqueVolunteerMatch(matches,label){
    if(matches.length>1)throw new Error('Multiple volunteer profiles match '+label+'. Resolve the duplicate profiles before importing this row.');
    return matches[0]||null;
  }
  function volunteerMatch(volunteers,row){
    const sourceId=clean(row.volunteer_id);
    if(sourceId){
      const byId=volunteers.find(function(v){return v.id===sourceId;});
      if(byId)return byId;
    }
    const email=lower(row.email);
    if(email){
      const match=uniqueVolunteerMatch(volunteers.filter(function(v){return lower(v.email)===email;}),'email '+email);
      if(match)return match;
    }
    const p=phone(row.contact_number);
    if(p){
      const match=uniqueVolunteerMatch(volunteers.filter(function(v){return phone(v.phone)===p;}),'phone '+p);
      if(match)return match;
    }
    if(!email&&!p){
      const name=lower(row.volunteer_name);
      if(name){
        const match=uniqueVolunteerMatch(volunteers.filter(function(v){return lower(v.name)===name;}),'name '+clean(row.volunteer_name));
        if(match)return match;
      }
    }
    return null;
  }
  async function createVolunteerIdentity(volunteers,row){
    const key=volunteerIdentityKey(row);
    if(!key)throw new Error('CSV row '+row._rowNumber+' has no usable volunteer identity.');
    const volunteerId=id('vol_event_report',key);
    const existingById=volunteers.find(function(v){return v.id===volunteerId;});
    if(existingById)return existingById;
    const created=await insertRows('volunteers',[{
      id:volunteerId,
      name:clean(row.volunteer_name)||'Unknown volunteer',
      email:clean(row.email)||null,
      phone:clean(row.contact_number)||null,
      notes:'Created from attendance event log import. Update volunteer profile.'
    }]);
    volunteers.push(created[0]);
    return created[0];
  }
  function attendanceIdentity(row){
    return lower(row.email)||phone(row.contact)||lower(row.name);
  }

  async function preflight(){
    const result=await Promise.all([
      fetchRows('events','*','','start_date.asc'),
      fetchRows('event_shifts','*','','shift_date.asc'),
      fetchRows('volunteers','id,name,email,phone','','name.asc'),
      fetchRows('attendance_log','id,volunteer_id,name,email,contact,event_id,shift_id,row_version','','event_date.asc')
    ]);
    return{events:result[0],shifts:result[1],volunteers:result[2],attendance:result[3]};
  }

  async function commitImport(){
    if(!currentAnalysis||!currentAnalysis.ok||!canWrite())return;
    const button=document.getElementById('commitEventReportImport');
    const status=document.getElementById('eventReportImportStatus');
    if(button){button.disabled=true;button.textContent='Importing…';}
    if(status)status.innerHTML='<div class="notice">Checking existing MakLom records…</div>';

    try{
      const db=await preflight(),eventMap={},shiftMap={};
      const counts={eventsCreated:0,eventsReused:0,shiftsCreated:0,shiftsReused:0,attendanceCreated:0,attendanceUpdated:0,attendanceSkipped:0,volunteerRowsMatched:0,volunteersCreated:0};

      for(const incomingEvent of currentAnalysis.events){
        let event=exactEventMatch(db.events,incomingEvent);
        if(!event){
          const eventId=id('event_report_event',incomingEvent.key+'|'+incomingEvent.start_date+'|'+incomingEvent.end_date);
          const created=await insertRows('events',[{
            id:eventId,name:incomingEvent.title,start_date:incomingEvent.start_date,end_date:incomingEvent.end_date,
            programme:null,venue:incomingEvent.venue||null,
            notes:'Created from event report CSV'+(currentFileName?' ('+currentFileName+')':'')+'.',
            status:'active'
          }]);
          event=created[0];db.events.push(event);counts.eventsCreated++;
        }else counts.eventsReused++;
        eventMap[incomingEvent.key]=event;

        for(const incomingShift of incomingEvent.shiftList){
          let shift=exactShiftMatch(db.shifts,event.id,incomingShift);
          if(!shift){
            const shiftId=id('event_report_shift',event.id+'|'+incomingShift.key);
            const created=await insertRows('event_shifts',[{
              id:shiftId,event_id:event.id,name:incomingShift.name,shift_date:incomingShift.date,
              start_time:incomingShift.start_time||null,end_time:incomingShift.end_time||null,
              notes:'Created from event report CSV.'
            }]);
            shift=created[0];db.shifts.push(shift);counts.shiftsCreated++;
          }else counts.shiftsReused++;
          shiftMap[incomingEvent.key+'|'+incomingShift.key]=shift;
        }
      }

      const importerIds=new Set(db.attendance.filter(function(a){return String(a.id||'').indexOf('event_report_att_')===0;}).map(function(a){return a.id;}));
      for(const row of currentAnalysis.rows){
        const event=eventMap[row._eventKey],shift=shiftMap[row._eventKey+'|'+row._shiftKey];
        if(!event||!shift)throw new Error('Could not resolve event/shift for CSV row '+row._rowNumber+'.');
        let volunteer=volunteerMatch(db.volunteers,row);
        if(volunteer)counts.volunteerRowsMatched++;
        else{
          volunteer=await createVolunteerIdentity(db.volunteers,row);
          counts.volunteersCreated++;
        }

        const sameIdentity=db.attendance.find(function(existing){
          if(existing.event_id!==event.id||existing.shift_id!==shift.id)return false;
          if(existing.id===row._attendanceId)return false;
          const incomingIdentity=lower(row.email)||phone(row.contact_number)||lower(row.volunteer_name);
          return incomingIdentity&&attendanceIdentity(existing)===incomingIdentity;
        });
        if(sameIdentity){
          counts.attendanceSkipped++;
          continue;
        }

        const allocation=row._allocation;
        const statusText=lower(row.attendance_status)||'blank';
        const sourceNote=[
          allocation.note,
          'Source status: '+statusText+'.',
          row.roster_source?'Roster source: '+clean(row.roster_source)+'.':'',
          row.continuous_attendance_type?'Continuous attendance: '+clean(row.continuous_attendance_type)+'.':'',
          'Imported from event report CSV'+(currentFileName?' '+currentFileName:'')+'.'
        ].filter(Boolean).join(' ');

        const payload={
          volunteer_id:volunteer.id,
          name:clean(row.volunteer_name)||'Unknown volunteer',
          email:clean(row.email)||null,
          contact:clean(row.contact_number)||null,
          attended:!!allocation.attended,
          event_name:event.name,
          event_date:shift.shift_date,
          duration_minutes:Number(allocation.duration_minutes)||0,
          sign_in_at:allocation.sign_in_at||null,
          sign_out_at:allocation.sign_out_at||null,
          calculated_duration_minutes:allocation.calculated_duration_minutes==null?null:Number(allocation.calculated_duration_minutes),
          staff_credited_duration_minutes:null,
          staff_credit_note:sourceNote,
          event_id:event.id,
          shift_id:shift.id,
          shift_label:shift.name
        };

        const existing=db.attendance.find(function(a){return a.id===row._attendanceId;});
        if(existing&&importerIds.has(existing.id)){
          const updated=await updateRow('attendance_log',existing.id,payload,existing.row_version);
          Object.assign(existing,updated);counts.attendanceUpdated++;
        }else if(existing){
          counts.attendanceSkipped++;
        }else{
          const created=await insertRows('attendance_log',[Object.assign({id:row._attendanceId},payload)]);
          db.attendance.push(created[0]);importerIds.add(row._attendanceId);counts.attendanceCreated++;
        }
      }

      if(S.refreshFromRemote)await S.refreshFromRemote(true,true);
      const eventsButton=document.querySelector('nav button[data-view="eventsView"]');
      if(eventsButton)eventsButton.click();
      if(status)status.innerHTML='';
      alert('Event report imported. '+counts.eventsCreated+' event(s) created, '+counts.shiftsCreated+' shift(s) created, '+counts.attendanceCreated+' attendance row(s) added, '+counts.attendanceUpdated+' importer row(s) refreshed, '+counts.attendanceSkipped+' existing attendance row(s) left untouched. '+counts.volunteersCreated+' new volunteer profile(s) created; '+counts.volunteerRowsMatched+' row(s) matched to existing or newly created profiles.');
    }catch(error){
      console.error(error);
      if(status)status.innerHTML='<div class="notice bad">Import failed: '+esc(error.message)+'</div>';
      if(button){button.disabled=false;button.textContent='Import to MakLom';}
    }
  }

  function observe(){
    ensureImportButton();
    const target=document.getElementById('eventManagerContent');
    if(target&&!target.dataset.eventReportImportObserver){
      target.dataset.eventReportImportObserver='true';
      new MutationObserver(function(){ensureImportButton();}).observe(target,{childList:true,subtree:true});
    }
  }

  document.addEventListener('DOMContentLoaded',function(){setTimeout(observe,200);});
  window.addEventListener('maklom:access-state',function(){setTimeout(observe,50);});
  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('nav button[data-view="eventsView"]');
    if(button)setTimeout(observe,50);
  });
  setTimeout(observe,700);
})();