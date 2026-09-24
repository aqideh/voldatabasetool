import { supabase } from '../../lib/supabase';
import type { AttendanceReconciliation, FormImportBatch, FormSubmission, VolunteerRow } from '../../lib/types';
import { hashString, lower } from '../../lib/utils';

type ParsedSubmission = {
  id: string;
  type: 'sign_in' | 'sign_out';
  responseId: string;
  fileName: string;
  submittedAt: string;
  submittedDate: string;
  name: string;
  email: string;
  phone: string;
  eventName: string;
  shirtQuantity: number;
  shirtSize: string;
  feedback: Record<string, string | number | null>;
  raw: Record<string,string>;
};

function parseCsv(text: string) {
  const rows: string[][]=[];let row:string[]=[];let field='';let quoted=false;
  const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  return rows;
}

function headerIndex(rows:string[][]){return rows.findIndex((r)=>r?.[0]?.trim()==='Response ID'&&r.includes('Timestamp'));}

function parseTimestamp(value:string){
  const s=value.trim();
  const match=s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+([AP]M)$/i);
  if(!match) throw new Error(`Invalid FormSG timestamp: ${value}`);
  const months:Record<string,number>={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const month=months[match[2].toLowerCase()]; let hour=Number(match[4]);
  if(match[7].toUpperCase()==='PM'&&hour!==12)hour+=12;if(match[7].toUpperCase()==='AM'&&hour===12)hour=0;
  const pad=(n:number)=>String(n).padStart(2,'0');
  const date=`${match[3]}-${pad(month)}-${pad(Number(match[1]))}`;
  const iso=`${date}T${pad(hour)}:${match[5]}:${match[6]}+08:00`;
  return {date,iso,ms:Date.parse(iso)};
}

function objects(rows:string[][],hi:number){
  const headers=rows[hi].map((h)=>h.trim());
  return rows.slice(hi+1).filter((r)=>r.some((v)=>v.trim())).map((r)=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}

function findHeader(headers:string[],fragment:string){return headers.find((h)=>lower(h).includes(fragment))||'';}

export function parseSignIn(text:string,fileName:string):ParsedSubmission[]{
  const rows=parseCsv(text),hi=headerIndex(rows);if(hi<0)throw new Error('Could not find the sign-in FormSG header row.');
  const headers=rows[hi].map((h)=>h.trim());
  const required=['Response ID','Timestamp','Full Name','Email Address','Phone Number','Event Deployed For:'];
  const missing=required.filter((h)=>!headers.includes(h));if(missing.length)throw new Error(`Sign-in CSV missing: ${missing.join(', ')}`);
  return objects(rows,hi).map((raw)=>{
    const t=parseTimestamp(raw.Timestamp);
    return{id:`form_in_${String(raw['Response ID']).replace(/[^A-Za-z0-9_-]/g,'')}`,type:'sign_in',responseId:raw['Response ID'].trim(),fileName,submittedAt:t.iso,submittedDate:t.date,name:raw['Full Name'].trim(),email:raw['Email Address'].trim(),phone:raw['Phone Number'].trim(),eventName:raw['Event Deployed For:'].trim(),shirtQuantity:Math.max(0,Number(raw['Number of Shirts Collected']||0)||0),shirtSize:String(raw['Shirt Size']||'').trim(),feedback:{},raw};
  });
}

export function parseSignOut(text:string,fileName:string):ParsedSubmission[]{
  const rows=parseCsv(text),hi=headerIndex(rows);if(hi<0)throw new Error('Could not find the sign-out FormSG header row.');
  const headers=rows[hi].map((h)=>h.trim());
  const required=['Response ID','Timestamp','Full Name','Email Address','Phone Number','Event Deployed For:'];
  const missing=required.filter((h)=>!headers.includes(h));if(missing.length)throw new Error(`Sign-out CSV missing: ${missing.join(', ')}`);
  const age=findHeader(headers,'age group'),gender=findHeader(headers,'gender'),tenure=findHeader(headers,'how long have you been volunteering'),frequency=findHeader(headers,'how frequently do you volunteer'),briefing=findHeader(headers,'thorough briefing'),onboarding=findHeader(headers,'onboarding process'),role=findHeader(headers,'satisfied with the assigned role'),support=findHeader(headers,'approachable and supportive'),improvement=findHeader(headers,'improve your volunteer experience'),recommend=findHeader(headers,'would you recommend volunteering'),referral=findHeader(headers,'interested in volunteering or referring');
  const rating=(v:string)=>{const n=Number(v);return Number.isFinite(n)&&n>=1&&n<=5?n:null;};
  return objects(rows,hi).map((raw)=>{
    const t=parseTimestamp(raw.Timestamp);
    return{id:`form_out_${String(raw['Response ID']).replace(/[^A-Za-z0-9_-]/g,'')}`,type:'sign_out',responseId:raw['Response ID'].trim(),fileName,submittedAt:t.iso,submittedDate:t.date,name:raw['Full Name'].trim(),email:raw['Email Address'].trim(),phone:raw['Phone Number'].trim(),eventName:raw['Event Deployed For:'].trim(),shirtQuantity:0,shirtSize:'',feedback:{ageGroup:raw[age]||'',gender:raw[gender]||'',tenure:raw[tenure]||'',frequency:raw[frequency]||'',briefing:rating(raw[briefing]||''),onboarding:rating(raw[onboarding]||''),roleSatisfaction:rating(raw[role]||''),staffSupport:rating(raw[support]||''),improvement:raw[improvement]||'',recommend:raw[recommend]||'',referralEmail:raw[referral]||''},raw};
  });
}

function phone(value:string){const d=value.replace(/\D/g,'');return d.length>8?d.slice(-8):d;}
function name(value:string){return lower(value).replace(/\b(binte|binti|bin|bt)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function identity(a:ParsedSubmission,b:ParsedSubmission){if(a.email&&b.email&&lower(a.email)===lower(b.email))return 100;if(a.phone&&b.phone&&phone(a.phone)===phone(b.phone))return 95;if(name(a.name)===name(b.name))return 70;return 0;}

export async function importFormAttendance(signIns:ParsedSubmission[],signOuts:ParsedSubmission[]) {
  const [existingSubmissions, volunteersRes] = await Promise.all([
    supabase.from('form_submissions').select('id'),
    supabase.from('volunteers').select('id,name,email,phone'),
  ]);
  if(existingSubmissions.error)throw existingSubmissions.error;if(volunteersRes.error)throw volunteersRes.error;
  const existing=new Set((existingSubmissions.data||[]).map((r)=>r.id));
  const ins=signIns.filter((r)=>!existing.has(r.id)); const outs=signOuts.filter((r)=>!existing.has(r.id));
  if(!ins.length&&!outs.length)return{imported:0,sessions:0,warnings:0,skipped:signIns.length+signOuts.length};
  const ids=[...ins,...outs].map((r)=>r.id).sort();const batchId=`batch_${hashString(ids.join('|'))}`;
  const usedOut=new Set<string>();const sessions:any[]=[];
  for(const signin of ins){
    const candidates=outs.filter((out)=>!usedOut.has(out.id)&&identity(signin,out)>=70&&Date.parse(out.submittedAt)>=Date.parse(signin.submittedAt)&&Date.parse(out.submittedAt)-Date.parse(signin.submittedAt)<=30*60*60*1000)
      .sort((a,b)=>identity(signin,b)-identity(signin,a)||Date.parse(a.submittedAt)-Date.parse(b.submittedAt));
    const out=candidates[0]||null;if(out)usedOut.add(out.id);
    sessions.push(makeSession(signin,out,volunteersRes.data||[],batchId));
  }
  outs.filter((out)=>!usedOut.has(out.id)).forEach((out)=>sessions.push(makeSession(null,out,volunteersRes.data||[],batchId)));
  const warningCount=sessions.filter((s)=>s.review_flags.length).length;
  const batch={id:batchId,sign_in_filename:ins[0]?.fileName||null,sign_out_filename:outs[0]?.fileName||null,sign_in_count:ins.length,sign_out_count:outs.length,status:'pending_sync',warning_count:warningCount,completed_at:null};
  const {error:bErr}=await supabase.from('form_import_batches').upsert(batch);if(bErr)throw bErr;
  const submissions=[...ins,...outs].map((row)=>({...serializeSubmission(row),batch_id:batchId}));
  if(submissions.length){const{error}=await supabase.from('form_submissions').upsert(submissions,{onConflict:'id',ignoreDuplicates:true});if(error)throw error;}
  if(sessions.length){const{error}=await supabase.from('attendance_reconciliations').upsert(sessions,{onConflict:'id'});if(error)throw error;}
  const batchCurrent=(await supabase.from('form_import_batches').select('row_version').eq('id',batchId).single()).data;
  const {error:cErr}=await supabase.from('form_import_batches').update({status:'committed',completed_at:new Date().toISOString()}).eq('id',batchId).eq('row_version',batchCurrent?.row_version||1);if(cErr)throw cErr;
  return{imported:ins.length+outs.length,sessions:sessions.length,warnings:warningCount,skipped:(signIns.length+signOuts.length)-(ins.length+outs.length)};
}

function makeSession(signIn:ParsedSubmission|null,signOut:ParsedSubmission|null,volunteers:any[],batchId:string){
  const source=signIn||signOut!;const flags:string[]=[];if(!signIn)flags.push('missing_sign_in');if(!signOut)flags.push('missing_sign_out');if(signIn&&signOut&&lower(signIn.eventName)!==lower(signOut.eventName))flags.push('event_mismatch');
  const calculated=signIn&&signOut?Math.max(0,Math.round((Date.parse(signOut.submittedAt)-Date.parse(signIn.submittedAt))/60000)):null;if(calculated!=null&&calculated>600)flags.push('long_duration');
  let matched:any=null;
  if(source.email)matched=volunteers.find((v)=>lower(v.email)===lower(source.email));if(!matched&&source.phone)matched=volunteers.find((v)=>phone(v.phone||'')===phone(source.phone));if(!matched)matched=volunteers.find((v)=>name(v.name)===name(source.name));
  if(!matched)flags.push('volunteer_unmatched');
  return{id:`rec_${hashString(`${signIn?.id||''}|${signOut?.id||''}`)}`,batch_id:batchId,volunteer_id:matched?.id||null,sign_in_submission_id:signIn?.id||null,sign_out_submission_id:signOut?.id||null,event_name:source.eventName||'Unknown event',event_date:source.submittedDate,sign_in_at:signIn?.submittedAt||null,sign_out_at:signOut?.submittedAt||null,calculated_duration_minutes:calculated,staff_credited_duration_minutes:null,staff_credit_note:null,match_status:!signIn?'missing_sign_in':!signOut?'missing_sign_out':'matched',match_confidence:matched?100:0,match_reason:matched?'identity match':'no volunteer match',review_flags:flags,included:true,review_acknowledged:flags.length===0};
}

function serializeSubmission(r:ParsedSubmission){
  const f=r.feedback;
  return{id:r.id,batch_id:'',submission_type:r.type,source_response_id:r.responseId,source_file_name:r.fileName||null,submitted_at:r.submittedAt,submitted_date:r.submittedDate,full_name:r.name,email:r.email||null,phone:r.phone||null,event_name:r.eventName,shirt_quantity:r.type==='sign_in'?r.shirtQuantity:0,shirt_size:r.type==='sign_in'?(r.shirtSize||null):null,age_group:r.type==='sign_out'?String(f.ageGroup||'')||null:null,gender:r.type==='sign_out'?String(f.gender||'')||null:null,volunteer_tenure:r.type==='sign_out'?String(f.tenure||'')||null:null,volunteer_frequency:r.type==='sign_out'?String(f.frequency||'')||null:null,briefing_rating:r.type==='sign_out'?f.briefing:null,onboarding_rating:r.type==='sign_out'?f.onboarding:null,role_satisfaction_rating:r.type==='sign_out'?f.roleSatisfaction:null,staff_support_rating:r.type==='sign_out'?f.staffSupport:null,improvement_feedback:r.type==='sign_out'?String(f.improvement||'')||null:null,recommendation:r.type==='sign_out'?String(f.recommend||'')||null:null,referral_email:r.type==='sign_out'?String(f.referralEmail||'')||null:null,raw_payload:r.raw};
}

export async function fetchFormAttendance() {
  const [batches, submissions, recs] = await Promise.all([
    supabase.from('form_import_batches').select('*').eq('status','committed').order('created_at',{ascending:false}),
    supabase.from('form_submissions').select('*'),
    supabase.from('attendance_reconciliations').select('*').order('event_date',{ascending:false}),
  ]);
  if(batches.error)throw batches.error;if(submissions.error)throw submissions.error;if(recs.error)throw recs.error;
  return{batches:(batches.data||[]) as FormImportBatch[],submissions:(submissions.data||[]) as FormSubmission[],reconciliations:(recs.data||[]) as AttendanceReconciliation[]};
}

export async function updateReconciliation(row:AttendanceReconciliation,patch:Partial<AttendanceReconciliation>){
  const{data,error}=await supabase.from('attendance_reconciliations').update(patch).eq('id',row.id).eq('row_version',row.row_version).select('*').maybeSingle();if(error)throw error;if(!data)throw new Error('This entry changed in another session.');return data as AttendanceReconciliation;
}

export async function deleteReconciliation(row:AttendanceReconciliation){
  const{data,error}=await supabase.from('attendance_reconciliations').delete().eq('id',row.id).eq('row_version',row.row_version).select('id').maybeSingle();if(error)throw error;if(!data)throw new Error('This entry changed in another session.');
}
