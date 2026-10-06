create index if not exists historical_attendance_rows_duplicate_attendance_idx
  on public.historical_attendance_import_rows(duplicate_of_attendance_id)
  where duplicate_of_attendance_id is not null;
