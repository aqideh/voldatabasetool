(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CommunityDeploymentAnalytics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function text(value){return String(value==null?'':value).trim();}
  function normaliseEmail(value){return text(value).toLowerCase();}
  function normalisePhone(value){return text(value).replace(/\D/g,'');}
  function normaliseProgrammeList(value){
    return text(value).split(',').map(function(item){return text(item).toLowerCase();}).filter(Boolean);
  }
  function isCommunityVolunteer(volunteer){return normaliseProgrammeList(volunteer&&volunteer.programmesRegistered).indexOf('community volunteers')>-1;}
  function volunteerKeys(volunteer){
    const keys=[];
    const email=normaliseEmail(volunteer&&volunteer.email);
    const phone=normalisePhone(volunteer&&volunteer.phone);
    if(email)keys.push('e:'+email);
    if(phone)keys.push('p:'+phone);
    return keys;
  }
  function rowKeys(row){
    const keys=[];
    const email=normaliseEmail(row&&row.email);
    const phone=normalisePhone(row&&row.contact);
    if(email)keys.push('e:'+email);
    if(phone)keys.push('p:'+phone);
    return keys;
  }
  function isAttended(row){return text(row&&row.attendance).toLowerCase()==='yes';}
  function communityDeploymentRows(volunteers,rows){
    const keys={};
    (Array.isArray(volunteers)?volunteers:[]).filter(isCommunityVolunteer).forEach(function(volunteer){
      volunteerKeys(volunteer).forEach(function(key){keys[key]=true;});
    });
    return (Array.isArray(rows)?rows:[]).filter(function(row){return rowKeys(row).some(function(key){return keys[key];});});
  }
  function summary(volunteers,rows){
    const selected=communityDeploymentRows(volunteers,rows);
    return{
      attended:selected.filter(isAttended).length,
      total:selected.length
    };
  }
  return{summary:summary,communityDeploymentRows:communityDeploymentRows,isCommunityVolunteer:isCommunityVolunteer};
});
