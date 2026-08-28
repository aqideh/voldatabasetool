(function initMaklomSharedData(){
  'use strict';
  const S=window.MaklomSharedDB;
  S.fetchRows=async function(table,select){
    const all=[];
    for(let start=0;;start+=S.config.pageSize){
      const end=start+S.config.pageSize-1;
      const response=await S.apiFetch('/rest/v1/'+table+'?select='+encodeURIComponent(select||'*')+'&order=id.asc',{method:'GET',headers:{Range:start+'-'+end}});
      if(!response.ok)throw new Error(table+' load failed: '+await response.text());
      const page=await response.json();all.push.apply(all,page);if(page.length<S.config.pageSize)break;
    }
    return all;
  };
  S.dbVolunteerToLocal=function(row){return{id:row.id,name:row.name||'',nric:row.nric||'',phone:row.phone||'',email:row.email||'',gender:row.gender||'',address:row.address||'',recruitedYear:row.recruited_year==null?'':String(row.recruited_year),chatSession:row.chat_session||'',chatSessionDate:row.chat_session_date||'',interests:row.interests||'',languagesSpoken:row.languages_spoken||'',programmesRegistered:Array.isArray(row.programmes_registered)?row.programmes_registered.join(', '):'',tags:Array.isArray(row.tags)?row.tags:[],emergencyName:row.emergency_name||'',emergencyPhone:row.emergency_phone||'',shirtSize:row.shirt_size||'',dietary:row.dietary||'',notes:row.notes||'',attendance:[]};};
  S.dbEventToLocal=function(row){return{id:row.id,name:row.name||'',email:row.email||'',contact:row.contact||'',attendance:row.attended?'yes':'',eventName:row.event_name||'',eventDate:row.event_date||'',durationMinutes:Number(row.duration_minutes)||0,grabVoucherCode1:row.grab_voucher_code_1||'',grabVoucherCode2:row.grab_voucher_code_2||'',grabVoucherCode3:row.grab_voucher_code_3||''};};
  S.dbDuplicateToLocal=function(row){return{id:row.id,level:row.level,existingId:row.existing_volunteer_id||'',incoming:row.incoming||{},decision:row.decision||'pending',reason:row.reason||''};};
  S.dbMergeToLocal=function(row){return{date:row.occurred_at,level:row.level||'',action:row.action||'',existingName:row.existing_name||'',incomingName:row.incoming_name||'',reason:row.reason||''};};
  S.versionMap=function(rows){const out={};rows.forEach(function(row){out[row.id]=Number(row.row_version)||1;});return out;};
  S.loadRemoteBundle=async function(){
    const r=await Promise.all([S.fetchRows('volunteers','*'),S.fetchRows('attendance_log','*'),S.fetchRows('reporting_metrics','*'),S.fetchRows('suspected_duplicates','*'),S.fetchRows('merge_log','*')]);
    return{data:validateJsonSave({volunteers:r[0].map(S.dbVolunteerToLocal),attendanceLog:r[1].map(S.dbEventToLocal),reportingMetrics:r[2].map(function(x){return{id:x.id,label:x.label||'',value:x.value==null?null:Number(x.value),note:x.note||''};}),suspectedDuplicates:r[3].map(S.dbDuplicateToLocal),mergeLog:r[4].map(S.dbMergeToLocal)}),versions:{volunteers:S.versionMap(r[0]),attendance_log:S.versionMap(r[1]),reporting_metrics:S.versionMap(r[2]),suspected_duplicates:S.versionMap(r[3])}};
  };
  S.volunteerToDb=function(v){return{id:v.id,name:S.text(v.name),nric:S.nonBlank(v.nric),phone:S.nonBlank(v.phone),email:S.nonBlank(v.email),gender:S.nonBlank(v.gender),address:S.nonBlank(v.address),recruited_year:v.recruitedYear?Number(v.recruitedYear):null,chat_session:S.nonBlank(v.chatSession),chat_session_date:S.dateIso(v.chatSessionDate),interests:S.nonBlank(v.interests),languages_spoken:S.nonBlank(v.languagesSpoken),programmes_registered:typeof programmesToArray==='function'?programmesToArray(v.programmesRegistered):[],tags:Array.isArray(v.tags)?v.tags:[],emergency_name:S.nonBlank(v.emergencyName),emergency_phone:S.nonBlank(v.emergencyPhone),shirt_size:S.nonBlank(v.shirtSize),dietary:S.nonBlank(v.dietary),notes:S.nonBlank(v.notes)};};
  S.matchedVolunteerId=function(row){const email=S.lower(row.email),phone=S.phoneKey(row.contact);const match=(appData.volunteers||[]).find(function(v){return(email&&S.lower(v.email)===email)||(phone&&S.phoneKey(v.phone)===phone);});return match?match.id:null;};
  S.eventToDb=function(row){return{id:row.id,volunteer_id:S.matchedVolunteerId(row),name:S.text(row.name),email:S.nonBlank(row.email),contact:S.nonBlank(row.contact),attended:normaliseAttendanceFlag(row.attendance)==='yes',event_name:S.text(row.eventName),event_date:S.dateIso(row.eventDate),duration_minutes:Number(row.durationMinutes)||0,grab_voucher_code_1:S.nonBlank(row.grabVoucherCode1),grab_voucher_code_2:S.nonBlank(row.grabVoucherCode2),grab_voucher_code_3:S.nonBlank(row.grabVoucherCode3)};};
  S.metricToDb=function(row){return{id:row.id,label:S.text(row.label),value:row.value==null?null:Number(row.value),note:S.nonBlank(row.note)};};
  S.duplicateToDb=function(row){return{id:row.id,level:row.level||'low',existing_volunteer_id:S.nonBlank(row.existingId),incoming:row.incoming||{},decision:row.decision||'pending',reason:S.nonBlank(row.reason)};};
  S.hashString=function(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);};
  S.mergeLogId=function(row){return'merge_'+S.hashString([row.date,row.level,row.action,row.existingName,row.incomingName,row.reason].map(S.text).join('|'));};
  S.mergeToDb=function(row){return{id:S.mergeLogId(row),occurred_at:row.date||new Date().toISOString(),level:S.nonBlank(row.level),action:S.text(row.action),existing_name:S.nonBlank(row.existingName),incoming_name:S.nonBlank(row.incomingName),reason:S.nonBlank(row.reason)};};
  S.currentCanonical=function(){return{volunteers:(appData.volunteers||[]).map(S.volunteerToDb),attendance_log:(appData.attendanceLog||[]).map(S.eventToDb),reporting_metrics:(appData.reportingMetrics||[]).map(S.metricToDb),suspected_duplicates:(appData.suspectedDuplicates||[]).map(S.duplicateToDb),merge_log:(appData.mergeLog||[]).map(S.mergeToDb)};};
  S.canonicalSnapshot=function(){const c=S.currentCanonical();return{volunteers:S.mapById(c.volunteers),attendance_log:S.mapById(c.attendance_log),reporting_metrics:S.mapById(c.reporting_metrics),suspected_duplicates:S.mapById(c.suspected_duplicates),merge_log:S.mapById(c.merge_log)};};
  S.snapshotForData=function(data){const saved=appData;appData=data;try{return S.canonicalSnapshot();}finally{appData=saved;}};
  S.recordValidForWrite=function(table,row){if(table==='volunteers')return !!(S.text(row.name).trim()&&(S.text(row.phone).trim()||S.text(row.email).trim()));if(table==='attendance_log')return !!(S.text(row.name).trim()&&(S.text(row.email).trim()||S.text(row.contact).trim())&&S.text(row.event_name).trim()&&/^\d{4}-\d{2}-\d{2}$/.test(S.text(row.event_date)));if(table==='reporting_metrics')return !!S.text(row.label).trim();return true;};
  S.humanTable=function(table){return({volunteers:'volunteers',attendance_log:'event log rows',reporting_metrics:'reporting figures',suspected_duplicates:'duplicate-review rows',merge_log:'merge log rows'})[table]||table;};
  S.localHasData=function(){return !!((appData.volunteers&&appData.volunteers.length)||(appData.attendanceLog&&appData.attendanceLog.length)||(appData.mergeLog&&appData.mergeLog.length));};
  S.remoteHasData=function(bundle){const x=bundle&&bundle.data;return !!(x&&((x.volunteers&&x.volunteers.length)||(x.attendanceLog&&x.attendanceLog.length)||(x.mergeLog&&x.mergeLog.length)));};
})();