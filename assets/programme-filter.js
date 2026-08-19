(function installCentralDatabaseBooleanQuery(){
  const QUERY_FIELDS=[
    {key:'anyText',label:'Any searchable field',kind:'text'},
    {key:'name',label:'Name',kind:'text'},
    {key:'nric',label:'Volunteer NRIC',kind:'text'},
    {key:'phone',label:'Phone',kind:'text'},
    {key:'email',label:'Email',kind:'text'},
    {key:'gender',label:'Gender',kind:'enum',options:'gender'},
    {key:'address',label:'Address',kind:'text'},
    {key:'recruitedYear',label:'Recruited Year',kind:'number'},
    {key:'chatSession',label:'Chat Session',kind:'text'},
    {key:'chatSessionDate',label:'Chat Session Date Conducted',kind:'date'},
    {key:'interests',label:'Interests',kind:'text'},
    {key:'languagesSpoken',label:'Languages Spoken',kind:'text'},
    {key:'emergencyName',label:'Emergency Contact Name',kind:'text'},
    {key:'emergencyPhone',label:'Emergency Contact Phone',kind:'text'},
    {key:'programme',label:'Programme',kind:'set',options:'programme'},
    {key:'tags',label:'Tags',kind:'set',options:'tags'},
    {key:'shirtSize',label:'T-Shirt Size',kind:'enum',options:'shirtSize'},
    {key:'dietary',label:'Dietary Requirements',kind:'text'},
    {key:'notes',label:'Notes',kind:'text'},
    {key:'totalHours',label:'Total Hours',kind:'number'},
    {key:'lastActive',label:'Last Active',kind:'date'},
    {key:'activity',label:'Activity',kind:'activity'},
    {key:'event',label:'Event',kind:'event',options:'event'}
  ];

  const OPERATORS={
    text:[['contains','contains'],['notContains','does not contain'],['equals','equals'],['notEquals','does not equal'],['startsWith','starts with'],['isEmpty','is empty'],['isNotEmpty','is not empty']],
    enum:[['equals','equals'],['notEquals','does not equal'],['anyOf','is any of'],['noneOf','is none of'],['isEmpty','is empty'],['isNotEmpty','is not empty']],
    set:[['hasAny','has any of'],['hasAll','has all of'],['hasNone','has none of'],['isEmpty','is empty'],['isNotEmpty','is not empty']],
    number:[['eq','='],['ne','!='],['gt','>'],['gte','>='],['lt','<'],['lte','<='],['between','between'],['isEmpty','is empty'],['isNotEmpty','is not empty']],
    date:[['on','is on'],['before','is before'],['after','is after'],['between','is between'],['isEmpty','is empty'],['isNotEmpty','is not empty']],
    activity:[['hasAttendance','has attended an event'],['noAttendance','has not attended an event']],
    event:[['registeredAny','registered for any of'],['registeredAll','registered for all of'],['registeredNone','registered for none of'],['attendedAny','attended any of'],['attendedAll','attended all of'],['attendedNone','attended none of']]
  };

  let queryNodeCounter=0;
  let renderedOptionSignature='';
  let databaseQueryRoot=newGroup('AND');

  function nextQueryId(prefix){queryNodeCounter+=1;return prefix+'_'+queryNodeCounter;}
  function newGroup(operator){return{id:nextQueryId('group'),type:'group',operator:operator==='OR'?'OR':'AND',children:[]};}
  function newCondition(fieldKey){const field=getField(fieldKey||'anyText')||QUERY_FIELDS[0];return{id:nextQueryId('condition'),type:'condition',field:field.key,operator:defaultOperator(field),value:defaultValue(field)};}
  function getField(key){return QUERY_FIELDS.find(function(field){return field.key===key;})||null;}
  function defaultOperator(field){const operators=OPERATORS[field.kind]||OPERATORS.text;return operators[0][0];}
  function defaultValue(field){return field.kind==='set'||field.kind==='event'?[]:'';}
  function operatorNeedsNoValue(operator){return operator==='isEmpty'||operator==='isNotEmpty'||operator==='hasAttendance'||operator==='noAttendance';}
  function operatorNeedsMultipleValues(field,operator){return field.kind==='set'||field.kind==='event'||(field.kind==='enum'&&(operator==='anyOf'||operator==='noneOf'));}
  function operatorNeedsRange(operator){return operator==='between';}

  function normaliseQueryText(value){return cleanText(value).toLowerCase();}
  function maskQueryNric(value){const nric=cleanText(value).replace(/\s+/g,'').toUpperCase();return nric.length===9?nric.slice(0,1)+'****'+nric.slice(5):nric;}
  function eventRowsForQuery(volunteer){if(typeof eventLogRowsForVolunteer==='function')return eventLogRowsForVolunteer(volunteer);return Array.isArray(volunteer&&volunteer.attendance)?volunteer.attendance:[];}
  function eventRowAttendedForQuery(row){if(row&&Object.prototype.hasOwnProperty.call(row,'attendance')){if(typeof attendanceWasCaptured==='function')return attendanceWasCaptured(row);return normaliseQueryText(row.attendance)==='yes';}return true;}
  function volunteerHasCapturedAttendance(volunteer){return eventRowsForQuery(volunteer).some(eventRowAttendedForQuery);}
  function eventRegistrationCountForQuery(volunteer){return eventRowsForQuery(volunteer).length;}
  function eventAttendanceCountForQuery(volunteer){return eventRowsForQuery(volunteer).filter(eventRowAttendedForQuery).length;}
  function sortQueryRows(rows,sort){
    if(sort==='eventsAttended'){rows.sort(function(a,b){return eventAttendanceCountForQuery(b)-eventAttendanceCountForQuery(a)||eventRegistrationCountForQuery(b)-eventRegistrationCountForQuery(a)||cleanText(a.name).localeCompare(cleanText(b.name));});return;}
    if(sort==='eventsRegistered'){rows.sort(function(a,b){return eventRegistrationCountForQuery(b)-eventRegistrationCountForQuery(a)||eventAttendanceCountForQuery(b)-eventAttendanceCountForQuery(a)||cleanText(a.name).localeCompare(cleanText(b.name));});return;}
    sortVolunteers(rows,sort);
  }
  function ensureQuerySortOptions(){const sort=document.getElementById('sortSelect');if(!sort)return;if(!sort.querySelector('option[value="eventsAttended"]'))sort.insertAdjacentHTML('beforeend','<option value="eventsAttended">Events attended high-low</option>');if(!sort.querySelector('option[value="eventsRegistered"]'))sort.insertAdjacentHTML('beforeend','<option value="eventsRegistered">Events registered high-low</option>');}

  function searchableVolunteerText(volunteer){
    const tags=Array.isArray(volunteer.tags)?volunteer.tags:[];
    const events=eventRowsForQuery(volunteer);
    return [volunteer.name,volunteer.nric,maskQueryNric(volunteer.nric),volunteer.phone,volunteer.email,volunteer.gender,volunteer.address,volunteer.recruitedYear,volunteer.chatSession,volunteer.chatSessionDate,volunteer.interests,volunteer.languagesSpoken,volunteer.emergencyName,volunteer.emergencyPhone,volunteer.programmesRegistered,tags.join(' '),volunteer.shirtSize,volunteer.dietary,volunteer.notes,getTotalHours(volunteer),getLastActive(volunteer),events.map(function(row){return [row.eventName,row.eventDate||row.date,row.attendance].join(' ');}).join(' ')].join(' ').toLowerCase();
  }
  function textFieldValue(volunteer,key){if(key==='anyText')return searchableVolunteerText(volunteer);if(key==='nric')return [cleanText(volunteer.nric),maskQueryNric(volunteer.nric)].join(' ');return cleanText(volunteer[key]);}
  function setFieldValues(volunteer,key){if(key==='programme')return typeof programmesToArray==='function'?programmesToArray(volunteer.programmesRegistered):[];if(key==='tags')return Array.isArray(volunteer.tags)?volunteer.tags.slice():[];return[];}
  function numericFieldValue(volunteer,key){if(key==='totalHours')return Number(getTotalHours(volunteer))||0;if(key==='recruitedYear'){const text=cleanText(volunteer.recruitedYear);return text===''?null:Number(text);}return null;}
  function dateFieldValue(volunteer,key){if(key==='lastActive')return cleanText(getLastActive(volunteer));return cleanText(volunteer[key]);}

  function compareText(actual,operator,expected){const a=normaliseQueryText(actual),b=normaliseQueryText(expected);if(operator==='isEmpty')return a==='';if(operator==='isNotEmpty')return a!=='';if(b==='')return true;if(operator==='contains')return a.indexOf(b)>-1;if(operator==='notContains')return a.indexOf(b)===-1;if(operator==='equals')return a===b;if(operator==='notEquals')return a!==b;if(operator==='startsWith')return a.indexOf(b)===0;return true;}
  function compareEnum(actual,operator,value){const a=normaliseQueryText(actual);if(operator==='isEmpty')return a==='';if(operator==='isNotEmpty')return a!=='';if((operator==='equals'||operator==='notEquals')&&normaliseQueryText(value)==='')return true;if(operator==='equals')return a===normaliseQueryText(value);if(operator==='notEquals')return a!==normaliseQueryText(value);const values=(Array.isArray(value)?value:[]).map(normaliseQueryText).filter(Boolean);if(!values.length)return true;if(operator==='anyOf')return values.indexOf(a)>-1;if(operator==='noneOf')return values.indexOf(a)===-1;return true;}
  function compareSet(actualValues,operator,value){const actual=(actualValues||[]).map(normaliseQueryText).filter(Boolean);if(operator==='isEmpty')return actual.length===0;if(operator==='isNotEmpty')return actual.length>0;const selected=(Array.isArray(value)?value:[]).map(normaliseQueryText).filter(Boolean);if(!selected.length)return true;if(operator==='hasAny')return selected.some(function(item){return actual.indexOf(item)>-1;});if(operator==='hasAll')return selected.every(function(item){return actual.indexOf(item)>-1;});if(operator==='hasNone')return selected.every(function(item){return actual.indexOf(item)===-1;});return true;}
  function compareNumber(actual,operator,value){
    if(operator==='isEmpty')return actual===null||actual===''||!Number.isFinite(Number(actual));
    if(operator==='isNotEmpty')return actual!==null&&actual!==''&&Number.isFinite(Number(actual));
    if(operator==='between'){const pair=Array.isArray(value)?value:[];if(cleanText(pair[0])===''||cleanText(pair[1])==='')return true;}else if(cleanText(value)==='')return true;
    if(actual===null||actual===''||!Number.isFinite(Number(actual)))return false;
    const a=Number(actual);
    if(operator==='between'){const pair=Array.isArray(value)?value:[];const low=Number(pair[0]),high=Number(pair[1]);return a>=Math.min(low,high)&&a<=Math.max(low,high);}
    const b=Number(value);if(!Number.isFinite(b))return true;if(operator==='eq')return a===b;if(operator==='ne')return a!==b;if(operator==='gt')return a>b;if(operator==='gte')return a>=b;if(operator==='lt')return a<b;if(operator==='lte')return a<=b;return true;
  }
  function compareDate(actual,operator,value){const a=cleanText(actual);if(operator==='isEmpty')return a==='';if(operator==='isNotEmpty')return a!=='';if(!a)return false;if(operator==='between'){const pair=Array.isArray(value)?value:[];const low=cleanText(pair[0]),high=cleanText(pair[1]);if(!low||!high)return true;const start=low<high?low:high,end=low<high?high:low;return a>=start&&a<=end;}const b=cleanText(value);if(!b)return true;if(operator==='on')return a===b;if(operator==='before')return a<b;if(operator==='after')return a>b;return true;}
  function compareEvent(volunteer,operator,value){
    const selected=(Array.isArray(value)?value:[]).map(normaliseQueryText).filter(Boolean);if(!selected.length)return true;
    const rows=eventRowsForQuery(volunteer);
    function rowMatches(eventKey,attendedOnly){return rows.some(function(row){if(normaliseQueryText(row&&row.eventName)!==eventKey)return false;return !attendedOnly||eventRowAttendedForQuery(row);});}
    const attendedOnly=operator.indexOf('attended')===0;
    if(operator.endsWith('Any'))return selected.some(function(key){return rowMatches(key,attendedOnly);});
    if(operator.endsWith('All'))return selected.every(function(key){return rowMatches(key,attendedOnly);});
    if(operator.endsWith('None'))return selected.every(function(key){return !rowMatches(key,attendedOnly);});
    return true;
  }
  function evaluateCondition(volunteer,condition){
    const field=getField(condition.field);if(!field)return true;
    if(field.kind==='text')return compareText(textFieldValue(volunteer,field.key),condition.operator,condition.value);
    if(field.kind==='enum')return compareEnum(textFieldValue(volunteer,field.key),condition.operator,condition.value);
    if(field.kind==='set')return compareSet(setFieldValues(volunteer,field.key),condition.operator,condition.value);
    if(field.kind==='number'){const actual=numericFieldValue(volunteer,field.key);if(field.key==='totalHours'&&condition.operator==='isEmpty')return actual===0;if(field.key==='totalHours'&&condition.operator==='isNotEmpty')return actual>0;return compareNumber(actual,condition.operator,condition.value);}
    if(field.kind==='date')return compareDate(dateFieldValue(volunteer,field.key),condition.operator,condition.value);
    if(field.kind==='activity')return condition.operator==='hasAttendance'?volunteerHasCapturedAttendance(volunteer):!volunteerHasCapturedAttendance(volunteer);
    if(field.kind==='event')return compareEvent(volunteer,condition.operator,condition.value);
    return true;
  }
  function evaluateQueryNode(volunteer,node){if(!node)return true;if(node.type==='condition')return evaluateCondition(volunteer,node);const children=Array.isArray(node.children)?node.children:[];if(!children.length)return true;return node.operator==='OR'?children.some(function(child){return evaluateQueryNode(volunteer,child);}):children.every(function(child){return evaluateQueryNode(volunteer,child);});}
  function effectiveQueryRoot(){const search=document.getElementById('searchBox');const quick=search?cleanText(search.value):'';if(!quick)return databaseQueryRoot;return{type:'group',operator:'AND',children:[{type:'condition',field:'anyText',operator:'contains',value:quick},databaseQueryRoot]};}

  function uniqueSorted(values){const seen={};return(values||[]).map(cleanText).filter(function(value){const key=value.toLowerCase();if(!value||seen[key])return false;seen[key]=true;return true;}).sort(function(a,b){return a.localeCompare(b);});}
  function collectQueryOptions(type){
    if(type==='programme')return Array.isArray(PROGRAMME_OPTIONS)?PROGRAMME_OPTIONS.slice():[];
    if(type==='tags')return uniqueSorted((appData.volunteers||[]).reduce(function(out,v){return out.concat(Array.isArray(v.tags)?v.tags:[]);},[]));
    if(type==='gender')return uniqueSorted((appData.volunteers||[]).map(function(v){return v.gender;}));
    if(type==='shirtSize')return uniqueSorted((appData.volunteers||[]).map(function(v){return v.shirtSize;}));
    if(type==='event'){const names=[];(appData.attendanceLog||[]).forEach(function(row){names.push(row.eventName);});(appData.volunteers||[]).forEach(function(v){(v.attendance||[]).forEach(function(row){names.push(row.eventName);});});return uniqueSorted(names);}
    return[];
  }
  function optionSignature(){return JSON.stringify({programme:collectQueryOptions('programme'),tags:collectQueryOptions('tags'),gender:collectQueryOptions('gender'),shirtSize:collectQueryOptions('shirtSize'),event:collectQueryOptions('event')});}
  function selectedArray(condition){return Array.isArray(condition.value)?condition.value:[];}
  function optionsForCondition(field,condition){const base=collectQueryOptions(field.options);const selected=selectedArray(condition);selected.forEach(function(value){if(base.indexOf(value)===-1)base.push(value);});return uniqueSorted(base);}

  function fieldOptionsHtml(selected){return QUERY_FIELDS.map(function(field){return '<option value="'+escapeHtml(field.key)+'" '+(field.key===selected?'selected':'')+'>'+escapeHtml(field.label)+'</option>';}).join('');}
  function operatorOptionsHtml(field,selected){return (OPERATORS[field.kind]||OPERATORS.text).map(function(pair){return '<option value="'+pair[0]+'" '+(pair[0]===selected?'selected':'')+'>'+escapeHtml(pair[1])+'</option>';}).join('');}
  function renderMultiValueEditor(field,condition){const selected=selectedArray(condition);const options=optionsForCondition(field,condition);if(!options.length)return '<span class="query-no-value">No values available</span>';return '<div class="query-value-options">'+options.map(function(option){return '<label class="query-option"><input type="checkbox" data-query-multi-value="'+escapeHtml(condition.id)+'" value="'+escapeHtml(option)+'" '+(selected.indexOf(option)>-1?'checked':'')+'> <span>'+escapeHtml(option)+'</span></label>';}).join('')+'</div>';}
  function renderSingleEnumEditor(field,condition){const options=optionsForCondition(field,condition);return '<select data-query-value="'+escapeHtml(condition.id)+'"><option value="">Choose value</option>'+options.map(function(option){return '<option value="'+escapeHtml(option)+'" '+(condition.value===option?'selected':'')+'>'+escapeHtml(option)+'</option>';}).join('')+'</select>';}
  function renderValueEditor(field,condition){
    if(operatorNeedsNoValue(condition.operator))return '<span class="query-no-value">No value required</span>';
    if(operatorNeedsMultipleValues(field,condition.operator))return renderMultiValueEditor(field,condition);
    if(field.kind==='enum')return renderSingleEnumEditor(field,condition);
    if(operatorNeedsRange(condition.operator)){const pair=Array.isArray(condition.value)?condition.value:['',''];const inputType=field.kind==='number'?'number':'date';return '<div class="query-range"><input type="'+inputType+'" data-query-range-value="'+escapeHtml(condition.id)+'" data-query-range-index="0" value="'+escapeHtml(pair[0]||'')+'"><span>to</span><input type="'+inputType+'" data-query-range-value="'+escapeHtml(condition.id)+'" data-query-range-index="1" value="'+escapeHtml(pair[1]||'')+'"></div>';}
    const type=field.kind==='number'?'number':(field.kind==='date'?'date':'text');return '<input type="'+type+'" data-query-value="'+escapeHtml(condition.id)+'" value="'+escapeHtml(Array.isArray(condition.value)?'':condition.value||'')+'" placeholder="Value">';
  }
  function renderCondition(condition){const field=getField(condition.field)||QUERY_FIELDS[0];return '<div class="query-condition" data-query-node="'+escapeHtml(condition.id)+'"><select data-query-field="'+escapeHtml(condition.id)+'" aria-label="Filter field">'+fieldOptionsHtml(field.key)+'</select><select data-query-operator="'+escapeHtml(condition.id)+'" aria-label="Filter operator">'+operatorOptionsHtml(field,condition.operator)+'</select><div class="query-value">'+renderValueEditor(field,condition)+'</div><button type="button" class="small danger" data-query-remove="'+escapeHtml(condition.id)+'">Remove</button></div>';}
  function renderGroup(group,isRoot){const children=(group.children||[]).map(function(child){return child.type==='group'?renderGroup(child,false):renderCondition(child);}).join('');return '<div class="query-group '+(isRoot?'query-root-group':'query-nested-group')+'" data-query-group="'+escapeHtml(group.id)+'"><div class="query-group-head"><div><strong>'+(isRoot?'Match':'Group')+'</strong> <select data-query-group-operator="'+escapeHtml(group.id)+'"><option value="AND" '+(group.operator==='AND'?'selected':'')+'>ALL (AND)</option><option value="OR" '+(group.operator==='OR'?'selected':'')+'>ANY (OR)</option></select> <span class="muted">of these conditions</span></div>'+(!isRoot?'<button type="button" class="small danger" data-query-remove="'+escapeHtml(group.id)+'">Remove group</button>':'')+'</div><div class="query-group-children">'+(children||'<p class="muted query-empty">No Boolean conditions. All volunteers match unless Search is used.</p>')+'</div><div class="query-group-actions"><button type="button" class="small" data-query-add-condition="'+escapeHtml(group.id)+'">+ Add condition</button><button type="button" class="small" data-query-add-group="'+escapeHtml(group.id)+'">+ Add group</button></div></div>';}

  function installBooleanQueryUi(){
    const databaseView=document.getElementById('databaseView');if(!databaseView)return;
    const card=databaseView.querySelector('.card');if(!card)return;
    let toolbar=card.querySelector('.query-toolbar');
    if(!toolbar){const oldSearch=document.getElementById('searchBox');const oldGrid=oldSearch?oldSearch.closest('.grid'):card.querySelector('.grid');if(!oldGrid)return;oldGrid.className='grid query-toolbar';oldGrid.innerHTML='<div class="query-search"><label for="searchBox">Search all fields</label><input id="searchBox" placeholder="Search volunteer details, programmes, tags, events, dates"></div><div><label for="sortSelect">Sort</label><select id="sortSelect"><option value="name">Name A-Z</option><option value="tag">Tag then name</option><option value="hours">Total duration high-low</option><option value="lastActive">Last active newest</option><option value="eventsAttended">Events attended high-low</option><option value="eventsRegistered">Events registered high-low</option></select></div><div><label>&nbsp;</label><button id="clearDatabaseQuery" type="button">Clear query</button></div>';toolbar=oldGrid;}
    let note=document.getElementById('queryBuilderNote');if(!note){note=document.createElement('p');note.id='queryBuilderNote';note.className='muted query-builder-note';note.textContent='Search is evaluated as an AND clause with the Boolean query below. Use ALL (AND) and ANY (OR) groups to stack conditions.';toolbar.insertAdjacentElement('afterend',note);}
    let builder=document.getElementById('queryBuilder');if(!builder){builder=document.createElement('div');builder.id='queryBuilder';builder.className='query-builder';note.insertAdjacentElement('afterend',builder);}
    const counter=document.getElementById('databaseMatchCount');if(counter&&counter.dataset.booleanQueryLabel!=='true'){counter.dataset.booleanQueryLabel='true';counter.innerHTML='<span class="pill neutral">0</span> volunteers match the current query';}
  }
  function renderQueryBuilder(){installBooleanQueryUi();const target=document.getElementById('queryBuilder');if(!target)return;target.innerHTML=renderGroup(databaseQueryRoot,true);renderedOptionSignature=optionSignature();}
  function ensureQueryBuilder(){installBooleanQueryUi();const target=document.getElementById('queryBuilder');if(!target)return;const signature=optionSignature();if(!target.innerHTML||signature!==renderedOptionSignature)renderQueryBuilder();}

  function findNode(node,id){if(!node)return null;if(node.id===id)return node;if(node.type!=='group')return null;for(let i=0;i<node.children.length;i++){const found=findNode(node.children[i],id);if(found)return found;}return null;}
  function findParentGroup(node,id){if(!node||node.type!=='group')return null;if(node.children.some(function(child){return child.id===id;}))return node;for(let i=0;i<node.children.length;i++){const child=node.children[i];if(child.type==='group'){const found=findParentGroup(child,id);if(found)return found;}}return null;}
  function removeNode(id){const parent=findParentGroup(databaseQueryRoot,id);if(parent)parent.children=parent.children.filter(function(child){return child.id!==id;});}
  function updateConditionValue(id,value,index){const condition=findNode(databaseQueryRoot,id);if(!condition||condition.type!=='condition')return;if(index!==undefined){const pair=Array.isArray(condition.value)?condition.value.slice():['',''];pair[index]=value;condition.value=pair;}else condition.value=value;}
  function selectedCheckboxValues(id){return Array.prototype.slice.call(document.querySelectorAll('[data-query-multi-value="'+CSS.escape(id)+'"]:checked')).map(function(input){return input.value;});}

  function handleBuilderClick(event){const addCondition=event.target.closest('[data-query-add-condition]');if(addCondition){const group=findNode(databaseQueryRoot,addCondition.dataset.queryAddCondition);if(group&&group.type==='group'){group.children.push(newCondition());renderQueryBuilder();renderDatabase();}return;}const addGroup=event.target.closest('[data-query-add-group]');if(addGroup){const group=findNode(databaseQueryRoot,addGroup.dataset.queryAddGroup);if(group&&group.type==='group'){group.children.push(newGroup('AND'));renderQueryBuilder();renderDatabase();}return;}const remove=event.target.closest('[data-query-remove]');if(remove){removeNode(remove.dataset.queryRemove);renderQueryBuilder();renderDatabase();}}
  function handleBuilderChange(event){
    const fieldSelect=event.target.closest('[data-query-field]');if(fieldSelect){const condition=findNode(databaseQueryRoot,fieldSelect.dataset.queryField);const field=getField(fieldSelect.value);if(condition&&field){condition.field=field.key;condition.operator=defaultOperator(field);condition.value=defaultValue(field);renderQueryBuilder();renderDatabase();}return;}
    const operatorSelect=event.target.closest('[data-query-operator]');if(operatorSelect){const condition=findNode(databaseQueryRoot,operatorSelect.dataset.queryOperator);if(condition){const field=getField(condition.field);condition.operator=operatorSelect.value;condition.value=defaultValue(field);if(operatorNeedsRange(condition.operator))condition.value=['',''];renderQueryBuilder();renderDatabase();}return;}
    const groupSelect=event.target.closest('[data-query-group-operator]');if(groupSelect){const group=findNode(databaseQueryRoot,groupSelect.dataset.queryGroupOperator);if(group&&group.type==='group'){group.operator=groupSelect.value==='OR'?'OR':'AND';renderDatabase();}return;}
    const multi=event.target.closest('[data-query-multi-value]');if(multi){updateConditionValue(multi.dataset.queryMultiValue,selectedCheckboxValues(multi.dataset.queryMultiValue));renderDatabase();return;}
    const range=event.target.closest('[data-query-range-value]');if(range){updateConditionValue(range.dataset.queryRangeValue,range.value,Number(range.dataset.queryRangeIndex));renderDatabase();return;}
    const value=event.target.closest('[data-query-value]');if(value){updateConditionValue(value.dataset.queryValue,value.value);renderDatabase();}
  }
  function handleBuilderInput(event){const range=event.target.closest('[data-query-range-value]');if(range){updateConditionValue(range.dataset.queryRangeValue,range.value,Number(range.dataset.queryRangeIndex));renderDatabase();return;}const value=event.target.closest('[data-query-value]');if(value&&value.tagName!=='SELECT'){updateConditionValue(value.dataset.queryValue,value.value);renderDatabase();}}

  function updateDatabaseMatchCount(count){const counter=document.getElementById('databaseMatchCount');if(counter)counter.innerHTML='<span class="pill neutral">'+count+'</span> '+(count===1?'volunteer matches':'volunteers match')+' the current query';}
  function clearDatabaseQuery(){databaseQueryRoot=newGroup('AND');const search=document.getElementById('searchBox');if(search)search.value='';const sort=document.getElementById('sortSelect');if(sort)sort.value='name';renderQueryBuilder();renderDatabase();}
  function getFilteredVolunteers(){const expression=effectiveQueryRoot();const rows=(appData.volunteers||[]).filter(function(volunteer){return evaluateQueryNode(volunteer,expression);});const sort=document.getElementById('sortSelect');sortQueryRows(rows,sort?sort.value:'name');updateDatabaseMatchCount(rows.length);return rows;}

  function renderDatabase(){
    installBooleanQueryUi();ensureQueryBuilder();const rows=getFilteredVolunteers();
    let html='<table><thead><tr><th>Name</th><th>Volunteer NRIC</th><th>Phone</th><th>Email</th><th>Gender</th><th>Address</th><th>Recruited Year</th><th>Chat Session</th><th>Chat Date</th><th>Interests</th><th>Languages</th><th>Programmes</th><th>Tags</th><th>T-Shirt</th><th>Dietary</th><th>Total Hours</th><th>Last Active</th></tr></thead><tbody>';
    rows.forEach(function(v){html+='<tr class="clickable" onclick="toggleProfile(\''+escapeHtml(v.id)+'\')"><td>'+escapeHtml(v.name)+'</td><td>'+escapeHtml(maskQueryNric(v.nric))+'</td><td>'+escapeHtml(v.phone)+'</td><td>'+escapeHtml(v.email)+'</td><td>'+escapeHtml(v.gender)+'</td><td>'+escapeHtml(v.address)+'</td><td>'+escapeHtml(v.recruitedYear||'')+'</td><td>'+escapeHtml(v.chatSession)+'</td><td>'+escapeHtml(v.chatSessionDate)+'</td><td>'+escapeHtml(v.interests)+'</td><td>'+escapeHtml(v.languagesSpoken)+'</td><td>'+renderProgrammePills(v.programmesRegistered)+'</td><td>'+renderTagPills(v.tags)+'</td><td>'+escapeHtml(v.shirtSize)+'</td><td>'+escapeHtml(v.dietary)+'</td><td>'+getTotalHours(v)+'</td><td>'+escapeHtml(getLastActive(v))+'</td></tr>';if(expandedVolunteerId===v.id)html+='<tr><td colspan="17" class="profile">'+renderFullProfile(v)+'</td></tr>';});
    html+='</tbody></table>';const target=document.getElementById('databaseTable');if(target)target.innerHTML=rows.length?html:'<p class="muted">No volunteers match the current query.</p>';
  }
  function wireDatabaseControls(){installBooleanQueryUi();const search=document.getElementById('searchBox');if(search&&!search.dataset.booleanQueryBound){search.dataset.booleanQueryBound='true';search.addEventListener('input',renderDatabase);}ensureQuerySortOptions();const sort=document.getElementById('sortSelect');if(sort&&!sort.dataset.booleanQueryBound){sort.dataset.booleanQueryBound='true';sort.addEventListener('change',renderDatabase);}const clear=document.getElementById('clearDatabaseQuery');if(clear&&!clear.dataset.booleanQueryBound){clear.dataset.booleanQueryBound='true';clear.addEventListener('click',clearDatabaseQuery);}const builder=document.getElementById('queryBuilder');if(builder&&!builder.dataset.booleanQueryBound){builder.dataset.booleanQueryBound='true';builder.addEventListener('click',handleBuilderClick);builder.addEventListener('change',handleBuilderChange);builder.addEventListener('input',handleBuilderInput);}renderQueryBuilder();}

  window.wireDatabaseControls=wireDatabaseControls;
  window.renderDatabase=renderDatabase;
  window.getFilteredVolunteers=getFilteredVolunteers;
  window.updateDatabaseMatchCount=updateDatabaseMatchCount;
  window.clearDatabaseFilters=clearDatabaseQuery;
  window.volunteerHasCapturedAttendance=volunteerHasCapturedAttendance;
  window.centralDatabaseQuery={getRoot:function(){return databaseQueryRoot;},evaluate:function(volunteer,node){return evaluateQueryNode(volunteer,node||databaseQueryRoot);},newCondition:newCondition,newGroup:newGroup};
})();
