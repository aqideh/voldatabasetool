import { supabase } from '../../lib/supabase';
import type { AttendanceFilters, AttendanceRow } from '../../lib/types';

function safe(value: string) { return value.trim().replace(/[,%()]/g, ' '); }

export async function fetchAttendance(filters: AttendanceFilters) {
  const from = filters.page * filters.pageSize;
  const to = from + filters.pageSize - 1;
  let query = supabase.from('attendance_log').select(
    'id,volunteer_id,name,email,contact,attended,event_name,event_date,duration_minutes,sign_in_at,sign_out_at,calculated_duration_minutes,staff_credited_duration_minutes,staff_credit_note,event_id,shift_id,shift_label,row_version',
    { count: 'exact' },
  );
  const search = safe(filters.search);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},email.ilike.${pattern},contact.ilike.${pattern},event_name.ilike.${pattern}`);
  }
  if (filters.eventName) query = query.eq('event_name', filters.eventName);
  if (filters.attended === 'yes') query = query.eq('attended', true);
  if (filters.attended === 'no') query = query.eq('attended', false);
  const { data, error, count } = await query.order('event_date', { ascending: false }).order('name').range(from, to);
  if (error) throw error;
  return { rows: (data || []) as AttendanceRow[], count: count || 0 };
}

export async function fetchAttendanceEventNames() {
  const { data, error } = await supabase.from('attendance_log').select('event_name').order('event_name');
  if (error) throw error;
  return [...new Set((data || []).map((row) => row.event_name).filter(Boolean))];
}

export async function updateAttendance(row: AttendanceRow, patch: Partial<AttendanceRow>) {
  const { data, error } = await supabase.from('attendance_log')
    .update(patch)
    .eq('id', row.id)
    .eq('row_version', row.row_version)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This attendance row changed in another session. Refresh first.');
  return data as AttendanceRow;
}

export async function deleteAttendance(row: AttendanceRow) {
  const { data, error } = await supabase.from('attendance_log').delete()
    .eq('id', row.id).eq('row_version', row.row_version).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This attendance row changed in another session. Refresh first.');
}
