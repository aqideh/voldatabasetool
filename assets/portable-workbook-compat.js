(function installPortableWorkbookCompatibility(){
  const previousValidateMappedRow=validateMappedRow;
  validateMappedRow=function(row,type){
    if(!row||!row._portableWorkbook)return previousValidateMappedRow(row,type);
    const issues=[];
    if(cleanText(row.name)==='')issues.push('Name is required');
    if(type==='roster'){
      if(cleanText(row.phone)===''&&cleanText(row.email)==='')issues.push('Phone or Email is required');
      if(row.email&&!isValidEmail(row.email))issues.push('Email format is invalid');
      if(row.chatSessionDate&&!/^\d{4}-\d{2}-\d{2}$/.test(row.chatSessionDate))issues.push('Chat Session Date Conducted should use YYYY-MM-DD');
      if(row.recruitedYear&&!/^\d{4}$/.test(cleanText(row.recruitedYear)))issues.push('Recruited Year should use YYYY');
      if(row.nric&& !/^[ST]\d{7}[A-Z]$/.test(cleanText(row.nric).toUpperCase()))issues.push('Volunteer NRIC should use S/T followed by 7 digits and a letter');
      return issues.join('; ');
    }
    if(type==='attendance'){
      if(cleanText(row.email)===''&&cleanText(row.contact)==='')issues.push('Email or Contact is required');
      if(row.email&&!isValidEmail(row.email))issues.push('Email format is invalid');
      if(cleanText(row.attendance)!==''&&normaliseAttendanceFlag(row.attendance)!=='yes')issues.push('Attendance must be yes or blank');
      if(cleanText(row.eventName)==='')issues.push('Event Name is required');
      if(!row.eventDate)issues.push('Event Date is required');
      else if(!/^\d{4}-\d{2}-\d{2}$/.test(row.eventDate))issues.push('Event Date should use YYYY-MM-DD');
      if(cleanText(row.hours)!==''&&(!Number.isFinite(Number(row.hours))||Number(row.hours)<0||Math.floor(Number(row.hours))!==Number(row.hours)||Number(row.hours)>MAX_HOURS))issues.push('Hours must be a whole number from 0 to '+MAX_HOURS);
      if(cleanText(row.minutes)!==''&&(!Number.isFinite(Number(row.minutes))||Number(row.minutes)<0||Math.floor(Number(row.minutes))!==Number(row.minutes)||Number(row.minutes)>59))issues.push('Minutes must be a whole number from 0 to 59');
      return issues.join('; ');
    }
    return previousValidateMappedRow(row,type);
  };

  if(typeof window.exportPortableDatabase==='function'){
    exportDatabaseXlsx=window.exportPortableDatabase;
  }
})();
