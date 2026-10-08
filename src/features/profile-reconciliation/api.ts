import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';

export type ReconciliationMatchStatus='needs_confirmation'|'confirmed'|'rejected';
export type ReconciliationChangeStatus='pending'|'approved'|'rejected'|'stale';

export interface ReconciliationBatch {
  id:string;
  source_filename:string;
  source_row_count:number;
  matched_row_count:number;
  unmatched_row_count:number;
  conflict_row_count:number;
  pending_match_count:number;
  change_count:number;
  status:'staged'|'completed'|'cancelled';
  created_at:string;
  updated_at:string;
}

export interface ReconciliationChange {
  id:string;
  row_id:string;
  target_scope:'maklom_profile'|'private_details';
  field_name:string;
  source_label:string;
  source_value:string|null;
  old_value:string|null;
  proposed_value:string;
  transformation:string|null;
  status:ReconciliationChangeStatus;
  reviewed_at:string|null;
  review_note:string|null;
}

export interface ReconciliationRow {
  id:string;
  batch_id:string;
  source_row_number:number;
  source_record_id:string|null;
  source_volunteer_code:string|null;
  source_name:string|null;
  source_email:string|null;
  source_mobile:string|null;
  maklom_volunteer_id:string;
  core_volunteer_id:string;
  target_volunteer_code:string;
  target_name_at_stage:string;
  target_email_at_stage:string|null;
  target_mobile_at_stage:string|null;
  match_method:'legacy_code_alias'|'email_mobile'|'email'|'mobile';
  match_status:ReconciliationMatchStatus;
  match_reason:string;
  source_warnings:string[];
  confirmed_at:string|null;
  match_review_note:string|null;
  maklom_profile_reconciliation_changes:ReconciliationChange[];
}

interface CandidateChange {
  target_scope:'maklom_profile'|'private_details';
  field_name:string;
  source_label:string;
  source_value:string|null;
  proposed_value:string;
  transformation:string|null;
}

export interface CandidateRow {
  source_row_number:number;
  source_record_id:string|null;
  source_volunteer_code:string|null;
  source_name:string|null;
  source_email:string|null;
  source_mobile:string|null;
  warnings:string[];
  changes:CandidateChange[];
}

export interface ReconciliationPreview {
  sourceRows:number;
  candidateRows:number;
  prefilteredUnmatched:number;
  rows:CandidateRow[];
  allRows:CandidateRow[];
}

export interface StageResult {
  batch_id:string;
  source_rows:number;
  matched_rows:number;
  unmatched_rows:number;
  conflict_rows:number;
  pending_matches:number;
  changes:number;
}

interface MatchKeys { emails:string[]; mobiles:string[]; legacy_codes:string[]; }

const EMPTY_MARKERS=new Set(['','-','n.a.','n.a','na','nil','not applicable','n/a']);

function clean(value:unknown){
  if(value==null)return null;
  const text=String(value).trim();
  if(EMPTY_MARKERS.has(text.toLowerCase()))return null;
  return text||null;
}

function digits(value:unknown){return String(value??'').replace(/\D/g,'');}
function emailKey(value:unknown){return String(value??'').trim().toLowerCase();}
function codeKey(value:unknown){return String(value??'').trim().toUpperCase();}

function parseDate(value:unknown){
  let date:Date|null=null;
  if(value instanceof Date&&!Number.isNaN(value.getTime()))date=value;
  else{
    const text=clean(value);
    if(!text)return null;
    const match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(match){
      const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
      date=new Date(Date.UTC(year,month-1,day));
      if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
    }else if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
      const parsed=new Date(text+'T00:00:00Z');
      if(!Number.isNaN(parsed.getTime()))date=parsed;
    }
  }
  if(!date)return null;
  const year=date.getUTCFullYear();
  const currentYear=new Date().getUTCFullYear();
  if(year<1920||year>currentYear)return null;
  return [
    String(year).padStart(4,'0'),
    String(date.getUTCMonth()+1).padStart(2,'0'),
    String(date.getUTCDate()).padStart(2,'0'),
  ].join('-');
}

const QUALIFICATION_MAP:Record<string,string>={
  "bachelor's or equivalent":'bachelors',
  "master's and doctorate or equivalent":'postgraduate',
  "postgraduate diploma / certificate (excluding master's and doctorate)":'postgraduate',
  'polytechnic diploma':'diploma',
  'professional qualification and other diploma':'professional_certificate',
  'secondary':'secondary',
  'lower secondary':'secondary',
  'post-secondary (non-tertiary): general & vocation':'other',
  'primary':'primary',
  'no formal qualification / pre-primary / lower primary':'other',
};

function normalizeQualification(value:unknown){
  const source=clean(value);
  if(!source)return null;
  const proposed=QUALIFICATION_MAP[source.toLowerCase()];
  return proposed?{source,proposed}:null;
}

function joinLanguages(primary:unknown,secondary:unknown){
  const values=[clean(primary),clean(secondary)].filter((value):value is string=>!!value);
  const unique:string[]=[];
  for(const value of values){
    if(!unique.some((item)=>item.toLowerCase()===value.toLowerCase()))unique.push(value);
  }
  return unique.length?unique.join(', '):null;
}

function composeAddress(row:Record<string,unknown>){
  const floor=clean(row['Floor']);
  const unit=clean(row['Unit']);
  const parts=[
    clean(row['Block']),
    clean(row['Street Name']),
    clean(row['Building Name']),
    floor?'Floor '+floor:null,
    unit?'Unit '+unit:null,
    clean(row['Country']),
  ].filter((value):value is string=>!!value);
  return parts.length?parts.join(', '):null;
}

function pickInstitution(row:Record<string,unknown>,warnings:string[]){
  const candidates=[
    ['Current Educational Institution',clean(row['Current Educational Institution'])],
    ['Name of Institute',clean(row['Name of Institute'])],
    ['School Attended',clean(row['School Attended'])],
  ].filter((item):item is [string,string]=>!!item[1]);
  if(!candidates.length)return null;
  const distinct:Array<[string,string]>=[];
  for(const candidate of candidates){
    if(!distinct.some((item)=>item[1].toLowerCase()===candidate[1].toLowerCase()))distinct.push(candidate);
  }
  if(distinct.length>1){
    warnings.push('Multiple different education institutions are present; institution was not proposed automatically.');
    return null;
  }
  return distinct[0];
}

function addChange(changes:CandidateChange[],scope:CandidateChange['target_scope'],field:string,label:string,source:unknown,proposed:string|null,transformation:string|null=null){
  if(!proposed)return;
  changes.push({
    target_scope:scope,
    field_name:field,
    source_label:label,
    source_value:clean(source),
    proposed_value:proposed,
    transformation,
  });
}

function makeCandidate(source:Record<string,unknown>,rowNumber:number):CandidateRow{
  const warnings:string[]=[];
  const changes:CandidateChange[]=[];
  const sourceCode=clean(source['Volunteer Code']);
  const sourceName=clean(source['Full Name']);
  const sourceEmail=clean(source['Email']);
  const sourceMobile=clean(source['Mobile']);

  addChange(changes,'maklom_profile','name','Full Name',source['Full Name'],sourceName);
  addChange(changes,'maklom_profile','email','Email',source['Email'],sourceEmail);
  addChange(changes,'maklom_profile','phone','Mobile',source['Mobile'],sourceMobile);
  addChange(changes,'maklom_profile','gender','Sex',source['Sex'],clean(source['Sex']));

  const address=composeAddress(source);
  addChange(changes,'maklom_profile','address','Address fields',address,address,'Joined Block, Street Name, Building Name, Floor, Unit and Country in a fixed order.');

  const languages=joinLanguages(source['Primary Language'],source['Secondary Language']);
  addChange(changes,'maklom_profile','languages_spoken','Primary Language + Secondary Language',languages,languages,'Combined populated language fields; duplicate values removed case-insensitively.');

  addChange(changes,'maklom_profile','emergency_name','Emergency Contact Name',source['Emergency Contact Name'],clean(source['Emergency Contact Name']));
  addChange(changes,'maklom_profile','emergency_phone','Emergency Contact No',source['Emergency Contact No'],clean(source['Emergency Contact No']));
  addChange(changes,'maklom_profile','shirt_size','T-Shirt Size',source['T-Shirt Size'],clean(source['T-Shirt Size']));
  addChange(changes,'maklom_profile','dietary','Dietary Restriction',source['Dietary Restriction'],clean(source['Dietary Restriction']));

  const rawDob=clean(source['Date of Birth (dd/MM/yyyy)']);
  const dob=parseDate(source['Date of Birth (dd/MM/yyyy)']);
  if(rawDob&&!dob)warnings.push('Date of birth is invalid or outside the accepted 1920-present range; it was not proposed.');
  addChange(changes,'private_details','date_of_birth','Date of Birth (dd/MM/yyyy)',source['Date of Birth (dd/MM/yyyy)'],dob,'Validated and normalized to YYYY-MM-DD.');

  const postal=digits(source['PostalCode']);
  if(clean(source['PostalCode'])&&postal.length!==6)warnings.push('Postal code is not exactly six digits; it was not proposed.');
  addChange(changes,'private_details','postal_code','PostalCode',source['PostalCode'],postal.length===6?postal:null,'Non-digits removed; requires exactly six digits.');

  const qualificationSource=clean(source['Highest Education']);
  const qualification=normalizeQualification(source['Highest Education']);
  if(qualificationSource&&!qualification)warnings.push('Highest Education has no approved mapping; it was not proposed.');
  addChange(changes,'private_details','highest_qualification','Highest Education',source['Highest Education'],qualification?.proposed||null,qualification?'Fixed mapping from "'+qualification.source+'".':null);

  const institution=pickInstitution(source,warnings);
  addChange(changes,'private_details','institution',institution?.[0]||'Education institution',institution?.[1]||null,institution?.[1]||null,'Only proposed when the populated education-institution fields do not conflict.');

  return{
    source_row_number:rowNumber,
    source_record_id:clean(source['ID']),
    source_volunteer_code:sourceCode,
    source_name:sourceName,
    source_email:sourceEmail,
    source_mobile:sourceMobile,
    warnings,
    changes,
  };
}

export async function fetchReconciliationMatchKeys():Promise<MatchKeys>{
  const{data,error}=await (supabase as any).rpc('maklom_profile_reconciliation_match_keys');
  if(error)throw error;
  const value=(data||{}) as Partial<MatchKeys>;
  return{
    emails:Array.isArray(value.emails)?value.emails:[],
    mobiles:Array.isArray(value.mobiles)?value.mobiles:[],
    legacy_codes:Array.isArray(value.legacy_codes)?value.legacy_codes:[],
  };
}

export async function parseReconciliationWorkbook(file:File):Promise<ReconciliationPreview>{
  const keys=await fetchReconciliationMatchKeys();
  const emailSet=new Set(keys.emails.map((value)=>emailKey(value)).filter(Boolean));
  const mobileSet=new Set(keys.mobiles.map((value)=>digits(value)).filter(Boolean));
  const codeSet=new Set(keys.legacy_codes.map((value)=>codeKey(value)).filter(Boolean));

  const bytes=await file.arrayBuffer();
  const workbook=XLSX.read(bytes,{type:'array',cellDates:true});
  const sheetName=workbook.SheetNames.includes('Volunteer')?'Volunteer':workbook.SheetNames[0];
  if(!sheetName)throw new Error('The workbook has no worksheet.');
  const sheet=workbook.Sheets[sheetName];
  const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:true});
  if(!raw.length)throw new Error('The workbook contains no volunteer rows.');

  const first=raw[0]||{};
  const required=['Volunteer Code','Full Name','Email','Mobile'];
  const missing=required.filter((header)=>!(header in first));
  if(missing.length)throw new Error('Missing required column(s): '+missing.join(', '));

  const rows:CandidateRow[]=[];
  const allRows:CandidateRow[]=[];
  let prefilteredUnmatched=0;
  raw.forEach((source,index)=>{
    const candidate=makeCandidate(source,index+2);
    allRows.push(candidate);
    const email=emailKey(candidate.source_email);
    const mobile=digits(candidate.source_mobile);
    const code=codeKey(candidate.source_volunteer_code);
    const couldMatch=Boolean((code&&codeSet.has(code))||(email&&emailSet.has(email))||(mobile&&mobileSet.has(mobile)));
    if(couldMatch)rows.push(candidate);
    else prefilteredUnmatched+=1;
  });

  return{sourceRows:raw.length,candidateRows:rows.length,prefilteredUnmatched,rows,allRows};
}

export async function stageReconciliationWorkbook(file:File,preview:ReconciliationPreview,sourceFilename=file.name):Promise<StageResult>{
  const{data,error}=await (supabase as any).rpc('stage_maklom_profile_reconciliation',{
    p_source_filename:sourceFilename,
    p_source_row_count:preview.sourceRows,
    p_prefiltered_unmatched_count:preview.prefilteredUnmatched,
    p_rows:preview.rows,
  });
  if(error)throw error;
  return data as StageResult;
}

export async function fetchReconciliationBatches(){
  const{data,error}=await supabase.from('maklom_profile_reconciliation_batches').select('*').order('created_at',{ascending:false}).limit(50);
  if(error)throw error;
  return(data||[]) as ReconciliationBatch[];
}

export async function fetchReconciliationRows(batchId:string){
  const{data,error}=await supabase
    .from('maklom_profile_reconciliation_rows')
    .select('*,maklom_profile_reconciliation_changes(*)')
    .eq('batch_id',batchId)
    .order('source_row_number',{ascending:true});
  if(error)throw error;
  return(data||[]) as ReconciliationRow[];
}

export async function reviewReconciliationMatch(rowId:string,decision:'confirmed'|'rejected',note:string|null=null){
  const{data,error}=await (supabase as any).rpc('review_maklom_profile_reconciliation_match',{
    p_row_id:rowId,p_decision:decision,p_review_note:note,
  });
  if(error)throw error;
  return data;
}

export async function reviewReconciliationChange(changeId:string,decision:'approved'|'rejected',note:string|null=null){
  const{data,error}=await (supabase as any).rpc('review_maklom_profile_reconciliation_change',{
    p_change_id:changeId,p_decision:decision,p_review_note:note,
  });
  if(error)throw error;
  return data;
}
