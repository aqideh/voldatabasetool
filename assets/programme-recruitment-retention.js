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
  function volunteerKey(volunteer){const email=normalise(volunteer&&volunteer.email);const phone=text(volunteer&&volunteer.phone).replace(/\D/g,'');return email||phone;}
  function rowKey(row){const email=normalise(row&&row.email);const phone=text(row&&row.contact).replace(/\D/g,'');return email||phone;}
  function attendedThisYear(attendanceLog,currentYear){
    const active={};
    (Array.isArray(attendanceLog)?attendanceLog:[]).forEach(function(row){
      if(normalise(row&&row.attendance)!=='yes')return;
      if(text(row&&row.eventDate).slice(0,4)!==String(currentYear))return;
      const key=rowKey(row);if(key)active[key]=true;
    });
    return active;
  }
  function summary(volunteers,attendanceLog,programmeOptions,currentYear){
    const active=attendedThisYear(attendanceLog,currentYear);
    return (Array.isArray(programmeOptions)?programmeOptions:[]).map(function(programme){
      let recruited=0,retained=0,missingRecruitedYear=0;
      (Array.isArray(volunteers)?volunteers:[]).forEach(function(volunteer){
        if(!volunteerMatchesProgramme(volunteer,programme))return;
        const recruitedYear=year(volunteer&&volunteer.recruitedYear);
        if(!recruitedYear){missingRecruitedYear++;return;}
        if(recruitedYear===String(currentYear)){recruited++;return;}
        if(Number(recruitedYear)<Number(currentYear)){
          const key=volunteerKey(volunteer);
          if(key&&active[key])retained++;
        }
      });
      return{programme:programme,recruited:recruited,retained:retained,missingRecruitedYear:missingRecruitedYear};
    });
  }
  return{summary:summary};
});
