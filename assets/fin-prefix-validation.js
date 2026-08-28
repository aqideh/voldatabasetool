(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MaklomIdentityValidation=api;
  if(typeof window==='undefined')return;

  function clean(value){return String(value==null?'':value).replace(/\s+/g,'').toUpperCase().slice(0,9);}
  function removeLegacyIssue(issues){
    return issues.filter(function(issue){return issue.indexOf('Volunteer NRIC should use S/T followed by 7 digits and a letter')===-1&&issue.indexOf('Volunteer NRIC must use S/T followed by 7 digits and a letter')===-1;});
  }

  if(typeof validateMappedRow==='function'){
    const originalValidateMappedRow=validateMappedRow;
    validateMappedRow=function(row,type){
      const result=originalValidateMappedRow(row,type);
      if(type!=='roster'||!row||!row.nric)return result;
      const value=clean(row.nric);
      let issues=removeLegacyIssue(result?result.split('; '):[]);
      if(!api.isValid(value))issues.push('Volunteer NRIC/FIN should use S/T/F/G/M followed by 7 digits and a letter');
      return issues.join('; ');
    };
  }

  if(typeof validateProfileDraft==='function'){
    const originalValidateProfileDraft=validateProfileDraft;
    validateProfileDraft=function(cleaned){
      let issues=removeLegacyIssue(originalValidateProfileDraft(cleaned));
      const value=clean(cleaned&&cleaned.nric);
      if(value&&!api.isValid(value))issues.push('Volunteer NRIC/FIN must use S/T/F/G/M followed by 7 digits and a letter.');
      return issues;
    };
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function normalise(value){return String(value==null?'':value).replace(/\s+/g,'').toUpperCase();}
  function isValid(value){const text=normalise(value);return text===''||/^[STFGM]\d{7}[A-Z]$/.test(text);}
  return{normalise:normalise,isValid:isValid};
});