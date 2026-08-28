(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProgrammeRecruitmentRetention=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function text(value){return String(value==null?'':value).trim();}
  function normalise(value){return text(value).toLowerCase();}
  function year(value){const match=text(value).match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);return match?match[1]:'';}
  function programmes(value){return text(value).split(',').map(function(item){return text(item);}).filter(Boolean);}
  function volunteerMatchesProgramme(volunteer,programme){const target=normalise(programme);return programmes(volunteer&&volunteer.programmesRegistered).some(function(item){return normalise(item)===target;});}
  function emailKey(value){const key=normalise(value);return key?'email:'+key:'';}
  function phoneKey(value){const key=text(value).replace(/\D/g,'');return key?'phone:'+key:'';}
  function nameKey(value){const key=normalise(value).replace(/\s+/g,' ');return key?'name:'+key:'';}
  function volunteerIdentity(volunteer){return text(volunteer&&volunteer.id)||emailKey(volunteer&&volunteer.email)||phoneKey(volunteer&&volunteer.phone)||nameKey(volunteer&&volunteer.name);}
  function volunteerMatchKeys(volunteer){
    const email=emailKey(volunteer&&volunteer.email),phone=phoneKey(volunteer&&volunteer.phone);
    if(email||phone)return[email,phone].filter(Boolean);
    const name=nameKey(volunteer&&volunteer.name);return name?[name]:[];
  }
  function rowMatchKeys(row){
    const email=emailKey(row&&row.email),phone=phoneKey(row&&row.contact);
    if(email||phone)return[email,phone].filter(Boolean);
    const name=nameKey(row&&row.name);return name?[name]:[];
  }
  function activityThisYear(attendanceLog,currentYear,requireAttendance){
    const active={};
    (Array.isArray(attendanceLog)?attendanceLog:[]).forEach(function(row){
      if(text(row&&row.eventDate).slice(0,4)!==String(currentYear))return;
      if(requireAttendance&&normalise(row&&row.attendance)!=='yes')return;
      rowMatchKeys(row).forEach(function(key){active[key]=true;});
    });
    return active;
  }
  function volunteerIsInActivity(volunteer,activity){return volunteerMatchKeys(volunteer).some(function(key){return activity[key];});}
  function summary(volunteers,attendanceLog,programmeOptions,currentYear){
    const deployedThisYear=activityThisYear(attendanceLog,currentYear,false);
    const attendedThisYear=activityThisYear(attendanceLog,currentYear,true);
    return (Array.isArray(programmeOptions)?programmeOptions:[]).map(function(programme){
      const seen={};
      let recruited=0,deployed=0,retained=0,missingRecruitedYear=0;
      (Array.isArray(volunteers)?volunteers:[]).forEach(function(volunteer){
        if(!volunteerMatchesProgramme(volunteer,programme))return;
        const identity=volunteerIdentity(volunteer);
        if(identity&&seen[identity])return;
        if(identity)seen[identity]=true;
        const recruitedYear=year(volunteer&&volunteer.recruitedYear);
        if(!recruitedYear)missingRecruitedYear++;
        if(recruitedYear===String(currentYear))recruited++;
        if(volunteerIsInActivity(volunteer,deployedThisYear))deployed++;
        if(recruitedYear&&Number(recruitedYear)<Number(currentYear)&&volunteerIsInActivity(volunteer,attendedThisYear))retained++;
      });
      return{programme:programme,recruited:recruited,deployed:deployed,retained:retained,missingRecruitedYear:missingRecruitedYear};
    });
  }
  return{summary:summary};
});