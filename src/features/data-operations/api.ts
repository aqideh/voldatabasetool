import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import type { DuplicateRow, FormImportBatch, HistoricalAttendanceImportBatch, HistoricalAttendancePreviewRow } from '../../lib/types';
import { digits, hashString, lower, newId } from '../../lib/utils';

export async function fetchDuplicateCases() {
  const { data, error } = await supabase.from('suspected_duplicates').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as DuplicateRow[];
}

export async function updateDuplicateDecision(row: DuplicateRow, decision: DuplicateRow['decision']) {
  const { data, error } = await supabase.from('suspected_duplicates')
    .update({ decision })
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This duplicate case changed in another session.');
  return data as DuplicateRow;
}

export async function fetchFormImportBatches() {
  const { data, error } = await supabase.from('form_import_batches').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []) as FormImportBatch[];
}

export async function exportMaklomWorkbook() {
  const [volunteers, attendance, events, shifts, leads] = await Promise.all([
    supabase.from('maklom_volunteer_directory').select('volunteer_code,name,nric,phone,email,gender,address,recruited_year,chat_session,chat_session_date,interests,languages_spoken,programmes_registered,tags,emergency_name,emergency_phone,shirt_size,dietary,notes,updated_at').order('name'),
    supabase.from('attendance_log').select('*').order('event_date', { ascending: false }),
    supabase.from('events').select('*').order('start_date', { ascending: false }),
    supabase.from('event_shifts').select('*').order('shift_date', { ascending: false }),
    supabase.from('volunteer_leads').select('*').order('submitted_at', { ascending: false }),
  ]);
  for (const result of [volunteers, attendance, events, shifts, leads]) if (result.error) throw result.error;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(volunteers.data || []), 'Volunteers');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendance.data || []), 'Attendance');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(events.data || []), 'Events');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(shifts.data || []), 'Shifts');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leads.data || []), 'Volunteer Leads');
  XLSX.writeFile(workbook, `MakLom-export-${new Date().toISOString().slice(0,10)}.xlsx`);
}

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (quoted) {
      if (ch === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((v) => !v.trim())) rows.pop();
  if (!rows.length) return { headers: [] as string[], rows: [] as Array<Record<string,string>> };
  const headers = rows[0].map((v) => v.trim());
  return { headers, rows: rows.slice(1).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || '']))) };
}

const EVENT_HEADERS = ['event_title','event_venue','date','shift','shift_starts_at','shift_ends_at','volunteer_name','contact_number','email','attendance_status','checked_in_at','checked_out_at'];

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Record<string,string> = {};
  new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(date).forEach((part) => { if (part.type !== 'literal') parts[part.type] = part.value; });
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, dateObj: date };
}

export async function importEventReportCsv(file: File) {
  const parsed = parseCsv(await file.text());
  const missing = EVENT_HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missing.length) throw new Error(`Missing event report columns: ${missing.join(', ')}`);
  const rows = parsed.rows.filter((row) => Object.values(row).some((value) => value.trim()));
  if (!rows.length) throw new Error('The event report contains no data rows.');

  const [eventsRes, shiftsRes, volunteersRes, attendanceRes] = await Promise.all([
    supabase.from('events').select('*'),
    supabase.from('event_shifts').select('*'),
    supabase.from('volunteers').select('id,name,email,phone'),
    supabase.from('attendance_log').select('id,volunteer_id,name,email,contact,event_id,shift_id,row_version'),
  ]);
  for (const result of [eventsRes,shiftsRes,volunteersRes,attendanceRes]) if (result.error) throw result.error;
  const events: any[] = eventsRes.data || [];
  const shifts: any[] = shiftsRes.data || [];
  const volunteers: any[] = volunteersRes.data || [];
  const attendance: any[] = attendanceRes.data || [];
  const counters = { events:0, shifts:0, volunteers:0, attendance:0, skipped:0 };

  const grouped = new Map<string, Record<string,string>[]>();
  rows.forEach((row) => {
    const key = `${lower(row.event_title)}|${lower(row.event_venue)}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });

  for (const [eventKey, eventRows] of grouped.entries()) {
    const dates = eventRows.map((row) => row.date.trim()).filter(Boolean).sort();
    const start = dates[0]; const end = dates[dates.length - 1];
    const sample = eventRows[0];
    let event = events.find((item) => lower(item.name) === lower(sample.event_title) && item.start_date === start && item.end_date === end && (!sample.event_venue || lower(item.venue) === lower(sample.event_venue)));
    if (!event) {
      const payload = { id:`event_report_event_${hashString(eventKey+'|'+start+'|'+end)}`, name:sample.event_title.trim(), start_date:start, end_date:end, programme:null, venue:sample.event_venue.trim()||null, notes:`Created from event report CSV (${file.name}).`, status:'active' };
      const { data, error } = await supabase.from('events').insert(payload).select('*').single(); if(error) throw error; event=data;events.push(event);counters.events++;
    }
    const eventShiftMap = new Map<string, any>();
    for (const row of eventRows) {
      const shiftKey = `${row.date.trim()}|${lower(row.shift)}`;
      if (eventShiftMap.has(shiftKey)) continue;
      let shift = shifts.find((item) => item.event_id === event.id && item.shift_date === row.date.trim() && lower(item.name) === lower(row.shift));
      if (!shift) {
        const startParts=localDateTime(row.shift_starts_at); const endParts=localDateTime(row.shift_ends_at);
        const payload={id:`event_report_shift_${hashString(event.id+'|'+shiftKey)}`,event_id:event.id,name:row.shift.trim()||'General',shift_date:row.date.trim(),start_time:startParts?.time||null,end_time:endParts?.time||null,notes:'Created from event report CSV.'};
        const {data,error}=await supabase.from('event_shifts').insert(payload).select('*').single();if(error)throw error;shift=data;shifts.push(shift);counters.shifts++;
      }
      eventShiftMap.set(shiftKey,shift);
    }

    for (const row of eventRows) {
      const shift=eventShiftMap.get(`${row.date.trim()}|${lower(row.shift)}`);
      const identity=lower(row.email)||digits(row.contact_number)||lower(row.volunteer_name);
      if(!identity){counters.skipped++;continue;}
      let volunteer=volunteers.find((item)=>lower(item.email)===lower(row.email) && lower(row.email));
      if(!volunteer && digits(row.contact_number)) volunteer=volunteers.find((item)=>digits(item.phone)===digits(row.contact_number));
      if(!volunteer && !row.email && !row.contact_number) volunteer=volunteers.find((item)=>lower(item.name)===lower(row.volunteer_name));
      if(!volunteer){
        const {data,error}=await supabase.rpc('maklom_match_or_create_volunteer',{
          p_name:row.volunteer_name.trim()||'Unknown volunteer',
          p_email:row.email.trim()||null,
          p_phone:row.contact_number.trim()||null,
          p_recruited_year:new Date().getFullYear(),
          p_interests:null,
          p_tags:['Event report'],
          p_notes:'Created from attendance event report import. Update volunteer profile.',
          p_origin:'event_report'
        });
        if(error)throw error;
        const result=data as {status:string;profile_id:string;volunteer_code:string};
        volunteer={id:result.profile_id,name:row.volunteer_name.trim()||'Unknown volunteer',email:row.email.trim()||null,phone:row.contact_number.trim()||null,volunteer_code:result.volunteer_code};
        volunteers.push(volunteer);
        if(result.status==='created')counters.volunteers++;
      }

      const attendanceId=`event_report_att_${hashString([lower(row.event_title),row.date.trim(),lower(row.shift),identity].join('|'))}`;
      if(attendance.some((item)=>item.id===attendanceId)){counters.skipped++;continue;}
      if(attendance.some((item)=>item.event_id===event.id&&item.shift_id===shift.id&&(lower(item.email)===lower(row.email)&&lower(row.email) || digits(item.contact)===digits(row.contact_number)&&digits(row.contact_number)))){counters.skipped++;continue;}
      const status=lower(row.attendance_status);
      const attended=status==='checked_in'||status==='checked_out';
      const checkIn=row.checked_in_at?new Date(row.checked_in_at):null;
      const checkOut=row.checked_out_at?new Date(row.checked_out_at):null;
      const shiftStart=row.shift_starts_at?new Date(row.shift_starts_at):null;
      const shiftEnd=row.shift_ends_at?new Date(row.shift_ends_at):null;
      let minutes=0,signIn:string|null=null,signOut:string|null=null;
      if(status==='checked_out'&&checkIn&&checkOut&&shiftStart&&shiftEnd&&![checkIn,checkOut,shiftStart,shiftEnd].some((date)=>Number.isNaN(date.getTime()))){
        const startMs=Math.max(checkIn.getTime(),shiftStart.getTime()); const endMs=Math.min(checkOut.getTime(),shiftEnd.getTime());
        if(endMs>startMs){minutes=Math.round((endMs-startMs)/60000);signIn=new Date(startMs).toISOString();signOut=new Date(endMs).toISOString();}
      } else if(status==='checked_in'&&checkIn&&!Number.isNaN(checkIn.getTime())) signIn=checkIn.toISOString();
      const payload={id:attendanceId,volunteer_id:volunteer.id,name:row.volunteer_name.trim()||volunteer.name,email:row.email.trim()||null,contact:row.contact_number.trim()||null,attended,event_name:event.name,event_date:shift.shift_date,duration_minutes:minutes,sign_in_at:signIn,sign_out_at:signOut,calculated_duration_minutes:status==='checked_in'?null:minutes,staff_credited_duration_minutes:null,staff_credit_note:`Source status: ${status||'blank'}. Imported from event report CSV ${file.name}.`,event_id:event.id,shift_id:shift.id,shift_label:shift.name};
      const {data,error}=await supabase.from('attendance_log').insert(payload).select('*').single();if(error)throw error;attendance.push(data);counters.attendance++;
    }
  }
  return counters;
}


const HISTORICAL_ALIASES: Record<string,string[]> = {
  sourceVolunteerIdentifier:['volunteer_id','old_volunteer_id','legacy_volunteer_id','maklom_id','kel_id'],
  fullName:['name','full_name','volunteer_name','volunteer'],
  email:['email','email_address'],
  phone:['phone','mobile','contact','contact_number','mobile_number'],
  eventName:['event','event_name','activity','activity_name','programme_event'],
  eventDate:['date','event_date','activity_date'],
  role:['role','volunteer_role','deployment_role'],
  hours:['hours','duration_hours','credited_hours','volunteer_hours'],
  minutes:['minutes','duration_minutes','credited_minutes'],
  attended:['attended','attendance','attendance_status'],
};

function normalisedRecord(row:Record<string,unknown>){
  const out:Record<string,string>={};
  for(const [key,value] of Object.entries(row))out[String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_')]=String(value??'').trim();
  return out;
}
function pick(row:Record<string,string>,key:string){for(const alias of HISTORICAL_ALIASES[key]||[])if(row[alias])return row[alias];return'';}
function parseHistoricalDate(value:string){
  if(!value)return'';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const date=new Date(value);if(Number.isNaN(date.getTime()))return'';
  return date.toISOString().slice(0,10);
}
function parseAttendance(value:string){const v=lower(value);if(!v)return true;return !['no','n','false','0','absent','no-show','no show'].includes(v);}
function minutesFrom(row:Record<string,string>){
  const direct=Number(pick(row,'minutes'));if(Number.isFinite(direct)&&direct>=0)return Math.round(direct);
  const hours=Number(pick(row,'hours'));if(Number.isFinite(hours)&&hours>=0)return Math.round(hours*60);
  return 0;
}

export async function previewHistoricalAttendance(file:File):Promise<HistoricalAttendancePreviewRow[]>{
  const bytes=await file.arrayBuffer();
  const workbook=XLSX.read(bytes,{type:'array',cellDates:true});
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:''});
  if(!raw.length)throw new Error('The historical attendance file contains no data rows.');

  const [volunteerRes,existingRes]=await Promise.all([
    supabase.from('volunteers').select('id,core_volunteer_id,legacy_maklom_id,name,email,phone'),
    supabase.from('historical_attendance_import_rows').select('source_row_hash'),
  ]);
  if(volunteerRes.error)throw volunteerRes.error;if(existingRes.error)throw existingRes.error;
  const volunteers=volunteerRes.data||[];const existingHashes=new Set((existingRes.data||[]).map((r)=>r.source_row_hash));

  return raw.map((source,index)=>{
    const row=normalisedRecord(source);
    const sourceVolunteerIdentifier=pick(row,'sourceVolunteerIdentifier')||null;
    const fullName=pick(row,'fullName');const email=pick(row,'email')||null;const phone=pick(row,'phone')||null;
    const eventName=pick(row,'eventName');const eventDate=parseHistoricalDate(pick(row,'eventDate'));
    const volunteerRole=pick(row,'role')||null;const reportedMinutes=minutesFrom(row);const attended=parseAttendance(pick(row,'attended'));
    const sourceRowHash=hashString([lower(sourceVolunteerIdentifier),lower(fullName),lower(email),digits(phone),lower(eventName),eventDate,reportedMinutes,lower(volunteerRole),attended?'1':'0'].join('|'));
    const reviewFlags:string[]=[];

    let match=sourceVolunteerIdentifier?volunteers.find((v)=>v.id===sourceVolunteerIdentifier||v.legacy_maklom_id===sourceVolunteerIdentifier||String((v as any).volunteer_code||'')===sourceVolunteerIdentifier):undefined;
    let reason=match?'Matched legacy/profile identifier':null;
    if(!match&&email){
      const matches=volunteers.filter((v)=>lower(v.email)===lower(email));
      if(matches.length===1){match=matches[0];reason='Matched exact email';}
      else if(matches.length>1)reviewFlags.push('duplicate_email');
    }
    if(!match&&phone&&fullName){
      const matches=volunteers.filter((v)=>digits(v.phone)===digits(phone)&&lower(v.name)===lower(fullName));
      if(matches.length===1){match=matches[0];reason='Matched phone + name';}
      else if(matches.length>1)reviewFlags.push('duplicate_phone_name');
    }

    let matchStatus:HistoricalAttendancePreviewRow['matchStatus']='matched';
    if(existingHashes.has(sourceRowHash)){matchStatus='duplicate';reason='Historical row already imported';}
    else if(!fullName||!eventName||!eventDate){matchStatus='invalid';reason='Name, event and valid date are required';}
    else if(match){matchStatus='matched';}
    else if(email||phone){matchStatus='created';reason='Will create a canonical volunteer profile on confirmation';}
    else {matchStatus='needs_review';reason='No stable identifier available';reviewFlags.push('missing_email_phone');}

    return{sourceRowNumber:index+2,sourceVolunteerIdentifier,fullName,email,phone,eventName,eventDate,volunteerRole,reportedMinutes,attended,rawPayload:source,sourceRowHash,matchStatus,
      matchedVolunteerId:match?.id||null,matchedCoreVolunteerId:match?.core_volunteer_id||null,matchReason:reason,reviewFlags};
  });
}

export async function commitHistoricalAttendance(file:File,rows:HistoricalAttendancePreviewRow[]){
  const batchId=newId('hist_batch');
  const importable=rows.filter((r)=>r.matchStatus==='matched'||r.matchStatus==='created');
  const totals={matched:0,created:0,review:0,duplicate:0,imported:0,minutes:0};
  const {error:batchError}=await supabase.from('historical_attendance_import_batches').insert({
    id:batchId,source_filename:file.name,row_count:rows.length,status:'committed'
  });if(batchError)throw batchError;

  for(const row of rows){
    let volunteerId=row.matchedVolunteerId,coreId=row.matchedCoreVolunteerId,status=row.matchStatus,reason=row.matchReason;
    if(status==='created'){
      const {data,error}=await supabase.rpc('maklom_match_or_create_volunteer',{
        p_name:row.fullName,p_email:row.email,p_phone:row.phone,
        p_recruited_year:Number(row.eventDate.slice(0,4))||null,p_interests:null,
        p_tags:['Historical attendance'],p_notes:'Created from historical attendance import.',p_origin:'historical_import'
      });if(error)throw error;
      const result=data as {status:string;profile_id:string;core_volunteer_id:string};
      volunteerId=result.profile_id;coreId=result.core_volunteer_id;status=result.status==='created'?'created':'matched';reason=result.status==='created'?'Created during historical import':'Matched existing during confirmation';
    }
    let attendanceId:string|null=null;
    if((status==='matched'||status==='created')&&volunteerId){
      attendanceId=`hist_att_${row.sourceRowHash}`;
      const {error}=await supabase.from('attendance_log').insert({
        id:attendanceId,volunteer_id:volunteerId,name:row.fullName,email:row.email,contact:row.phone,
        attended:row.attended,event_name:row.eventName,event_date:row.eventDate,duration_minutes:row.reportedMinutes,
        calculated_duration_minutes:row.reportedMinutes,staff_credited_duration_minutes:row.reportedMinutes,
        staff_credit_note:`Historical attendance import: ${file.name}`,
        source_kind:'historical_import',historical_import_batch_id:batchId,historical_source_row_hash:row.sourceRowHash,
        volunteer_role:row.volunteerRole
      });if(error)throw error;
      totals.imported++;totals.minutes+=row.reportedMinutes;if(status==='created')totals.created++;else totals.matched++;
    }else if(status==='duplicate')totals.duplicate++;else totals.review++;

    const {error:rowError}=await supabase.from('historical_attendance_import_rows').insert({
      batch_id:batchId,source_row_number:row.sourceRowNumber,source_row_hash:row.sourceRowHash,
      source_volunteer_identifier:row.sourceVolunteerIdentifier,full_name:row.fullName,email:row.email,phone:row.phone,
      event_name:row.eventName,event_date:row.eventDate||'1900-01-01',volunteer_role:row.volunteerRole,reported_minutes:row.reportedMinutes,
      attended:row.attended,match_status:status,matched_volunteer_id:volunteerId,matched_core_volunteer_id:coreId,
      match_reason:reason,review_flags:row.reviewFlags,raw_payload:row.rawPayload,committed_attendance_id:attendanceId
    });if(rowError)throw rowError;
  }

  const {error:updateError}=await supabase.from('historical_attendance_import_batches').update({
    matched_count:totals.matched,created_volunteer_count:totals.created,review_count:totals.review,duplicate_count:totals.duplicate,
    imported_count:totals.imported,total_minutes:totals.minutes,status:totals.review?'partial':'committed',completed_at:new Date().toISOString()
  }).eq('id',batchId);if(updateError)throw updateError;
  return{batchId,...totals,rows:importable.length};
}

export async function fetchHistoricalAttendanceBatches(){
  const{data,error}=await supabase.from('historical_attendance_import_batches').select('*').order('created_at',{ascending:false}).limit(100);
  if(error)throw error;return(data||[]) as HistoricalAttendanceImportBatch[];
}
