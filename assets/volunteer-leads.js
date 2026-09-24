(function installVolunteerLeads(){
  'use strict';

  const S=window.MaklomSharedDB;
  if(!S)return;

  const FORM_ID='6ab08df24e9cff0f3ac1af45';
  const state={rows:[],loaded:false,loading:false,selectedId:'',search:'',status:''};
  const statusLabels={
    new:'New',
    reviewing:'Reviewing',
    contacted:'Contacted',
    accepted:'Accepted',
    converted:'Converted',
    not_selected:'Not selected',
    withdrawn:'Withdrawn'
  };
  const editableStatuses=['new','reviewing','contacted','accepted','not_selected','withdrawn'];

  function esc(value){
    return typeof escapeHtml==='function'
      ? escapeHtml(String(value==null?'':value))
      : String(value==null?'':value).replace(/[&<>"]/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch];});
  }

  function text(value){return String(value==null?'':value).trim();}
  function canWrite(){const access=S.getAccessState&&S.getAccessState();return !!(access&&access.canWrite);}
  function canDelete(){const access=S.getAccessState&&S.getAccessState();return !!(access&&access.canDelete);}
  function label(status){return statusLabels[status]||status||'Unknown';}
  function formatDate(value){
    if(!value)return'—';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return esc(value);
    return date.toLocaleString('en-SG',{dateStyle:'medium',timeStyle:'short'});
  }

  async function fetchLeads(){
    if(state.loading)return;
    const access=S.getAccessState&&S.getAccessState();
    if(!access||!access.ready){render();return;}
    state.loading=true;
    setStatus('Loading volunteer leads…','neutral');
    try{
      const select=[
        'id','source','source_form_id','source_submission_id','submitted_at','status',
        'full_name','email','phone','interest_area','motivation','skills_experience',
        'availability_notes','referral_source','staff_notes','converted_volunteer_id',
        'converted_at','created_at','updated_at','row_version'
      ].join(',');
      const response=await S.apiFetch(
        '/rest/v1/volunteer_leads?select='+encodeURIComponent(select)+'&order=submitted_at.desc.nullslast,created_at.desc',
        {method:'GET',headers:{Range:'0-1999'}}
      );
      if(!response.ok)throw new Error('Could not load volunteer leads: '+await response.text());
      state.rows=await response.json();
      state.loaded=true;
      if(state.selectedId&&!state.rows.some(function(row){return row.id===state.selectedId;}))state.selectedId='';
      updateLeadCount();
      render();
      setStatus('','');
    }catch(error){
      console.error(error);
      setStatus(error.message||'Could not load volunteer leads.','bad');
    }finally{
      state.loading=false;
    }
  }

  function filteredRows(){
    const query=state.search.toLowerCase();
    return state.rows.filter(function(row){
      if(state.status&&row.status!==state.status)return false;
      if(!query)return true;
      return[
        row.full_name,row.email,row.phone,row.interest_area,row.referral_source,row.staff_notes,
        row.source_submission_id,label(row.status)
      ].some(function(value){return text(value).toLowerCase().includes(query);});
    });
  }

  function updateLeadCount(){
    const count=document.getElementById('leadCount');
    if(count)count.textContent=String(state.rows.filter(function(row){return row.status!=='converted'&&row.status!=='not_selected'&&row.status!=='withdrawn';}).length);
  }

  function setStatus(message,kind){
    const target=document.getElementById('leadStatus');
    if(!target)return;
    if(!message){target.className='hidden';target.textContent='';return;}
    target.className='notice '+(kind==='bad'?'bad':kind==='ok'?'ok':'');
    target.textContent=message;
  }

  function statusPill(status){
    const kind=status==='converted'?'ok':status==='accepted'?'ok':status==='not_selected'||status==='withdrawn'?'bad':status==='contacted'?'warn':'neutral';
    return'<span class="pill '+kind+'">'+esc(label(status))+'</span>';
  }

  function render(){
    const content=document.getElementById('leadContent');
    if(!content)return;
    const access=S.getAccessState&&S.getAccessState();
    if(!access||!access.ready){
      content.innerHTML='<div class="card"><h2>Volunteer Leads</h2><p class="muted">Sign in to MakLom to view prospective volunteers from FormSG.</p></div>';
      return;
    }

    const rows=filteredRows();
    const selected=state.rows.find(function(row){return row.id===state.selectedId;})||null;

    content.innerHTML=[
      '<div class="card lead-toolbar">',
        '<div class="lead-page-head"><div><h2>Volunteer Leads</h2><p class="muted">Prospective volunteers received from FormSG. Leads remain separate from the Central Database until staff explicitly convert them.</p></div>',
        '<div class="lead-actions"><button id="refreshLeads" type="button">Refresh</button>',
        canWrite()?'<label class="lead-import-button">Import FormSG CSV<input id="leadCsvInput" type="file" accept=".csv,text/csv"></label>':'',
        '</div></div>',
        '<div class="lead-filters">',
          '<div><label for="leadSearch">Search</label><input id="leadSearch" type="search" placeholder="Name, email, phone, interest or notes" value="'+esc(state.search)+'"></div>',
          '<div><label for="leadStatusFilter">Status</label><select id="leadStatusFilter"><option value="">All statuses</option>',
            Object.keys(statusLabels).map(function(value){return'<option value="'+esc(value)+'" '+(state.status===value?'selected':'')+'>'+esc(statusLabels[value])+'</option>';}).join(''),
          '</select></div>',
        '</div>',
        '<p class="muted lead-result-count">'+rows.length+' of '+state.rows.length+' leads shown</p>',
      '</div>',
      renderTable(rows),
      selected?renderDetail(selected):''
    ].join('');

    wireRenderedControls();
  }

  function renderTable(rows){
    if(!state.loaded&&state.loading)return'<div class="card"><p class="muted">Loading…</p></div>';
    if(!rows.length)return'<div class="card"><p class="muted">No volunteer leads match the current filters.</p></div>';

    return'<div class="card"><div class="table-wrap"><table class="lead-table"><thead><tr><th>Lead</th><th>Contact</th><th>Interest</th><th>Status</th><th>Submitted</th><th>Volunteer</th><th></th></tr></thead><tbody>'+
      rows.map(function(row){
        return'<tr>'+
          '<td><strong>'+esc(row.full_name)+'</strong><div class="muted lead-source">'+esc(row.source==='formsg'?'FormSG':'Manual')+(row.source_submission_id?' · '+esc(row.source_submission_id):'')+'</div></td>'+
          '<td>'+esc(row.email||'—')+'<div class="muted">'+esc(row.phone||'—')+'</div></td>'+
          '<td>'+esc(row.interest_area||'—')+'</td>'+
          '<td>'+statusPill(row.status)+'</td>'+
          '<td>'+formatDate(row.submitted_at||row.created_at)+'</td>'+
          '<td>'+esc(row.converted_volunteer_id||'—')+'</td>'+
          '<td><button type="button" class="small" data-open-lead="'+esc(row.id)+'">Open</button></td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div></div>';
  }

  function detailValue(labelText,value){
    return'<div class="lead-detail-item"><span>'+esc(labelText)+'</span><div>'+esc(value||'—')+'</div></div>';
  }

  function renderDetail(row){
    const locked=row.status==='converted';
    const statusOptions=editableStatuses.map(function(value){
      return'<option value="'+value+'" '+(row.status===value?'selected':'')+'>'+esc(label(value))+'</option>';
    }).join('');

    return'<div class="card lead-detail-card" id="leadDetailCard">'+
      '<div class="lead-page-head"><div><h3>'+esc(row.full_name)+'</h3><p class="muted">'+esc(row.id)+' · '+esc(row.source==='formsg'?'FormSG':'Manual')+'</p></div><button id="closeLeadDetail" type="button" class="small">Close</button></div>'+
      '<div class="lead-detail-grid">'+
        detailValue('Email',row.email)+detailValue('Phone',row.phone)+detailValue('Interest',row.interest_area)+
        detailValue('Submitted',formatDate(row.submitted_at||row.created_at))+detailValue('Referral source',row.referral_source)+
        detailValue('Converted volunteer',row.converted_volunteer_id)+
      '</div>'+
      (row.motivation?'<div class="lead-long-field"><strong>Motivation</strong><p>'+esc(row.motivation)+'</p></div>':'')+
      (row.skills_experience?'<div class="lead-long-field"><strong>Skills / experience</strong><p>'+esc(row.skills_experience)+'</p></div>':'')+
      (row.availability_notes?'<div class="lead-long-field"><strong>Availability</strong><p>'+esc(row.availability_notes)+'</p></div>':'')+
      (locked
        ?'<div class="notice ok">Converted to volunteer <strong>'+esc(row.converted_volunteer_id)+'</strong> on '+formatDate(row.converted_at)+'.</div>'
        :'<div class="lead-editor"><div><label for="leadEditStatus">Status</label><select id="leadEditStatus" '+(canWrite()?'':'disabled')+'>'+statusOptions+'</select></div>'+
          '<div><label for="leadStaffNotes">Staff notes</label><textarea id="leadStaffNotes" maxlength="10000" '+(canWrite()?'':'disabled')+'>'+esc(row.staff_notes||'')+'</textarea></div></div>'+
          (canWrite()?'<div class="row lead-detail-actions"><button id="saveLead" class="primary" type="button">Save lead</button>'+
            '<button id="convertLead" type="button" '+(row.status==='accepted'?'':'disabled')+'>Convert to volunteer</button>'+
            (canDelete()?'<button id="deleteLead" class="danger" type="button">Delete lead</button>':'')+
          '</div>':'')
      )+
    '</div>';
  }

  function wireRenderedControls(){
    const search=document.getElementById('leadSearch');
    if(search)search.addEventListener('input',function(){state.search=search.value;render();});
    const filter=document.getElementById('leadStatusFilter');
    if(filter)filter.addEventListener('change',function(){state.status=filter.value;render();});
    const refresh=document.getElementById('refreshLeads');
    if(refresh)refresh.addEventListener('click',function(){fetchLeads();});
    const csv=document.getElementById('leadCsvInput');
    if(csv)csv.addEventListener('change',function(){const file=csv.files&&csv.files[0];if(file)importCsv(file);csv.value='';});
    document.querySelectorAll('[data-open-lead]').forEach(function(button){
      button.addEventListener('click',function(){state.selectedId=button.dataset.openLead||'';render();const card=document.getElementById('leadDetailCard');if(card)card.scrollIntoView({behavior:'smooth',block:'start'});});
    });
    const close=document.getElementById('closeLeadDetail');
    if(close)close.addEventListener('click',function(){state.selectedId='';render();});
    const save=document.getElementById('saveLead');
    if(save)save.addEventListener('click',saveSelectedLead);
    const convert=document.getElementById('convertLead');
    if(convert)convert.addEventListener('click',convertSelectedLead);
    const del=document.getElementById('deleteLead');
    if(del)del.addEventListener('click',deleteSelectedLead);
  }

  async function saveSelectedLead(){
    const row=state.rows.find(function(item){return item.id===state.selectedId;});
    if(!row||!canWrite())return;
    const status=document.getElementById('leadEditStatus').value;
    const staffNotes=text(document.getElementById('leadStaffNotes').value)||null;
    if(status==='converted'){setStatus('Use Convert to volunteer instead of setting Converted manually.','bad');return;}
    setStatus('Saving lead…','neutral');
    try{
      const response=await S.apiFetch(
        '/rest/v1/volunteer_leads?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),
        {
          method:'PATCH',
          headers:{'Content-Type':'application/json','Prefer':'return=representation'},
          body:JSON.stringify({status:status,staff_notes:staffNotes})
        }
      );
      if(!response.ok)throw new Error('Could not save lead: '+await response.text());
      const updated=await response.json();
      if(!updated.length)throw new Error('This lead changed in another browser. Refresh before saving again.');
      Object.assign(row,updated[0]);
      setStatus('Lead updated.','ok');
      updateLeadCount();
      render();
    }catch(error){
      console.error(error);
      setStatus(error.message||'Could not save lead.','bad');
    }
  }

  async function convertSelectedLead(){
    const row=state.rows.find(function(item){return item.id===state.selectedId;});
    if(!row||!canWrite())return;
    if(row.status!=='accepted'){setStatus('Accept the lead before converting it to a volunteer.','bad');return;}
    if(!confirm('Convert '+row.full_name+' into the Central Database? MakLom will first check for an existing volunteer match.'))return;
    setStatus('Converting lead…','neutral');
    try{
      const response=await S.apiFetch('/rest/v1/rpc/maklom_convert_volunteer_lead',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({p_lead_id:row.id})
      });
      if(!response.ok)throw new Error('Could not convert lead: '+await response.text());
      const result=await response.json();
      await fetchLeads();
      if(S.refreshFromRemote&&!S.isDirty())await S.refreshFromRemote(true,false);
      const outcome=result&&result.status==='linked_existing'
        ?'Lead linked to existing volunteer '+result.volunteer_id+'.'
        :'Volunteer '+(result&&result.volunteer_id||'record')+' created.';
      setStatus(outcome,'ok');
    }catch(error){
      console.error(error);
      setStatus(error.message||'Could not convert lead.','bad');
    }
  }

  async function deleteSelectedLead(){
    const row=state.rows.find(function(item){return item.id===state.selectedId;});
    if(!row||!canDelete()||row.status==='converted')return;
    if(!confirm('Delete this volunteer lead? This should only be used for erroneous or test submissions.'))return;
    setStatus('Deleting lead…','neutral');
    try{
      const response=await S.apiFetch(
        '/rest/v1/volunteer_leads?id=eq.'+encodeURIComponent(row.id)+'&row_version=eq.'+encodeURIComponent(row.row_version),
        {method:'DELETE',headers:{Prefer:'return=representation'}}
      );
      if(!response.ok)throw new Error('Could not delete lead: '+await response.text());
      const deleted=await response.json();
      if(!deleted.length)throw new Error('This lead changed in another browser. Refresh before deleting it.');
      state.selectedId='';
      await fetchLeads();
      setStatus('Lead deleted.','ok');
    }catch(error){
      console.error(error);
      setStatus(error.message||'Could not delete lead.','bad');
    }
  }

  function parseCsv(csv){
    const rows=[];
    let row=[],value='',quoted=false;
    for(let i=0;i<csv.length;i++){
      const ch=csv[i],next=csv[i+1];
      if(ch==='"'&&quoted&&next==='"'){value+='"';i++;}
      else if(ch==='"'){quoted=!quoted;}
      else if(ch===','&&!quoted){row.push(value);value='';}
      else if((ch==='\n'||ch==='\r')&&!quoted){
        if(ch==='\r'&&next==='\n')i++;
        row.push(value);value='';
        if(row.some(function(cell){return cell.trim();}))rows.push(row);
        row=[];
      }else value+=ch;
    }
    row.push(value);
    if(row.some(function(cell){return cell.trim();}))rows.push(row);
    if(rows.length<2)return[];
    const headers=rows[0].map(function(header){return header.replace(/^\uFEFF/,'').trim();});
    return rows.slice(1).map(function(cells){
      const out={};
      headers.forEach(function(header,index){out[header]=text(cells[index]);});
      return out;
    });
  }

  function headerValue(row,needles){
    const entries=Object.keys(row).map(function(key){return[key,key.toLowerCase().replace(/[^a-z0-9]/g,'')];});
    const hit=entries.find(function(entry){return needles.some(function(needle){return entry[1].includes(needle);});});
    return hit?text(row[hit[0]]):'';
  }

  async function importCsv(file){
    if(!canWrite())return;
    if(file.size>5*1024*1024){setStatus('CSV rejected. Maximum size is 5 MB.','bad');return;}
    setStatus('Importing FormSG CSV…','neutral');
    try{
      const rows=parseCsv(await file.text());
      if(!rows.length)throw new Error('The CSV does not contain any data rows.');
      const payload=rows.map(function(row){
        const fullName=headerValue(row,['fullname','yourname','name']);
        if(!fullName)return null;
        const rawDate=headerValue(row,['submittedat','submissiontime','timestamp','createdat']);
        const submissionId=headerValue(row,['responseid','submissionid'])||(crypto.randomUUID?crypto.randomUUID():'csv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9));
        return{
          source:'formsg',
          source_form_id:FORM_ID,
          source_submission_id:submissionId,
          submitted_at:rawDate&&!Number.isNaN(Date.parse(rawDate))?new Date(rawDate).toISOString():new Date().toISOString(),
          status:'new',
          full_name:fullName,
          email:headerValue(row,['email'])||null,
          phone:headerValue(row,['mobilenumber','contactnumber','phonenumber','mobile','phone'])||null,
          interest_area:headerValue(row,['interest','volunteerrole','role'])||null,
          motivation:headerValue(row,['motivation','whywouldyouliketovolunteer'])||null,
          skills_experience:headerValue(row,['skillsexperience','skills','experience'])||null,
          availability_notes:headerValue(row,['availability'])||null,
          referral_source:headerValue(row,['howdidyouhear','referralsource'])||null,
          raw_payload:{importedFrom:'csv',responseId:submissionId}
        };
      }).filter(Boolean);
      if(!payload.length)throw new Error('No rows with a recognisable name column were found.');

      const response=await S.apiFetch('/rest/v1/volunteer_leads?on_conflict=source,source_form_id,source_submission_id',{
        method:'POST',
        headers:{'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},
        body:JSON.stringify(payload)
      });
      if(!response.ok)throw new Error('Could not import FormSG CSV: '+await response.text());
      await fetchLeads();
      setStatus('Processed '+payload.length+' FormSG rows. Existing response IDs were left unchanged.','ok');
    }catch(error){
      console.error(error);
      setStatus(error.message||'Could not import FormSG CSV.','bad');
    }
  }

  function install(){
    const button=document.querySelector('nav button[data-view="leadsView"]');
    if(button)button.addEventListener('click',function(){fetchLeads();});
    window.addEventListener('maklom:access-state',function(event){
      if(event.detail&&event.detail.ready&&document.getElementById('leadsView')&&document.getElementById('leadsView').classList.contains('active'))fetchLeads();
      else render();
    });
    render();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
