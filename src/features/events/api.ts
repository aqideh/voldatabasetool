import { supabase } from '../../lib/supabase';
import type { AttendanceRow, EventImpactMetricRow, EventRow, EventShiftRow, HistoricalAttendanceImportRow } from '../../lib/types';
import { newId } from '../../lib/utils';

type KeluargaEventRow = {
  id:string; title:string; reporting_at:string; venue:string|null; opportunity_category:string|null;
  opportunity_summary:string|null; opportunity_description:string|null; is_published:boolean; updated_at:string;
};

type KeluargaTimeslotRow = {
  id:string; event_id:string; label:string|null; starts_at:string; ends_at:string; status:string; sort_order:number;
};

export type EventRosterDetailRow = {
  id:string;
  event_id:string;
  volunteer_name:string;
  email:string|null;
  mobile:string|null;
  timeslot_id:string|null;
  tshirt_size:string|null;
  entry_method:string|null;
  source_assignment_status:string|null;
  volunteer_link_status:string|null;
  dietary_requirements:string|null;
  volunteer_id:string|null;
  row_version:number;
  override:null|{
    roster_id:string;
    event_id:string;
    contact_on_day:string|null;
    dietary_override:string|null;
    tshirt_size_override:string|null;
    note:string|null;
    updated_at:string;
    row_version:number;
  };
};

export type EventAuditEntry = {
  id:number;
  actor_user_id:string|null;
  action:string;
  target_type:string|null;
  target_id:string|null;
  metadata:Record<string,unknown>;
  occurred_at:string;
};

export type EventPeopleBundle = {
  roster:EventRosterDetailRow[];
  attendance:AttendanceRow[];
  staged:HistoricalAttendanceImportRow[];
};

function singaporeParts(value:string) {
  const shifted = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
}

function normalise(value:string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function eventIdentityTokens(value:string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\bready\s*set\s*learn\b/g, ' rsl ')
    .replace(/\breadysetlearn\b/g, ' rsl ')
    .replace(/\brsl\b/g, ' rsl ')
    .replace(/\bmaths?\s+explorer(?:\s+buddy)?\b/g, ' ')
    .replace(/\bcommunity\s+(?:club|centre|center)\b/g, ' cc ')
    .replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b/g, ' ')
    .replace(/\b\d{1,2}[\s,/-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,/-]+\d{2,4}\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...new Set(cleaned.split(' ').filter(Boolean))];
}

function eventIdentityKey(value:string) {
  return eventIdentityTokens(value).join(' ');
}

function eventNamesStronglyMatch(a:string,b:string) {
  const aTokens=eventIdentityTokens(a);
  const bTokens=eventIdentityTokens(b);
  if(!aTokens.length||!bTokens.length)return false;
  const bSet=new Set(bTokens);
  const overlap=aTokens.filter((token)=>bSet.has(token)).length;
  const shorter=Math.min(aTokens.length,bTokens.length);
  const longer=Math.max(aTokens.length,bTokens.length);
  return overlap>=3 && overlap/shorter>=0.7 && overlap/longer>=0.45;
}

export async function fetchEventsBundle() {
  const [events, shifts, metrics, keluargaEvents, keluargaTimeslots] = await Promise.all([
    supabase.from('events').select('*').order('start_date', { ascending: false }).order('name'),
    supabase.from('event_shifts').select('*').order('shift_date').order('start_time'),
    supabase.from('event_impact_metrics').select('*').order('label'),
    supabase.from('phaseone_events')
      .select('id,title,reporting_at,venue,opportunity_category,opportunity_summary,opportunity_description,is_published,updated_at')
      .eq('operations_scope', 'canonical')
      .order('reporting_at', { ascending: false }),
    supabase.from('phaseone_event_timeslots')
      .select('id,event_id,label,starts_at,ends_at,status,sort_order')
      .order('sort_order')
      .order('starts_at'),
  ]);
  if (events.error) throw events.error;
  if (shifts.error) throw shifts.error;
  if (metrics.error) throw metrics.error;
  if (keluargaEvents.error) throw keluargaEvents.error;
  if (keluargaTimeslots.error) throw keluargaTimeslots.error;

  const canonicalEvents = (keluargaEvents.data || []) as KeluargaEventRow[];
  const canonicalTimeslots = (keluargaTimeslots.data || []) as KeluargaTimeslotRow[];
  const timeslotsByEvent = new Map<string,KeluargaTimeslotRow[]>();
  for (const slot of canonicalTimeslots) {
    const list = timeslotsByEvent.get(slot.event_id) || [];
    list.push(slot);
    timeslotsByEvent.set(slot.event_id, list);
  }

  const projectedEvents:EventRow[] = canonicalEvents.map((event) => {
    const eventTimeslots = timeslotsByEvent.get(event.id) || [];
    const dates = eventTimeslots.flatMap((slot) => [singaporeParts(slot.starts_at).date, singaporeParts(slot.ends_at).date]).sort();
    const fallbackDate = singaporeParts(event.reporting_at).date;
    return {
      id: `keluarga:${event.id}`,
      name: event.title,
      start_date: dates[0] || fallbackDate,
      end_date: dates.at(-1) || fallbackDate,
      programme: event.opportunity_category || null,
      venue: event.venue || null,
      notes: event.opportunity_summary || event.opportunity_description || null,
      status: event.is_published ? 'active' : 'archived',
      updated_at: event.updated_at,
      row_version: 1,
      source: 'keluarga',
      keluarga_event_id: event.id,
    };
  });

  const canonicalKeys = new Set(projectedEvents.map((event) => `${normalise(event.name)}|${event.start_date}`));
  const projectedLegacyEvents = ((events.data || []) as EventRow[])
    .filter((event) => !event.keluarga_event_id && !canonicalKeys.has(`${normalise(event.name)}|${event.start_date}`))
    .map((event) => ({ ...event, source: 'maklom' as const }));

  const projectedShifts:EventShiftRow[] = canonicalTimeslots.map((slot) => {
    const start = singaporeParts(slot.starts_at);
    const end = singaporeParts(slot.ends_at);
    return {
      id: `keluarga:${slot.id}`,
      event_id: `keluarga:${slot.event_id}`,
      name: slot.label?.trim() || 'General',
      shift_date: start.date,
      start_time: start.time,
      end_time: end.time,
      notes: null,
      row_version: 1,
      source: 'keluarga',
      keluarga_timeslot_id: slot.id,
    };
  });

  const retainedLegacyEventIds = new Set(projectedLegacyEvents.map((event) => event.id));
  const projectedLegacyShifts = ((shifts.data || []) as EventShiftRow[])
    .filter((shift) => retainedLegacyEventIds.has(shift.event_id))
    .map((shift) => ({ ...shift, source: 'maklom' as const }));

  return {
    events: [...projectedEvents, ...projectedLegacyEvents].sort((a, b) =>
      b.start_date.localeCompare(a.start_date) || a.name.localeCompare(b.name)
    ),
    shifts: [...projectedShifts, ...projectedLegacyShifts],
    metrics: (metrics.data || []) as EventImpactMetricRow[],
  };
}

export async function fetchEventPeople(event: EventRow):Promise<EventPeopleBundle> {
  const canonicalEventId = event.source === 'keluarga'
    ? (event.keluarga_event_id || event.id.replace(/^keluarga:/, ''))
    : event.id;

  const attendanceRes = await supabase.from('maklom_attendance_feed').select(
    'id,volunteer_id,name,email,contact,attended,event_name,event_date,duration_minutes,sign_in_at,sign_out_at,calculated_duration_minutes,staff_credited_duration_minutes,staff_credit_note,event_id,shift_id,shift_label,row_version,record_source,contribution_status'
  ).eq('event_id', canonicalEventId).order('name');
  if (attendanceRes.error) throw attendanceRes.error;

  let roster:EventRosterDetailRow[] = [];
  if (event.source === 'keluarga') {
    const [rosterRes,overrideRes] = await Promise.all([
      supabase.from('phaseone_roster').select(
        'id,event_id,volunteer_name,email,mobile,timeslot_id,tshirt_size,entry_method,source_assignment_status,volunteer_link_status,dietary_requirements,volunteer_id,row_version'
      ).eq('event_id', canonicalEventId).order('volunteer_name'),
      supabase.from('phaseone_roster_operational_overrides').select(
        'roster_id,event_id,contact_on_day,dietary_override,tshirt_size_override,note,updated_at,row_version'
      ).eq('event_id', canonicalEventId),
    ]);
    if (rosterRes.error) throw rosterRes.error;
    if (overrideRes.error) throw overrideRes.error;
    const overrideByRoster = new Map((overrideRes.data||[]).map((row)=>[row.roster_id,row]));
    roster = (rosterRes.data || []).map((row)=>({
      ...row,
      override:overrideByRoster.get(row.id)||null,
    })) as EventRosterDetailRow[];
  }

  let staged:HistoricalAttendanceImportRow[] = [];
  if (event.source !== 'keluarga') {
    const stagedRes = await supabase.from('historical_attendance_import_rows').select('*')
      .eq('matched_event_id', event.id)
      .order('source_row_number');
    if (stagedRes.error) throw stagedRes.error;
    staged = (stagedRes.data || []) as HistoricalAttendanceImportRow[];
  } else {
    const legacyRes = await supabase.from('events').select('id,name,start_date,end_date,venue')
      .eq('start_date', event.start_date);
    if (legacyRes.error) throw legacyRes.error;

    const canonicalIdentity = [event.name,event.venue].filter(Boolean).join(' ');
    const canonicalKey = eventIdentityKey(canonicalIdentity);
    const legacyIds = (legacyRes.data || [])
      .filter((legacy) => {
        const legacyIdentity=[legacy.name,legacy.venue].filter(Boolean).join(' ');
        return legacy.start_date === event.start_date
          && (
            eventIdentityKey(legacyIdentity) === canonicalKey
            || eventNamesStronglyMatch(legacyIdentity,canonicalIdentity)
          );
      })
      .map((legacy) => legacy.id);

    const stagedRes = await supabase.from('historical_attendance_import_rows').select('*')
      .gte('event_date', event.start_date)
      .lte('event_date', event.end_date)
      .order('source_row_number');
    if (stagedRes.error) throw stagedRes.error;

    staged = ((stagedRes.data || []) as HistoricalAttendanceImportRow[])
      .filter((row) => {
        if (row.matched_keluarga_event_id === canonicalEventId) return true;
        if (row.matched_keluarga_event_id) return false;
        if (row.matched_event_id && legacyIds.includes(row.matched_event_id)) return true;
        if (row.matched_event_id) return false;
        return eventIdentityKey(row.event_name) === canonicalKey
          || eventNamesStronglyMatch(row.event_name,canonicalIdentity);
      });
  }

  return {
    roster,
    attendance:(attendanceRes.data || []) as AttendanceRow[],
    staged,
  };
}

export async function reviewStagedAttendance(input:{
  rowId:string;
  expectedVersion:number;
  decision:'accept'|'reject';
  keluargaEventId:string;
  keluargaTimeslotId:string|null;
  targetCoreVolunteerId:string|null;
  reasonNote:string|null;
}) {
  const {data,error}=await supabase.rpc('maklom_event_review_staged_attendance',{
    p_row_id:input.rowId,
    p_expected_version:input.expectedVersion,
    p_decision:input.decision,
    p_keluarga_event_id:input.keluargaEventId,
    p_keluarga_timeslot_id:input.keluargaTimeslotId,
    p_target_core_volunteer_id:input.targetCoreVolunteerId,
    p_reason_note:input.reasonNote,
  });
  if(error)throw error;
  return data as Record<string,unknown>;
}

export async function addExistingVolunteerToEventRoster(input:{
  eventId:string;
  timeslotId:string;
  volunteerId:string;
}) {
  const {data,error}=await supabase.rpc('maklom_event_add_existing_volunteer_to_roster',{
    p_event_id:input.eventId,
    p_timeslot_id:input.timeslotId,
    p_volunteer_id:input.volunteerId,
  });
  if(error)throw error;
  return data as Record<string,unknown>;
}

export async function preRegisterStagedIdentity(rowId:string,expectedVersion:number) {
  const {data,error}=await supabase.rpc('maklom_event_pre_register_staged_identity',{
    p_row_id:rowId,
    p_expected_version:expectedVersion,
  });
  if(error)throw error;
  return data as Record<string,unknown>;
}

export async function setRosterOperationalOverride(input:{
  rosterId:string;
  expectedRosterVersion:number;
  expectedOverrideVersion:number;
  contactOnDay:string|null;
  dietaryOverride:string|null;
  tshirtSizeOverride:string|null;
  note:string|null;
  reasonCode:string;
  reasonNote:string;
}) {
  const {data,error}=await supabase.rpc('maklom_event_set_roster_override',{
    p_roster_id:input.rosterId,
    p_expected_roster_version:input.expectedRosterVersion,
    p_expected_override_version:input.expectedOverrideVersion,
    p_contact_on_day:input.contactOnDay,
    p_dietary_override:input.dietaryOverride,
    p_tshirt_size_override:input.tshirtSizeOverride,
    p_note:input.note,
    p_reason_code:input.reasonCode,
    p_reason_note:input.reasonNote,
  });
  if(error)throw error;
  return data as Record<string,unknown>;
}

export async function correctEventAttendance(input:{
  sessionId:string;
  expectedVersion:number;
  checkedInAt:string;
  checkedOutAt:string|null;
  reasonCode:string;
  reasonNote:string;
  creditAction:'unchanged'|'approve'|'needs_review'|'reject';
  approvedMinutes:number|null;
  approvalNote:string|null;
}) {
  const {data,error}=await supabase.rpc('maklom_event_correct_attendance',{
    p_session_id:input.sessionId,
    p_expected_version:input.expectedVersion,
    p_checked_in_at:input.checkedInAt,
    p_checked_out_at:input.checkedOutAt,
    p_reason_code:input.reasonCode,
    p_reason_note:input.reasonNote,
    p_credit_action:input.creditAction,
    p_approved_minutes:input.approvedMinutes,
    p_approval_note:input.approvalNote,
  });
  if(error)throw error;
  return data as Record<string,unknown>;
}

export async function fetchEventAudit(event:EventRow) {
  if(event.source!=='keluarga')return [] as EventAuditEntry[];
  const eventId=event.keluarga_event_id||event.id.replace(/^keluarga:/,'');
  const {data,error}=await supabase.rpc('maklom_event_audit',{p_event_id:eventId});
  if(error)throw error;
  return (Array.isArray(data)?data:[]) as EventAuditEntry[];
}

export async function createEvent(input: Omit<EventRow, 'id' | 'updated_at' | 'row_version' | 'source' | 'keluarga_event_id'>) {
  const id = newId('event');
  const { data, error } = await supabase.from('events').insert({ id, ...input }).select('*').single();
  if (error) throw error;
  if (input.start_date === input.end_date) {
    const { error: shiftError } = await supabase.from('event_shifts').insert({
      id: newId('shift'),
      event_id: id,
      name: 'General',
      shift_date: input.start_date,
      start_time: null,
      end_time: null,
      notes: null,
    });
    if (shiftError) throw shiftError;
  }
  return { ...(data as EventRow), source: 'maklom' as const };
}

export async function updateEvent(row: EventRow, patch: Partial<EventRow>) {
  if (row.source === 'keluarga') throw new Error('Keluarga events are managed in Keluarga MENDAKI.');
  const { data, error } = await supabase.from('events')
    .update(patch)
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This event changed in another session. Refresh and try again.');
  return { ...(data as EventRow), source: 'maklom' as const };
}

export async function deleteEvent(row: EventRow) {
  if (row.source === 'keluarga') throw new Error('Keluarga events are managed in Keluarga MENDAKI.');
  const { data, error } = await supabase.from('events')
    .delete()
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This event changed in another session. Refresh and try again.');
}

export async function createShift(eventId: string, input: Omit<EventShiftRow, 'id' | 'event_id' | 'row_version' | 'source' | 'keluarga_timeslot_id'>) {
  if (eventId.startsWith('keluarga:')) throw new Error('Keluarga shifts are managed in Keluarga MENDAKI.');
  const { data, error } = await supabase.from('event_shifts').insert({
    id: newId('shift'),
    event_id: eventId,
    ...input,
  }).select('*').single();
  if (error) throw error;
  return { ...(data as EventShiftRow), source: 'maklom' as const };
}

export async function deleteShift(row: EventShiftRow) {
  if (row.source === 'keluarga') throw new Error('Keluarga shifts are managed in Keluarga MENDAKI.');
  const { error } = await supabase.from('event_shifts').delete().eq('id', row.id).eq('row_version', row.row_version);
  if (error) throw error;
}

export async function createMetric(eventId: string, label: string, value: number, unit: string | null) {
  if (eventId.startsWith('keluarga:')) throw new Error('Impact metrics for Keluarga events are not stored in the legacy MakLom event table.');
  const { data, error } = await supabase.from('event_impact_metrics').insert({
    id: newId('metric'),
    event_id: eventId,
    label,
    value,
    unit,
  }).select('*').single();
  if (error) throw error;
  return data as EventImpactMetricRow;
}

export async function deleteMetric(row: EventImpactMetricRow) {
  const { error } = await supabase.from('event_impact_metrics').delete().eq('id', row.id).eq('row_version', row.row_version);
  if (error) throw error;
}
