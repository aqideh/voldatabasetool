import { supabase } from '../../lib/supabase';

export interface DashboardSummary {
  volunteers: number;
  leads: number;
  attendanceRows: number;
  attendedRows: number;
  creditedMinutes: number;
  events: number;
  shifts: number;
  openDuplicateCases: number;
}

async function exactCount(table: string, apply?: (query: any) => any) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const [volunteers, leads, attendanceRows, attendedRows, events, shifts, openDuplicateCases, attendance] = await Promise.all([
    exactCount('volunteers'),
    exactCount('volunteer_leads', (q) => q.not('status', 'in', '(converted,not_selected,withdrawn)')),
    exactCount('attendance_log'),
    exactCount('attendance_log', (q) => q.eq('attended', true)),
    exactCount('events', (q) => q.eq('status', 'active')),
    exactCount('event_shifts'),
    exactCount('suspected_duplicates', (q) => q.eq('decision', 'pending')),
    supabase.from('attendance_log').select('duration_minutes,calculated_duration_minutes,staff_credited_duration_minutes').eq('attended', true),
  ]);
  if (attendance.error) throw attendance.error;
  const creditedMinutes = (attendance.data || []).reduce((sum, row) =>
    sum + Number(row.staff_credited_duration_minutes ?? row.calculated_duration_minutes ?? row.duration_minutes ?? 0), 0);
  return { volunteers, leads, attendanceRows, attendedRows, creditedMinutes, events, shifts, openDuplicateCases };
}
