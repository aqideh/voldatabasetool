import { supabase } from '../../lib/supabase';
import type { EventImpactMetricRow, EventRow, EventShiftRow } from '../../lib/types';
import { newId } from '../../lib/utils';

export async function fetchEventsBundle() {
  const [events, shifts, metrics] = await Promise.all([
    supabase.from('events').select('*').order('start_date', { ascending: false }).order('name'),
    supabase.from('event_shifts').select('*').order('shift_date').order('start_time'),
    supabase.from('event_impact_metrics').select('*').order('label'),
  ]);
  if (events.error) throw events.error;
  if (shifts.error) throw shifts.error;
  if (metrics.error) throw metrics.error;
  return {
    events: (events.data || []) as EventRow[],
    shifts: (shifts.data || []) as EventShiftRow[],
    metrics: (metrics.data || []) as EventImpactMetricRow[],
  };
}

export async function createEvent(input: Omit<EventRow, 'id' | 'updated_at' | 'row_version'>) {
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
  return data as EventRow;
}

export async function updateEvent(row: EventRow, patch: Partial<EventRow>) {
  const { data, error } = await supabase.from('events')
    .update(patch)
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This event changed in another session. Refresh and try again.');
  return data as EventRow;
}

export async function deleteEvent(row: EventRow) {
  const { data, error } = await supabase.from('events')
    .delete()
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This event changed in another session. Refresh and try again.');
}

export async function createShift(eventId: string, input: Omit<EventShiftRow, 'id' | 'event_id' | 'row_version'>) {
  const { data, error } = await supabase.from('event_shifts').insert({
    id: newId('shift'),
    event_id: eventId,
    ...input,
  }).select('*').single();
  if (error) throw error;
  return data as EventShiftRow;
}

export async function deleteShift(row: EventShiftRow) {
  const { error } = await supabase.from('event_shifts').delete().eq('id', row.id).eq('row_version', row.row_version);
  if (error) throw error;
}

export async function createMetric(eventId: string, label: string, value: number, unit: string | null) {
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
