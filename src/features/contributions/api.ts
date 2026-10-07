import { supabase } from '../../lib/supabase';
import type { ContributionAuditRow, ContributionStatus } from '../../lib/types';

export type ContributionReviewEvent = {
  id:string;
  title:string;
  venue:string|null;
  reporting_at:string;
  pending_count:number;
};

export type ContributionSheetShift = {
  id:string;
  event_id:string;
  label:string|null;
  starts_at:string;
  ends_at:string;
  status:string;
  sort_order:number;
};

export type ContributionSheetRowStatus='attended'|'checked_in'|'no_record'|'withdrawn'|'absent';

export type ContributionSheetRow = {
  roster_id:string;
  volunteer_id:string|null;
  volunteer_name:string;
  volunteer_code:string|null;
  email:string|null;
  mobile:string|null;
  timeslot_id:string;
  attendance_person_key:string|null;
  status:ContributionSheetRowStatus;
  sign_in_at:string|null;
  sign_out_at:string|null;
  session_id:string|null;
  session_origin_roster_id:string|null;
  contribution_id:string|null;
  operational_minutes:number|null;
  approved_minutes:number|null;
  contribution_status:ContributionStatus|null;
  approval_note:string|null;
  contribution_updated_at:string|null;
  shared_shift_count:number;
  shared_shift_labels:string[];
};

export type ContributionEventSheet = {
  event:{
    id:string;
    title:string;
    venue:string|null;
    reporting_at:string;
  };
  shifts:ContributionSheetShift[];
  rows:ContributionSheetRow[];
};

type RawRoster = {
  id:string;
  event_id:string;
  volunteer_id:string|null;
  volunteer_key:string|null;
  volunteer_name:string;
  email:string|null;
  mobile:string|null;
  timeslot_id:string;
  attendance_person_key:string|null;
};

type RawAttendanceState = {
  roster_id:string;
  signed_in_at:string|null;
  signed_out_at:string|null;
  non_attendance_status:string|null;
};

type RawSession = {
  id:string;
  event_id:string;
  attendance_date:string;
  person_key:string;
  origin_roster_id:string;
  checked_in_at:string;
  checked_out_at:string|null;
  updated_at:string;
};

type RawContribution = {
  id:string;
  volunteer_id:string;
  event_id:string;
  attendance_session_id:string;
  operational_minutes:number;
  approved_minutes:number|null;
  status:ContributionStatus;
  approval_note:string|null;
  approved_at:string|null;
  updated_at:string;
};

function overlapMs(session:RawSession,shift:ContributionSheetShift){
  const sessionStart=Date.parse(session.checked_in_at);
  const sessionEnd=session.checked_out_at?Date.parse(session.checked_out_at):Date.now();
  const shiftStart=Date.parse(shift.starts_at);
  const shiftEnd=Date.parse(shift.ends_at);
  if(!Number.isFinite(sessionStart)||!Number.isFinite(sessionEnd)||!Number.isFinite(shiftStart)||!Number.isFinite(shiftEnd))return 0;
  return Math.max(0,Math.min(sessionEnd,shiftEnd)-Math.max(sessionStart,shiftStart));
}

export async function fetchContributionReviewEvents():Promise<ContributionReviewEvent[]>{
  const [eventsRes,pendingRes]=await Promise.all([
    supabase
      .from('phaseone_events')
      .select('id,title,venue,reporting_at,operations_scope')
      .eq('operations_scope','canonical')
      .order('reporting_at',{ascending:false})
      .limit(250),
    supabase
      .from('volunteer_contributions')
      .select('event_id,status')
      .in('status',['pending','needs_review'])
      .limit(10000),
  ]);
  if(eventsRes.error)throw eventsRes.error;
  if(pendingRes.error)throw pendingRes.error;
  const counts=new Map<string,number>();
  for(const row of pendingRes.data||[])counts.set(row.event_id,(counts.get(row.event_id)||0)+1);
  return (eventsRes.data||[]).map((event)=>({
    id:event.id,
    title:event.title,
    venue:event.venue,
    reporting_at:event.reporting_at,
    pending_count:counts.get(event.id)||0,
  }));
}

export async function fetchContributionEventSheet(eventId:string):Promise<ContributionEventSheet>{
  const [eventRes,shiftsRes,rosterRes,effectiveRes,sessionsRes,contributionsRes]=await Promise.all([
    supabase
      .from('phaseone_events')
      .select('id,title,venue,reporting_at')
      .eq('id',eventId)
      .maybeSingle(),
    supabase
      .from('phaseone_event_timeslots')
      .select('id,event_id,label,starts_at,ends_at,status,sort_order')
      .eq('event_id',eventId)
      .order('sort_order')
      .order('starts_at'),
    supabase
      .from('phaseone_roster')
      .select('id,event_id,volunteer_id,volunteer_key,volunteer_name,email,mobile,timeslot_id,attendance_person_key')
      .eq('event_id',eventId)
      .or('source_assignment_status.is.null,source_assignment_status.neq.invalidated_historical_shift_match')
      .limit(10000),
    supabase
      .from('phaseone_attendance')
      .select('roster_id,signed_in_at,signed_out_at,non_attendance_status')
      .eq('event_id',eventId)
      .limit(10000),
    supabase
      .from('phaseone_attendance_sessions')
      .select('id,event_id,attendance_date,person_key,origin_roster_id,checked_in_at,checked_out_at,updated_at')
      .eq('event_id',eventId)
      .limit(10000),
    supabase
      .from('volunteer_contributions')
      .select('id,volunteer_id,event_id,attendance_session_id,operational_minutes,approved_minutes,status,approval_note,approved_at,updated_at')
      .eq('event_id',eventId)
      .limit(10000),
  ]);

  if(eventRes.error)throw eventRes.error;
  if(!eventRes.data)throw new Error('Event not found.');
  if(shiftsRes.error)throw shiftsRes.error;
  if(rosterRes.error)throw rosterRes.error;
  if(effectiveRes.error)throw effectiveRes.error;
  if(sessionsRes.error)throw sessionsRes.error;
  if(contributionsRes.error)throw contributionsRes.error;

  const shifts=(shiftsRes.data||[]) as ContributionSheetShift[];
  const shiftById=new Map(shifts.map((shift)=>[shift.id,shift]));
  const roster=(rosterRes.data||[]) as RawRoster[];
  const attendanceByRoster=new Map(((effectiveRes.data||[]) as RawAttendanceState[]).map((row)=>[row.roster_id,row]));
  const sessions=(sessionsRes.data||[]) as RawSession[];
  const sessionById=new Map(sessions.map((session)=>[session.id,session]));
  const sessionsByPerson=new Map<string,RawSession[]>();
  for(const session of sessions){
    const current=sessionsByPerson.get(session.person_key)||[];
    current.push(session);
    sessionsByPerson.set(session.person_key,current);
  }
  const contributionBySession=new Map(((contributionsRes.data||[]) as RawContribution[]).map((row)=>[row.attendance_session_id,row]));

  const rows:ContributionSheetRow[]=roster.flatMap((rosterRow)=>{
    const shift=shiftById.get(rosterRow.timeslot_id);
    if(!shift)return [];

    const attendance=attendanceByRoster.get(rosterRow.id)||null;
    const nonAttendance=attendance?.non_attendance_status==='withdrawn'||attendance?.non_attendance_status==='absent'
      ? attendance.non_attendance_status
      : null;

    let session:RawSession|null=null;
    if(!session&&!nonAttendance&&rosterRow.attendance_person_key){
      const candidates=(sessionsByPerson.get(rosterRow.attendance_person_key)||[])
        .map((candidate)=>({candidate,overlap:overlapMs(candidate,shift)}))
        .filter((entry)=>entry.overlap>0)
        .sort((a,b)=>b.overlap-a.overlap||Date.parse(a.candidate.checked_in_at)-Date.parse(b.candidate.checked_in_at));
      session=candidates[0]?.candidate||null;
    }

    let status:ContributionSheetRowStatus='no_record';
    if(nonAttendance==='withdrawn')status='withdrawn';
    else if(nonAttendance==='absent')status='absent';
    else if(session?.checked_out_at)status='attended';
    else if(session?.checked_in_at)status='checked_in';
    else if(Date.parse(shift.ends_at)<Date.now())status='absent';

    const contribution=session?contributionBySession.get(session.id)||null:null;

    let sharedShiftCount=0;
    const sharedShiftLabels:string[]=[];
    if(session&&rosterRow.attendance_person_key){
      for(const candidateRoster of roster){
        if(candidateRoster.attendance_person_key!==rosterRow.attendance_person_key)continue;
        const candidateShift=shiftById.get(candidateRoster.timeslot_id);
        if(!candidateShift||overlapMs(session,candidateShift)<=0)continue;
        sharedShiftCount+=1;
        const label=candidateShift.label?.trim()||'Shift';
        if(!sharedShiftLabels.includes(label))sharedShiftLabels.push(label);
      }
    }

    return [{
      roster_id:rosterRow.id,
      volunteer_id:rosterRow.volunteer_id,
      volunteer_name:rosterRow.volunteer_name,
      volunteer_code:rosterRow.volunteer_key,
      email:rosterRow.email,
      mobile:rosterRow.mobile,
      timeslot_id:rosterRow.timeslot_id,
      attendance_person_key:rosterRow.attendance_person_key,
      status,
      sign_in_at:session?.checked_in_at||attendance?.signed_in_at||null,
      sign_out_at:session?.checked_out_at||attendance?.signed_out_at||null,
      session_id:session?.id||null,
      session_origin_roster_id:session?.origin_roster_id||null,
      contribution_id:contribution?.id||null,
      operational_minutes:contribution?.operational_minutes??(session?.checked_out_at
        ? Math.max(0,Math.floor((Date.parse(session.checked_out_at)-Date.parse(session.checked_in_at))/60000))
        : null),
      approved_minutes:contribution?.approved_minutes??null,
      contribution_status:contribution?.status??null,
      approval_note:contribution?.approval_note??null,
      contribution_updated_at:contribution?.updated_at??null,
      shared_shift_count:sharedShiftCount,
      shared_shift_labels:sharedShiftLabels,
    }];
  });

  return{
    event:eventRes.data,
    shifts,
    rows,
  };
}

export async function bulkApproveContributions(input:{
  eventId:string;
  items:Array<{id:string;approved_minutes:number;expected_updated_at:string}>;
  note:string;
}){
  const{data,error}=await supabase.rpc('maklom_bulk_approve_contributions',{
    p_event_id:input.eventId,
    p_items:input.items,
    p_note:input.note,
  });
  if(error)throw error;
  return data as {event_id:string;approved_count:number};
}

export async function setContributionReviewStatus(input:{
  id:string;
  status:Extract<ContributionStatus,'needs_review'|'rejected'>;
  note:string|null;
}){
  const{data,error}=await supabase
    .from('volunteer_contributions')
    .update({
      status:input.status,
      approved_minutes:null,
      approval_note:input.note,
    })
    .eq('id',input.id)
    .select('id')
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Contribution could not be updated.');
}

export async function fetchContributionAudit(contributionId:string){
  const{data,error}=await supabase
    .from('volunteer_contribution_audit')
    .select('*')
    .eq('contribution_id',contributionId)
    .order('changed_at',{ascending:false});
  if(error)throw error;
  return(data||[]) as ContributionAuditRow[];
}
