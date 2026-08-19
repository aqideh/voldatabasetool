(function requireEventDateOnImport(){
  const previousValidateMappedRow=validateMappedRow;
  validateMappedRow=function(row,type){
    const base=previousValidateMappedRow(row,type);
    if(type!=='attendance')return base;
    const issues=base?base.split('; '):[];
    if(cleanText(row&&row.eventDate)==='')issues.push('Event Date is required');
    return issues.join('; ');
  };

  const previousConfirmImport=confirmImport;
  confirmImport=function(){
    if(!pendingImport||pendingImport.type!=='attendanceLog')return previousConfirmImport();
    const invalid=pendingImport.clean.filter(function(item){
      return cleanText(item&&item.incoming&&item.incoming.eventDate)==='';
    });
    if(invalid.length){
      showNotice('uploadStatus','bad','Import blocked. '+invalid.length+' attendance event log row'+(invalid.length===1?' is':'s are')+' missing Event Date. Add a date before confirming import.');
      return;
    }
    return previousConfirmImport();
  };
})();
