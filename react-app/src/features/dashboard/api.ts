import { supabase } from '../../lib/supabase';

export interface DashboardSummary {
  volunteers: number;
  attendanceRows: number;
  events: number;
  shifts: number;
}

async function exactCount(table: string) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const [volunteers, attendanceRows, events, shifts] = await Promise.all([
    exactCount('volunteers'),
    exactCount('attendance_log'),
    exactCount('events'),
    exactCount('event_shifts'),
  ]);
  return { volunteers, attendanceRows, events, shifts };
}
