import { Button, Group, MultiSelect, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import type {
  VolunteerQueryCondition,
  VolunteerQueryGroup,
  VolunteerQueryNode,
  VolunteerSearchOptions,
} from './search-types';

type FieldKind='text'|'enum'|'set'|'number'|'date'|'activity'|'event';

interface FieldDefinition {
  value:string;
  label:string;
  kind:FieldKind;
  optionKey?:keyof VolunteerSearchOptions;
}

const FIELDS:FieldDefinition[]=[
  {value:'anyText',label:'Any searchable field',kind:'text'},
  {value:'name',label:'Name',kind:'text'},
  {value:'nric',label:'NRIC / FIN',kind:'text'},
  {value:'phone',label:'Phone',kind:'text'},
  {value:'email',label:'Email',kind:'text'},
  {value:'age',label:'Age (years)',kind:'number'},
  {value:'gender',label:'Gender',kind:'enum',optionKey:'genders'},
  {value:'address',label:'Address',kind:'text'},
  {value:'neighbourhood',label:'Neighbourhood',kind:'text'},
  {value:'planning_area',label:'Planning area',kind:'enum',optionKey:'planningAreas'},
  {value:'electoral_division',label:'GRC / SMC',kind:'enum',optionKey:'electoralDivisions'},
  {value:'recruited_year',label:'Recruited year',kind:'number'},
  {value:'chat_session',label:'Chat session',kind:'text'},
  {value:'chat_session_date',label:'Chat session date',kind:'date'},
  {value:'interests',label:'Interests / skills',kind:'text'},
  {value:'languages_spoken',label:'Languages spoken',kind:'text'},
  {value:'emergency_name',label:'Emergency contact name',kind:'text'},
  {value:'emergency_phone',label:'Emergency contact phone',kind:'text'},
  {value:'programmes_registered',label:'Programme',kind:'set',optionKey:'programmes'},
  {value:'tags',label:'Tags',kind:'set',optionKey:'tags'},
  {value:'shirt_size',label:'T-shirt size',kind:'enum',optionKey:'shirtSizes'},
  {value:'dietary',label:'Dietary requirements',kind:'text'},
  {value:'notes',label:'Notes',kind:'text'},
  {value:'total_hours',label:'Total credited hours',kind:'number'},
  {value:'attended_event_count',label:'Events attended',kind:'number'},
  {value:'registered_event_count',label:'Events registered',kind:'number'},
  {value:'events_last_90d',label:'Events in last 90 days',kind:'number'},
  {value:'first_event_date',label:'First participation',kind:'date'},
  {value:'last_active',label:'Last active',kind:'date'},
  {value:'activity',label:'Activity',kind:'activity'},
  {value:'attended_events',label:'Attended event',kind:'event',optionKey:'events'},
  {value:'registered_events',label:'Registered event',kind:'event',optionKey:'events'},
];

const OPERATORS:Record<FieldKind,{value:string;label:string}[]>={
  text:[
    {value:'contains',label:'contains'},{value:'notContains',label:'does not contain'},
    {value:'equals',label:'equals'},{value:'notEquals',label:'does not equal'},
    {value:'startsWith',label:'starts with'},{value:'isEmpty',label:'is empty'},
    {value:'isNotEmpty',label:'is not empty'},
  ],
  enum:[
    {value:'equals',label:'equals'},{value:'notEquals',label:'does not equal'},
    {value:'isEmpty',label:'is empty'},{value:'isNotEmpty',label:'is not empty'},
  ],
  set:[
    {value:'hasAny',label:'has any of'},{value:'hasAll',label:'has all of'},
    {value:'hasNone',label:'has none of'},{value:'isEmpty',label:'is empty'},
    {value:'isNotEmpty',label:'is not empty'},
  ],
  number:[
    {value:'eq',label:'='},{value:'ne',label:'!='},{value:'gt',label:'>'},
    {value:'gte',label:'>='},{value:'lt',label:'<'},{value:'lte',label:'<='},
    {value:'between',label:'between'},{value:'isEmpty',label:'is empty'},
    {value:'isNotEmpty',label:'is not empty'},
  ],
  date:[
    {value:'on',label:'is on'},{value:'before',label:'is before'},
    {value:'after',label:'is after'},{value:'between',label:'between'},
    {value:'isEmpty',label:'is empty'},{value:'isNotEmpty',label:'is not empty'},
  ],
  activity:[
    {value:'hasAttendance',label:'has attended an event'},
    {value:'noAttendance',label:'has not attended an event'},
    {value:'active90',label:'active in the last 90 days'},
  ],
  event:[
    {value:'attendedAny',label:'matches any selected event'},
    {value:'attendedAll',label:'matches all selected events'},
    {value:'attendedNone',label:'matches none of the selected events'},
  ],
};

let nodeCounter=0;
function nextId(prefix:string){nodeCounter+=1;return `${prefix}-${Date.now()}-${nodeCounter}`;}
function fieldDefinition(key:string){return FIELDS.find((item)=>item.value===key)||FIELDS[0];}
function defaultOperator(field:string){return OPERATORS[fieldDefinition(field).kind][0].value;}
function defaultValue(kind:FieldKind):string|string[]{return kind==='set'||kind==='event'?[]:'';}

export function newVolunteerCondition(field='anyText'):VolunteerQueryCondition {
  const definition=fieldDefinition(field);
  return {id:nextId('condition'),type:'condition',field,operator:defaultOperator(field),value:defaultValue(definition.kind)};
}
export function newVolunteerGroup():VolunteerQueryGroup {
  return {id:nextId('group'),type:'group',operator:'AND',children:[]};
}

function replaceNode(root:VolunteerQueryGroup,id:string,replacement:VolunteerQueryNode):VolunteerQueryGroup {
  if(root.id===id&&replacement.type==='group')return replacement;
  return {...root,children:root.children.map((child)=>{
    if(child.id===id)return replacement;
    return child.type==='group'?replaceNode(child,id,replacement):child;
  })};
}
function removeNode(root:VolunteerQueryGroup,id:string):VolunteerQueryGroup {
  return {...root,children:root.children.filter((child)=>child.id!==id).map((child)=>child.type==='group'?removeNode(child,id):child)};
}
function addChild(root:VolunteerQueryGroup,parentId:string,child:VolunteerQueryNode):VolunteerQueryGroup {
  if(root.id===parentId)return {...root,children:[...root.children,child]};
  return {...root,children:root.children.map((item)=>item.type==='group'?addChild(item,parentId,child):item)};
}

function ConditionEditor({
  condition,options,onChange,onRemove,
}:{
  condition:VolunteerQueryCondition;
  options:VolunteerSearchOptions;
  onChange:(condition:VolunteerQueryCondition)=>void;
  onRemove:()=>void;
}){
  const field=fieldDefinition(condition.field);
  const operators=OPERATORS[field.kind];
  const noValue=['isEmpty','isNotEmpty','hasAttendance','noAttendance','active90'].includes(condition.operator);
  const isRange=condition.operator==='between';
  const isMulti=field.kind==='set'||field.kind==='event';
  const optionData=field.optionKey?options[field.optionKey]:[];

  function changeField(value:string|null){
    const next=fieldDefinition(value||'anyText');
    onChange({...condition,field:next.value,operator:OPERATORS[next.kind][0].value,value:defaultValue(next.kind)});
  }

  return <Paper withBorder radius="md" p="sm">
    {condition.field==='age'?<Text size="xs" c="dimmed" mb="xs">Age today from date of birth where available; otherwise the latest age recorded by staff. Between includes both ages. Unknown ages do not match numeric conditions.</Text>:null}
    <Group align="flex-end" wrap="wrap">
      <Select label="Field" searchable data={FIELDS} value={condition.field} onChange={changeField} style={{minWidth:190,flex:1}}/>
      <Select label="Condition" data={operators} value={condition.operator} onChange={(value)=>onChange({...condition,operator:value||operators[0].value,value:value==='between'?['','']:defaultValue(field.kind)})} style={{minWidth:180,flex:1}}/>
      {!noValue&&isMulti?<MultiSelect label="Value" searchable clearable data={optionData} value={Array.isArray(condition.value)?condition.value:[]} onChange={(value)=>onChange({...condition,value})} style={{minWidth:240,flex:2}}/>:null}
      {!noValue&&!isMulti&&!isRange&&field.kind==='enum'?<Select label="Value" searchable clearable data={optionData} value={typeof condition.value==='string'?condition.value:''} onChange={(value)=>onChange({...condition,value:value||''})} style={{minWidth:180,flex:1}}/>:null}
      {!noValue&&!isMulti&&!isRange&&field.kind!=='enum'?<TextInput label="Value" type={field.kind==='date'?'date':field.kind==='number'?'number':'text'} value={typeof condition.value==='string'?condition.value:''} onChange={(event)=>onChange({...condition,value:event.currentTarget.value})} style={{minWidth:180,flex:1}}/>:null}
      {!noValue&&isRange?<Group gap="xs" style={{minWidth:280,flex:2}}>
        <TextInput label="From" type={field.kind==='date'?'date':'number'} value={Array.isArray(condition.value)?condition.value[0]||'':''} onChange={(event)=>onChange({...condition,value:[event.currentTarget.value,Array.isArray(condition.value)?condition.value[1]||'':'']})} style={{flex:1}}/>
        <TextInput label="To" type={field.kind==='date'?'date':'number'} value={Array.isArray(condition.value)?condition.value[1]||'':''} onChange={(event)=>onChange({...condition,value:[Array.isArray(condition.value)?condition.value[0]||'':'',event.currentTarget.value]})} style={{flex:1}}/>
      </Group>:null}
      <Button variant="subtle" color="red" onClick={onRemove}>Remove</Button>
    </Group>
  </Paper>;
}

function GroupEditor({
  group,root,options,onRootChange,isRoot=false,
}:{
  group:VolunteerQueryGroup;
  root:VolunteerQueryGroup;
  options:VolunteerSearchOptions;
  onRootChange:(next:VolunteerQueryGroup)=>void;
  isRoot?:boolean;
}){
  function updateNode(node:VolunteerQueryNode){onRootChange(replaceNode(root,node.id,node));}
  return <Paper withBorder radius="lg" p="md" bg={isRoot?undefined:'var(--mantine-color-gray-0)'}>
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={700}>{isRoot?'Match':'Group'}</Text>
          <Select size="xs" w={120} data={[{value:'AND',label:'ALL (AND)'},{value:'OR',label:'ANY (OR)'}]} value={group.operator} onChange={(value)=>updateNode({...group,operator:value==='OR'?'OR':'AND'})}/>
          <Text size="sm" c="dimmed">of these conditions</Text>
        </Group>
        {!isRoot?<Button size="xs" variant="subtle" color="red" onClick={()=>onRootChange(removeNode(root,group.id))}>Remove group</Button>:null}
      </Group>

      {group.children.length===0?<Text size="sm" c="dimmed">No advanced conditions. Quick search alone will be used.</Text>:null}
      {group.children.map((child)=>child.type==='condition'
        ?<ConditionEditor key={child.id} condition={child} options={options} onChange={updateNode} onRemove={()=>onRootChange(removeNode(root,child.id))}/>
        :<GroupEditor key={child.id} group={child} root={root} options={options} onRootChange={onRootChange}/>
      )}
      <Group gap="xs">
        <Button size="xs" variant="light" onClick={()=>onRootChange(addChild(root,group.id,newVolunteerCondition()))}>Add condition</Button>
        <Button size="xs" variant="default" onClick={()=>onRootChange(addChild(root,group.id,newVolunteerGroup()))}>Add group</Button>
      </Group>
    </Stack>
  </Paper>;
}

export function AdvancedVolunteerQueryBuilder({
  query,options,onChange,
}:{
  query:VolunteerQueryGroup;
  options:VolunteerSearchOptions;
  onChange:(next:VolunteerQueryGroup)=>void;
}){
  return <GroupEditor group={query} root={query} options={options} onRootChange={onChange} isRoot/>;
}
