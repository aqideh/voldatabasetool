create index if not exists historical_attendance_rows_core_volunteer_idx
  on public.historical_attendance_import_rows(matched_core_volunteer_id)
  where matched_core_volunteer_id is not null;

create index if not exists historical_attendance_rows_committed_attendance_idx
  on public.historical_attendance_import_rows(committed_attendance_id)
  where committed_attendance_id is not null;
