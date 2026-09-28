import { supabase } from '../../lib/supabase';

export interface ResolutionCandidate {
  core_volunteer_id:string;
  volunteer_code:string;
  name:string;
  email:string|null;
  phone:string|null;
}

function safe(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function searchResolutionCandidates(search:string){
  const term=safe(search);
  if(term.length<2)return[] as ResolutionCandidate[];
  const{data,error}=await supabase
    .from('maklom_volunteer_search_directory')
    .select('core_volunteer_id,volunteer_code,name,email,phone')
    .ilike('search_text',`%${term}%`)
    .order('name')
    .limit(8);
  if(error)throw error;
  return(data||[]) as ResolutionCandidate[];
}

export async function fetchAttendanceResolutionRosterId(attendanceId:string){
  const sessionId=attendanceId.startsWith('keluarga:')?attendanceId.slice('keluarga:'.length):attendanceId;
  const{data,error}=await supabase
    .from('phaseone_attendance_sessions')
    .select('origin_roster_id')
    .eq('id',sessionId)
    .maybeSingle();
  if(error)throw error;
  if(!data?.origin_roster_id)throw new Error('Attendance roster identity could not be loaded.');
  return data.origin_roster_id as string;
}

export async function fetchResolutionRosterContext(rosterId:string){
  const{data,error}=await supabase
    .from('phaseone_roster')
    .select('id,volunteer_name,email,mobile')
    .eq('id',rosterId)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Roster identity could not be loaded.');
  return data as {id:string;volunteer_name:string;email:string|null;mobile:string|null};
}

export async function fetchInboxResolutionRosterId(sourceKind:'insight'|'review',sourceRecordId:string){
  const table=sourceKind==='review'?'phaseone_volunteer_reviews':'phaseone_volunteer_insights';
  const{data,error}=await supabase.from(table).select('roster_id').eq('id',sourceRecordId).maybeSingle();
  if(error)throw error;
  if(!data?.roster_id)throw new Error('Source roster identity could not be loaded.');
  return data.roster_id as string;
}

export async function resolveVolunteer(input:{
  rosterId:string;
  existingCoreVolunteerId?:string|null;
  createName?:string|null;
  createEmail?:string|null;
  createPhone?:string|null;
}){
  const{data,error}=await supabase.rpc('maklom_resolve_roster_volunteer',{
    p_roster_id:input.rosterId,
    p_existing_core_volunteer_id:input.existingCoreVolunteerId||null,
    p_create_name:input.createName||null,
    p_create_email:input.createEmail||null,
    p_create_phone:input.createPhone||null,
  });
  if(error)throw error;
  return data as {
    core_volunteer_id:string;
    profile_id:string;
    volunteer_code:string;
    display_name:string;
    created:boolean;
    roster_rows_linked:number;
    inbox_rows_linked:number;
  };
}
