alter table public.attendance_log
  add column if not exists shift_label text;

alter table public.attendance_log
  drop constraint if exists attendance_log_shift_label_length;

alter table public.attendance_log
  add constraint attendance_log_shift_label_length
  check (shift_label is null or char_length(shift_label) <= 120);
