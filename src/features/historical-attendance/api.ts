import * as XLSX from 'xlsx';

import { supabase } from '../../lib/supabase';
import type {
  HistoricalAttendanceContextEvent,
  HistoricalAttendanceContextShift,
  HistoricalAttendanceContextVolunteer,
  HistoricalAttendanceDecision,
  HistoricalAttendanceImportBatch,
  HistoricalAttendanceImportRow,
  HistoricalAttendanceMatchStatus,
} from '../../lib/types';
import { lower } from '../../lib/utils';

type RawRow = Record<string, unknown>;

type ParsedWorkbookRow = {
  sourceRowNumber:number;
  name:string;
  email:string;
  phone:string;
  eventName:string;
  eventDate:string|null;
  signInAt:string|null;
  responseId:string|null;
  volunteerRole:string|null;
  shirtQuantity:number;
  shirtSize:string|null;
  raw:RawRow;
};

type FeedbackRow = {
  sourceRowNumber:number;
  name:string;
  email:string;
  phone:string;
  eventName:string;
  submittedAt:string|null;
  raw:RawRow;
};

type PreviewRow = Omit<HistoricalAttendanceImportRow,
  'id'|'batch_id'|'committed_attendance_id'|'reviewed_at'|'reviewed_by'|'duplicate_of_attendance_id'|'row_version'
  |'matched_keluarga_event_id'|'matched_keluarga_timeslot_id'|'committed_keluarga_session_id'|'pending_identity_id'
  |'source_check_out_at'|'source_check_out_kind'|'paired_source_row_id'|'pair_role'
>;

type HistoricalContext = {
  volunteers:HistoricalAttendanceContextVolunteer[];
  events:HistoricalAttendanceContextEvent[];
  shifts:HistoricalAttendanceContextShift[];
};

function clean(value:unknown) {
  return String(value ?? '').trim();
}

function normaliseHeader(value:unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function normalisePhone(value:unknown) {
  const digits=clean(value).replace(/\D/g,'');
  return digits.length>8?digits.slice(-8):digits;
}

function normaliseName(value:unknown) {
  return lower(clean(value))
    .replace(/\b(binte|binti|bin|bt)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function normaliseEvent(value:unknown) {
  return lower(clean(value))
    .replace(/\braikan ilmu\b/g,'ri')
    .replace(/\bcommunity centre\b/g,'cc')
    .replace(/\bcommunity club\b/g,'cc')
    .replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b/g,' ')
    .replace(/\b\d{1,2}[\s/-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s/-]\d{2,4}\b/g,' ')
    .replace(/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{2,4}\b/g,' ')
    .replace(/\b(?:am|pm)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const monthNumbers:Record<string,number>={
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
};

function isoDate(year:number,month:number,day:number) {
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function eventDateFromText(value:string) {
  const short=value.match(/\b(\d{1,2})[\s/-]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s/-]+(\d{2,4})\b/i);
  if(short){
    let year=Number(short[3]); if(year<100)year+=2000;
    return isoDate(year,monthNumbers[short[2].toLowerCase()]||0,Number(short[1]));
  }
  const monthLong=value.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if(monthLong)return isoDate(Number(monthLong[3]),monthNumbers[monthLong[2].toLowerCase()]||0,Number(monthLong[1]));
  const dmy=value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if(dmy){
    let year=Number(dmy[3]); if(year<100)year+=2000;
    return isoDate(year,Number(dmy[2]),Number(dmy[1]));
  }
  return null;
}

function excelSerialParts(value:number) {
  const whole=Math.floor(value);
  const fraction=value-whole;
  const ms=Date.UTC(1899,11,30)+whole*86400000;
  const d=new Date(ms);
  const seconds=Math.round(fraction*86400);
  return {
    date:isoDate(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()),
    hour:Math.floor(seconds/3600)%24,
    minute:Math.floor(seconds/60)%60,
    second:seconds%60,
  };
}

function timeParts(value:unknown) {
  if(typeof value==='number'&&Number.isFinite(value)){
    const p=excelSerialParts(value);
    return {hour:p.hour,minute:p.minute,second:p.second,calendarDate:p.date};
  }
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return {hour:value.getUTCHours(),minute:value.getUTCMinutes(),second:value.getUTCSeconds(),calendarDate:isoDate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate())};
  }
  const text=clean(value);
  const twelve=text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\b/i);
  if(twelve){
    let hour=Number(twelve[1]);
    if(twelve[4].toUpperCase()==='PM'&&hour!==12)hour+=12;
    if(twelve[4].toUpperCase()==='AM'&&hour===12)hour=0;
    const textDate=eventDateFromText(text);
    return {hour,minute:Number(twelve[2]),second:Number(twelve[3]||0),calendarDate:textDate};
  }
  const twentyFour=text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  if(twentyFour)return {hour:Number(twentyFour[1]),minute:Number(twentyFour[2]),second:Number(twentyFour[3]||0),calendarDate:eventDateFromText(text)};
  return null;
}

function combineSingapore(date:string,time:{hour:number;minute:number;second:number}) {
  return `${date}T${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}:${String(time.second).padStart(2,'0')}+08:00`;
}

function findSheet(workbook:XLSX.WorkBook, fragments:string[]) {
  return workbook.SheetNames.find((name)=>fragments.every((fragment)=>lower(name).includes(fragment)))||null;
}

function rowsFromSheet(workbook:XLSX.WorkBook,sheetName:string) {
  const sheet=workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:''});
}

function headerIndex(rows:unknown[][]) {
  return rows.findIndex((row)=>{
    const headers=row.map(normaliseHeader);
    return headers.some((h)=>h.includes('timestamp'))
      && headers.some((h)=>h.includes('full name'))
      && headers.some((h)=>h.includes('event deployed'));
  });
}

function headerMap(row:unknown[]) {
  return row.map((value,index)=>({key:normaliseHeader(value),index}));
}

function headerPosition(headers:ReturnType<typeof headerMap>, fragments:string[]) {
  const found=headers.find((h)=>fragments.every((fragment)=>h.key.includes(fragment)));
  return found?.index ?? -1;
}

function valueAt(row:unknown[],index:number){return index>=0?row[index]:'';}

function parseSheetRows(workbook:XLSX.WorkBook,sheetName:string,feedback=false) {
  const rows=rowsFromSheet(workbook,sheetName);
  const hi=headerIndex(rows);
  if(hi<0)throw new Error(`Could not identify the FormSG header row in “${sheetName}”.`);
  const headers=headerMap(rows[hi]);
  const pos={
    response:headerPosition(headers,['response','id']),
    timestamp:headerPosition(headers,['timestamp']),
    name:headerPosition(headers,['full','name']),
    email:headerPosition(headers,['email','address']),
    phone:headerPosition(headers,['phone','number']),
    event:headerPosition(headers,['event','deployed']),
    shirtQuantity:headerPosition(headers,['number','shirts','collected']),
    shirtSize:headerPosition(headers,['shirt','size']),
    role:headerPosition(headers,['volunteer','role']),
  };
  if([pos.timestamp,pos.name,pos.event].some((n)=>n<0))throw new Error(`“${sheetName}” is missing a required timestamp, name, or event column.`);

  return rows.slice(hi+1).map((row,rowOffset)=>{
    const rowNumber=hi+2+rowOffset;
    const name=clean(valueAt(row,pos.name));
    const email=clean(valueAt(row,pos.email));
    const phone=clean(valueAt(row,pos.phone));
    const eventName=clean(valueAt(row,pos.event));
    const timestamp=valueAt(row,pos.timestamp);
    if(!name&&!email&&!phone&&!eventName&&!clean(timestamp))return null;
    const eventDate=eventDateFromText(eventName);
    const time=timeParts(timestamp);
    const submittedAt=eventDate&&time?combineSingapore(eventDate,time):null;
    const raw:Object=Object.fromEntries(headers.map((h)=>[clean(rows[hi][h.index])||`Column ${h.index+1}`,valueAt(row,h.index)]));
    if(feedback){
      return {
        sourceRowNumber:rowNumber,name,email,phone,eventName,
        submittedAt,raw:raw as RawRow,
      } satisfies FeedbackRow;
    }
    return {
      sourceRowNumber:rowNumber,name,email,phone,eventName,eventDate,signInAt:submittedAt,
      responseId:clean(valueAt(row,pos.response))||null,
      volunteerRole:clean(valueAt(row,pos.role))||null,
      shirtQuantity:Math.max(0,Number(valueAt(row,pos.shirtQuantity))||0),
      shirtSize:clean(valueAt(row,pos.shirtSize))||null,
      raw:raw as RawRow,
      timestampCalendarDate:time?.calendarDate??null,
    };
  }).filter(Boolean);
}

async function sha256(value:string|ArrayBuffer) {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function personKey(row:{email:string;phone:string;name:string}) {
  if(row.email)return `email:${lower(row.email)}`;
  const phone=normalisePhone(row.phone); if(phone)return `phone:${phone}`;
  return `name:${normaliseName(row.name)}`;
}

function identityCandidates(row:ParsedWorkbookRow,volunteers:HistoricalAttendanceContextVolunteer[]) {
  const email=lower(row.email), phone=normalisePhone(row.phone);
  const emailMatches=email?volunteers.filter((v)=>lower(v.email)===email):[];
  const phoneMatches=phone?volunteers.filter((v)=>normalisePhone(v.phone)===phone):[];
  const emailIds=new Set(emailMatches.map((v)=>v.id));
  const both=phoneMatches.filter((v)=>emailIds.has(v.id));
  if(email&&phone&&both.length===1)return {match:both[0],reason:'Exact email and mobile',flags:[] as string[]};
  if(emailMatches.length===1&&phoneMatches.length===1&&emailMatches[0].id!==phoneMatches[0].id)return {match:null,reason:'Email and mobile point to different volunteers',flags:['identity_conflict']};
  if(emailMatches.length===1){
    const flags=normaliseName(emailMatches[0].name)!==normaliseName(row.name)?['name_differs']:[];
    return {match:emailMatches[0],reason:'Exact email',flags};
  }
  if(phoneMatches.length===1){
    const flags=normaliseName(phoneMatches[0].name)!==normaliseName(row.name)?['name_differs']:[];
    return {match:phoneMatches[0],reason:'Exact mobile',flags};
  }
  if(emailMatches.length>1||phoneMatches.length>1)return {match:null,reason:'Identifier matches multiple volunteers',flags:['volunteer_ambiguous']};
  return {match:null,reason:'No existing volunteer matched email or mobile',flags:['volunteer_unmatched']};
}

function eventCandidates(row:ParsedWorkbookRow,events:HistoricalAttendanceContextEvent[]) {
  if(!row.eventDate)return {match:null,reason:'Event date could not be read from the source event label',flags:['event_date_missing']};
  const source=normaliseEvent(row.eventName);
  const dated=events.filter((e)=>e.start_date<=row.eventDate!&&e.end_date>=row.eventDate!);
  const scored=dated.map((event)=>{
    const target=normaliseEvent(event.name);
    let score=0;
    if(source===target)score=100;
    else if(source.includes(target)||target.includes(source))score=90;
    else{
      const a=new Set(source.split(' ').filter(Boolean)),b=new Set(target.split(' ').filter(Boolean));
      const overlap=[...a].filter((token)=>b.has(token)).length;
      score=Math.round(100*overlap/Math.max(a.size,b.size,1));
    }
    return {event,score};
  }).filter((x)=>x.score>=55).sort((a,b)=>b.score-a.score);
  if(scored.length===1||scored[0]?.score>=(scored[1]?.score??0)+20)return {match:scored[0]?.event??null,reason:scored[0]?`Canonical event match (${scored[0].score}%)`:'No canonical event matched',flags:scored[0]?[]:['event_unmatched']};
  if(scored.length>1)return {match:null,reason:'Multiple canonical events are plausible',flags:['event_ambiguous']};
  return {match:null,reason:'No canonical event matched name and date',flags:['event_unmatched']};
}

function shiftMatch(row:ParsedWorkbookRow,eventId:string|null,shifts:HistoricalAttendanceContextShift[]) {
  if(!eventId||!row.eventDate)return {match:null,flags:[] as string[]};
  const candidates=shifts.filter((s)=>s.event_id===eventId&&s.shift_date===row.eventDate);
  if(candidates.length===1)return {match:candidates[0],flags:[] as string[]};
  if(candidates.length===0)return {match:null,flags:[] as string[]};
  const source=lower(row.eventName);
  const period=source.match(/\b(am|pm)\b/)?.[1];
  if(period){
    const match=candidates.find((s)=>lower(s.name).includes(period));
    if(match)return {match,flags:[] as string[]};
  }
  const byName=candidates.filter((s)=>source.includes(lower(s.name)));
  if(byName.length===1)return {match:byName[0],flags:[] as string[]};
  return {match:null,flags:['shift_ambiguous']};
}

function feedbackFor(signIn:ParsedWorkbookRow,feedbackRows:FeedbackRow[]) {
  const email=lower(signIn.email),phone=normalisePhone(signIn.phone);
  const identity=feedbackRows.filter((f)=>
    (email&&lower(f.email)===email)||(phone&&normalisePhone(f.phone)===phone)
  );
  if(!identity.length)return {feedback:null,flags:['feedback_missing']};
  const sameEvent=identity.filter((f)=>normaliseEvent(f.eventName)===normaliseEvent(signIn.eventName));
  if(sameEvent.length===1)return {feedback:sameEvent[0],flags:[] as string[]};
  if(sameEvent.length>1)return {feedback:sameEvent[0],flags:['feedback_duplicate']};
  if(identity.length===1)return {feedback:identity[0],flags:['feedback_event_mismatch']};
  return {feedback:null,flags:['feedback_ambiguous']};
}

function isBlocking(flag:string) {
  return [
    'volunteer_unmatched','volunteer_ambiguous','identity_conflict','event_date_missing',
    'event_unmatched','event_ambiguous','shift_ambiguous','feedback_event_mismatch','feedback_ambiguous',
  ].includes(flag);
}

export async function fetchHistoricalContext():Promise<HistoricalContext> {
  const [volunteers,events,shifts]=await Promise.all([
    supabase.from('volunteers').select('id,core_volunteer_id,name,email,phone').limit(10000),
    supabase.from('events').select('id,name,start_date,end_date,venue').order('start_date',{ascending:false}),
    supabase.from('event_shifts').select('id,event_id,name,shift_date,start_time,end_time').order('shift_date',{ascending:false}),
  ]);
  if(volunteers.error)throw volunteers.error;if(events.error)throw events.error;if(shifts.error)throw shifts.error;
  return {
    volunteers:(volunteers.data||[]) as HistoricalAttendanceContextVolunteer[],
    events:(events.data||[]) as HistoricalAttendanceContextEvent[],
    shifts:(shifts.data||[]) as HistoricalAttendanceContextShift[],
  };
}

export async function previewHistoricalWorkbook(file:File,context?:HistoricalContext) {
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:'array',raw:true,cellDates:false});
  const signInSheet=findSheet(workbook,['sign','in'])||findSheet(workbook,['sign-in']);
  const feedbackSheet=findSheet(workbook,['feedback']);
  if(!signInSheet)throw new Error('This workbook does not contain a recognisable Sign-in Log sheet.');
  const signIns=parseSheetRows(workbook,signInSheet,false) as Array<ParsedWorkbookRow&{timestampCalendarDate:string|null}>;
  const feedback=feedbackSheet?(parseSheetRows(workbook,feedbackSheet,true) as FeedbackRow[]):[];
  const ctx=context||await fetchHistoricalContext();
  const fileHash=await sha256(buffer);

  const existingRows=await supabase.from('historical_attendance_import_rows').select('source_row_hash');
  if(existingRows.error)throw existingRows.error;
  const existingHashes=new Set((existingRows.data||[]).map((r)=>r.source_row_hash));

  const rows:PreviewRow[]=[];
  const logicalSeen=new Map<string,number>();

  for(const signIn of signIns){
    const volunteer=identityCandidates(signIn,ctx.volunteers);
    const event=eventCandidates(signIn,ctx.events);
    const shift=shiftMatch(signIn,event.match?.id??null,ctx.shifts);
    const feedbackMatch=feedbackFor(signIn,feedback);
    const flags=[...volunteer.flags,...event.flags,...shift.flags,...feedbackMatch.flags];
    if(signIn.timestampCalendarDate&&signIn.eventDate&&signIn.timestampCalendarDate!==signIn.eventDate)flags.push('timestamp_date_corrected');
    if(!signIn.signInAt)flags.push('sign_in_time_unreadable');
    if(!signIn.email&&!normalisePhone(signIn.phone))flags.push('identity_identifier_missing');

    const sourceRowHash=await sha256(JSON.stringify({
      responseId:signIn.responseId,
      name:normaliseName(signIn.name),
      email:lower(signIn.email),
      phone:normalisePhone(signIn.phone),
      event:normaliseEvent(signIn.eventName),
      eventDate:signIn.eventDate,
      signInAt:signIn.signInAt,
    }));

    let matchStatus:HistoricalAttendanceMatchStatus=flags.some(isBlocking)?'needs_review':'matched';
    let decision:HistoricalAttendanceDecision='pending';
    let matchReason=[volunteer.reason,event.reason].filter(Boolean).join(' · ');
    const sourcePeriod=lower(signIn.eventName).match(/\b(am|pm)\b/)?.[1]||'';
    const logicalKey=[
      volunteer.match?.id||personKey(signIn),
      event.match?.id||normaliseEvent(signIn.eventName),
      shift.match?.id||sourcePeriod||signIn.eventDate||'',
    ].join('|');

    if(existingHashes.has(sourceRowHash)){
      matchStatus='duplicate';decision='rejected';flags.push('already_imported');matchReason='Exact source row was imported previously';
    }else if(logicalSeen.has(logicalKey)&&volunteer.match&&event.match){
      matchStatus='duplicate';decision='rejected';flags.push('duplicate_in_workbook');matchReason=`Duplicate of source row ${logicalSeen.get(logicalKey)}`;
    }else logicalSeen.set(logicalKey,signIn.sourceRowNumber);

    if(!signIn.name||!signIn.eventName||!signIn.eventDate){
      matchStatus='invalid';decision='rejected';flags.push('source_row_incomplete');
    }

    rows.push({
      source_row_number:signIn.sourceRowNumber,
      source_row_hash:sourceRowHash,
      source_volunteer_identifier:signIn.responseId,
      full_name:signIn.name||'Unknown',
      email:signIn.email||null,
      phone:signIn.phone||null,
      event_name:signIn.eventName||'Unknown event',
      event_date:signIn.eventDate||'1970-01-01',
      volunteer_role:signIn.volunteerRole,
      reported_minutes:0,
      attended:true,
      match_status:matchStatus,
      matched_volunteer_id:volunteer.match?.id??null,
      matched_core_volunteer_id:volunteer.match?.core_volunteer_id??null,
      match_reason:matchReason||null,
      review_flags:[...new Set(flags)],
      raw_payload:signIn.raw,
      source_sign_in_at:signIn.signInAt,
      source_feedback_at:feedbackMatch.feedback?.submittedAt??null,
      matched_event_id:event.match?.id??null,
      matched_shift_id:shift.match?.id??null,
      feedback_payload:feedbackMatch.feedback?.raw??{},
      shirt_quantity:signIn.shirtQuantity,
      shirt_size:signIn.shirtSize,
      decision,
      decision_note:decision==='rejected'?matchReason||'Rejected during duplicate/validity checks':null,
    });
  }

  return {
    fileName:file.name,
    fileHash,
    signInCount:signIns.length,
    feedbackCount:feedback.length,
    rows,
    summary:{
      matched:rows.filter((r)=>r.match_status==='matched').length,
      review:rows.filter((r)=>r.match_status==='needs_review').length,
      duplicate:rows.filter((r)=>r.match_status==='duplicate').length,
      invalid:rows.filter((r)=>r.match_status==='invalid').length,
      withFeedback:rows.filter((r)=>Object.keys(r.feedback_payload).length>0).length,
    },
  };
}

export async function stageHistoricalWorkbook(file:File) {
  const preview=await previewHistoricalWorkbook(file);
  const prior=await supabase.from('historical_attendance_import_batches').select('id,status').eq('source_file_hash',preview.fileHash).maybeSingle();
  if(prior.error)throw prior.error;
  if(prior.data)return {batchId:prior.data.id,preview,duplicateFile:true};

  const batchId=`hist_batch_${preview.fileHash.slice(0,20)}`;
  const batch={
    id:batchId,source_filename:preview.fileName,source_file_hash:preview.fileHash,row_count:preview.rows.length,
    matched_count:preview.rows.filter((r)=>r.matched_volunteer_id).length,created_volunteer_count:0,
    review_count:preview.rows.filter((r)=>r.decision==='pending'&&r.match_status!=='matched').length,
    duplicate_count:preview.rows.filter((r)=>r.match_status==='duplicate').length,imported_count:0,total_minutes:0,status:'reviewing',
  };
  const {error:batchError}=await supabase.from('historical_attendance_import_batches').insert(batch);
  if(batchError)throw batchError;

  for(let i=0;i<preview.rows.length;i+=100){
    const chunk=preview.rows.slice(i,i+100).map((row,index)=>({
      id:`hist_row_${preview.fileHash.slice(0,12)}_${String(i+index+1).padStart(4,'0')}`,
      batch_id:batchId,...row,
    }));
    const {error}=await supabase.from('historical_attendance_import_rows').insert(chunk);
    if(error){
      await supabase.from('historical_attendance_import_batches').update({status:'failed'}).eq('id',batchId);
      throw error;
    }
  }
  return {batchId,preview,duplicateFile:false};
}

export async function fetchHistoricalAttendance(batchId?:string|null) {
  const batchesRes=await supabase.from('historical_attendance_import_batches').select('*').order('created_at',{ascending:false});
  if(batchesRes.error)throw batchesRes.error;
  const batches=(batchesRes.data||[]) as HistoricalAttendanceImportBatch[];
  const selected=batchId||batches[0]?.id||null;
  if(!selected)return {batches,rows:[] as HistoricalAttendanceImportRow[],selected:null};
  const rowsRes=await supabase.from('historical_attendance_import_rows').select('*').eq('batch_id',selected).order('source_row_number');
  if(rowsRes.error)throw rowsRes.error;
  return {batches,rows:(rowsRes.data||[]) as HistoricalAttendanceImportRow[],selected};
}

export async function fetchHistoricalAttendanceRowsByIds(rowIds:string[]) {
  if(!rowIds.length)return [] as HistoricalAttendanceImportRow[];
  const {data,error}=await supabase.from('historical_attendance_import_rows')
    .select('*')
    .in('id',rowIds)
    .eq('decision','pending')
    .order('event_date')
    .order('source_row_number');
  if(error)throw error;
  const rows=(data||[]) as HistoricalAttendanceImportRow[];
  const order=new Map(rowIds.map((id,index)=>[id,index]));
  return rows.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));
}

export async function createHistoricalVolunteerFromRow(input:{
  rowId:string;
  expectedVersion:number;
  name:string;
  email:string|null;
  phone:string|null;
}) {
  const {data,error}=await supabase.rpc('maklom_event_resolve_staged_identity',{
    p_row_id:input.rowId,
    p_expected_version:input.expectedVersion,
    p_existing_core_volunteer_id:null,
    p_create_new:true,
    p_name:input.name,
    p_email:input.email,
    p_phone:input.phone,
  });
  if(error)throw error;
  return data as {
    row_id:string;
    core_volunteer_id:string;
    profile_id:string|null;
    volunteer_code:string|null;
    display_name:string|null;
    email:string|null;
    phone:string|null;
    created:boolean;
  };
}

export async function updateHistoricalRow(row:HistoricalAttendanceImportRow,patch:Partial<HistoricalAttendanceImportRow>) {
  const {data,error}=await supabase.from('historical_attendance_import_rows')
    .update(patch).eq('id',row.id).eq('row_version',row.row_version).select('*').maybeSingle();
  if(error)throw error;if(!data)throw new Error('This row changed in another session. Refresh and review it again.');
  return data as HistoricalAttendanceImportRow;
}

export async function approveAllSafeHistoricalRows(batchId:string) {
  const {error}=await supabase.from('historical_attendance_import_rows').update({
    decision:'approved',decision_note:null,reviewed_at:new Date().toISOString(),
  }).eq('batch_id',batchId).eq('match_status','matched').eq('decision','pending');
  if(error)throw error;
}

export async function commitHistoricalBatch(batchId:string) {
  const {data,error}=await supabase.rpc('maklom_commit_historical_attendance_batch',{p_batch_id:batchId});
  if(error)throw error;
  return data as {batch_id:string;inserted:number;duplicates:number;pending:number;status:string};
}
