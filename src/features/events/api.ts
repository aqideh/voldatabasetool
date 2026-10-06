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
    const rosterRes = await supabase.from('phaseone_roster').select(
      'id,event_id,volunteer_name,email,mobile,timeslot_id,tshirt_size,entry_method,source_assignment_status,volunteer_link_status,dietary_requirements'
    ).eq('event_id', canonicalEventId).order('volunteer_name');
    if (rosterRes.error) throw rosterRes.error;
    roster = (rosterRes.data || []) as EventRosterDetailRow[];
  }

  let staged:HistoricalAttendanceImportRow[] = [];
  if (event.source !== 'keluarga') {
    const stagedRes = await supabase.from('historical_attendance_import_rows').select('*')
      .eq('matched_event_id', event.id)
      .order('source_row_number');
    if (stagedRes.error) throw stagedRes.error;
    staged = (stagedRes.data || []) as HistoricalAttendanceImportRow[];
  } else {
    const legacyRes = await supabase.from('events').select('id,name,start_date,end_date')
      .eq('start_date', event.start_date);
    if (legacyRes.error) throw legacyRes.error;
    const legacyIds = (legacyRes.data || [])
      .filter((legacy) => normalise(legacy.name) === normalise(event.name) && legacy.start_date === event.start_date)
      .map((legacy) => legacy.id);
    if (legacyIds.length) {
      const stagedRes = await supabase.from('historical_attendance_import_rows').select('*')
        .in('matched_event_id', legacyIds)
        .order('source_row_number');
      if (stagedRes.error) throw stagedRes.error;
      staged = (stagedRes.data || []) as HistoricalAttendanceImportRow[];
    }
  }

  return {
    roster,
    attendance:(attendanceRes.data || []) as AttendanceRow[],
    staged,
  };
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
