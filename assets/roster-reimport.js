(function installMaklomRosterReimport(){
  const EXPORT_FIELD_MAP={
    'Name':'name',
    'Volunteer NRIC':'nric',
    'Phone':'phone',
    'Email':'email',
    'Gender':'gender',
    'Address':'address',
    'Recruited Year':'recruitedYear',
    'Chat Session':'chatSession',
    'Chat Session Date Conducted':'chatSessionDate',
    'Interests':'interests',
    'Languages Spoken':'languagesSpoken',
    'Programmes Registered':'programmesRegistered',
    'Tags':'tags',
    'Emergency Contact Name':'emergencyName',
    'Emergency Contact Phone':'emergencyPhone',
    'T-Shirt Size':'shirtSize',
    'Dietary Requirements':'dietary',
    'Notes':'notes'
  };
  const IGNORED_EXPORT_HEADERS=['Total Hours','Last Active'];

  function normaliseHeader(value){return cleanText(value);}

  function exportedRosterHeaderMap(headers){
    const map={};
    (headers||[]).forEach(function(header,index){
      const label=normaliseHeader(header);
      if(EXPORT_FIELD_MAP[label])map[EXPORT_FIELD_MAP[label]]=index;
    });
    return map;
  }

  function looksLikeMaklomExport(headers){
    if(!Array.isArray(headers))return false;
    const labels=headers.map(normaliseHeader);
    const map=exportedRosterHeaderMap(headers);
    const recognised=labels.filter(function(label){return EXPORT_FIELD_MAP[label]||IGNORED_EXPORT_HEADERS.indexOf(label)>-1;}).length;
    return map.name!=null&&(map.phone!=null||map.email!=null)&&recognised>=6&&(labels.indexOf('Total Hours')>-1||labels.indexOf('Last Active')>-1||labels.indexOf('Tags')>-1);
  }

  function mapExportedRosterRow(row,rowNumber,headerMap){
    const raw={rowNumber:rowNumber,tags:[],attendance:[]};
    Object.keys(headerMap).forEach(function(key){
      const value=row[headerMap[key]];
      if(key==='tags')raw.tags=parseTags(value);
      else raw[key]=value;
    });
    const mapped=sanitizeVolunteerRow(raw);
    mapped._maklomReimport=true;
    return mapped;
  }

  const originalValidateAndPreviewRows=validateAndPreviewRows;
  validateAndPreviewRows=function(rows){
    if(uploadedType!=='roster'||!rows.length||headersMatch(rows[0],ROSTER_HEADERS)){
      return originalValidateAndPreviewRows(rows);
    }
    if(!looksLikeMaklomExport(rows[0])){
      return originalValidateAndPreviewRows(rows);
    }
    if(rows.length-1>MAX_IMPORT_ROWS){
      document.getElementById('previewCard').classList.add('hidden');
      showNotice('uploadStatus','bad','Import rejected. Maximum rows per import is '+MAX_IMPORT_ROWS+'.');
      return;
    }
    const headerMap=exportedRosterHeaderMap(rows[0]);
    uploadedRows=[];
    for(let i=1;i<rows.length;i++){
      if(isBlankRow(rows[i]))continue;
      const mapped=mapExportedRosterRow(rows[i],i+1,headerMap);
      mapped.issue=validateMappedRow(mapped,'roster');
      mapped.valid=mapped.issue==='';
      uploadedRows.push(mapped);
    }
    renderPreview();
    const invalid=uploadedRows.filter(function(row){return !row.valid;}).length;
    showNotice('uploadStatus',invalid?'warn':'ok',invalid?'MakLom exported roster detected. Modified values will go through Merge Review; invalid rows are flagged.':'MakLom exported roster detected. Modified values will go through Merge Review before replacing existing values. Calculated columns such as Total Hours and Last Active are ignored.');
  };

  const originalFindHighConfidenceMatch=findHighConfidenceMatch;
  findHighConfidenceMatch=function(row){
    if(!row||!row._maklomReimport)return originalFindHighConfidenceMatch(row);
    const email=normalizeEmail(row.email);
    const phone=normalizePhone(row.phone);
    if(email){
      const emailMatches=appData.volunteers.filter(function(v){return normalizeEmail(v.email)===email;});
      if(emailMatches.length===1){emailMatches[0].matchReason='Unique Email from MakLom export';return emailMatches[0];}
    }
    if(phone){
      const phoneMatches=appData.volunteers.filter(function(v){return normalizePhone(v.phone)===phone;});
      if(phoneMatches.length===1){phoneMatches[0].matchReason='Unique Phone from MakLom export';return phoneMatches[0];}
    }
    return originalFindHighConfidenceMatch(row);
  };

  const originalFindFieldConflicts=findFieldConflicts;
  findFieldConflicts=function(existing,incoming,type){
    if(type!=='roster'||!incoming||!incoming._maklomReimport)return originalFindFieldConflicts(existing,incoming,type);
    const fields=VOLUNTEER_SCHEMA.map(function(field){return field.key;});
    const result={fields:[],resolvedValues:{}};
    fields.forEach(function(key){
      const a=key==='tags'?tagsToText(existing.tags):cleanText(existing[key]);
      const b=key==='tags'?tagsToText(incoming.tags):cleanText(incoming[key]);
      if(a===b)return;
      result.fields.push({key:key,label:getVolunteerLabel(key),existing:a,incoming:b});
      result.resolvedValues[key]=a;
    });
    return result;
  };

  const originalCommitConflictItem=commitConflictItem;
  commitConflictItem=function(conflict){
    if(!conflict||!conflict.incoming||!conflict.incoming._maklomReimport)return originalCommitConflictItem(conflict);
    const volunteer=getVolunteer(conflict.existingId);
    if(!volunteer)return;
    Object.keys(conflict.resolvedValues).forEach(function(key){
      if(key==='tags')volunteer.tags=parseTags(conflict.resolvedValues[key]);
      else volunteer[key]=safeText(conflict.resolvedValues[key],key);
    });
    appData.mergeLog.push({date:new Date().toISOString(),level:'conflict',action:'resolved MakLom roster re-import',existingName:volunteer.name,incomingName:conflict.incoming.name,reason:'User reviewed modified exported roster values.'});
  };
})();
