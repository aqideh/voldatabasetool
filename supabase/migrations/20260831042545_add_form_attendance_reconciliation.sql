create table if not exists public.form_import_batches (
  id text primary key,
  sign_in_filename text,
  sign_out_filename text,
  sign_in_count integer not null default 0 check (sign_in_count >= 0),
  sign_out_count integer not null default 0 check (sign_out_count >= 0),
  status text not null default 'pending_sync' check (status in ('pending_sync','committed')),
  warning_count integer not null default 0 check (warning_count >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), row_version bigint not null default 1
);
create table if not exists public.form_submissions (
  id text primary key, batch_id text not null references public.form_import_batches(id) on delete cascade,
  submission_type text not null check (submission_type in ('sign_in','sign_out')), source_response_id text not null, source_file_name text,
  submitted_at timestamptz not null, submitted_date date not null, full_name text not null, email text, phone text, event_name text not null,
  shirt_quantity integer not null default 0 check (shirt_quantity >= 0), shirt_size text, age_group text, gender text, volunteer_tenure text, volunteer_frequency text,
  briefing_rating smallint check (briefing_rating between 1 and 5), onboarding_rating smallint check (onboarding_rating between 1 and 5),
  role_satisfaction_rating smallint check (role_satisfaction_rating between 1 and 5), staff_support_rating smallint check (staff_support_rating between 1 and 5),
  improvement_feedback text, recommendation text, referral_email text, raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), row_version bigint not null default 1,
  unique (submission_type, source_response_id)
);
create table if not exists public.attendance_reconciliations (
  id text primary key, batch_id text not null references public.form_import_batches(id) on delete cascade, volunteer_id text references public.volunteers(id) on delete set null,
  sign_in_submission_id text references public.form_submissions(id) on delete cascade, sign_out_submission_id text references public.form_submissions(id) on delete cascade,
  event_name text not null, event_date date not null, sign_in_at timestamptz, sign_out_at timestamptz,
  calculated_duration_minutes integer check (calculated_duration_minutes is null or calculated_duration_minutes >= 0),
  staff_credited_duration_minutes integer check (staff_credited_duration_minutes is null or staff_credited_duration_minutes >= 0), staff_credit_note text,
  match_status text not null check (match_status in ('matched','missing_sign_in','missing_sign_out')), match_confidence smallint not null default 0 check (match_confidence between 0 and 100),
  match_reason text, review_flags text[] not null default '{}'::text[], included boolean not null default true, review_acknowledged boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), row_version bigint not null default 1,
  check (sign_in_submission_id is not null or sign_out_submission_id is not null)
);
create unique index if not exists attendance_reconciliations_sign_in_unique on public.attendance_reconciliations(sign_in_submission_id) where sign_in_submission_id is not null;
create unique index if not exists attendance_reconciliations_sign_out_unique on public.attendance_reconciliations(sign_out_submission_id) where sign_out_submission_id is not null;
create index if not exists form_submissions_batch_idx on public.form_submissions(batch_id);
create index if not exists form_submissions_date_event_idx on public.form_submissions(submitted_date,event_name);
create index if not exists attendance_reconciliations_batch_idx on public.attendance_reconciliations(batch_id);
create index if not exists attendance_reconciliations_volunteer_date_idx on public.attendance_reconciliations(volunteer_id,event_date);
create index if not exists attendance_reconciliations_event_date_idx on public.attendance_reconciliations(event_date,event_name);
alter table public.attendance_log add column if not exists sign_in_at timestamptz, add column if not exists sign_out_at timestamptz,
  add column if not exists calculated_duration_minutes integer, add column if not exists staff_credited_duration_minutes integer,
  add column if not exists staff_credit_note text, add column if not exists form_reconciliation_id text;
alter table public.attendance_log drop constraint if exists attendance_log_calculated_duration_minutes_check,
  add constraint attendance_log_calculated_duration_minutes_check check (calculated_duration_minutes is null or calculated_duration_minutes >= 0),
  drop constraint if exists attendance_log_staff_credited_duration_minutes_check,
  add constraint attendance_log_staff_credited_duration_minutes_check check (staff_credited_duration_minutes is null or staff_credited_duration_minutes >= 0),
  drop constraint if exists attendance_log_form_reconciliation_id_fkey,
  add constraint attendance_log_form_reconciliation_id_fkey foreign key (form_reconciliation_id) references public.attendance_reconciliations(id) on delete set null;
create unique index if not exists attendance_log_form_reconciliation_unique on public.attendance_log(form_reconciliation_id) where form_reconciliation_id is not null;

drop trigger if exists set_form_import_batches_created_fields on public.form_import_batches;
create trigger set_form_import_batches_created_fields before insert on public.form_import_batches for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_form_import_batches_updated_fields on public.form_import_batches;
create trigger set_form_import_batches_updated_fields before update on public.form_import_batches for each row execute function public.set_maklom_updated_fields();
drop trigger if exists set_form_submissions_created_fields on public.form_submissions;
create trigger set_form_submissions_created_fields before insert on public.form_submissions for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_form_submissions_updated_fields on public.form_submissions;
create trigger set_form_submissions_updated_fields before update on public.form_submissions for each row execute function public.set_maklom_updated_fields();
drop trigger if exists set_attendance_reconciliations_created_fields on public.attendance_reconciliations;
create trigger set_attendance_reconciliations_created_fields before insert on public.attendance_reconciliations for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_attendance_reconciliations_updated_fields on public.attendance_reconciliations;
create trigger set_attendance_reconciliations_updated_fields before update on public.attendance_reconciliations for each row execute function public.set_maklom_updated_fields();

create or replace function maklom_private.log_maklom_change() returns trigger language plpgsql security definer set search_path='' as $$
declare record_id text; version_value text;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('volunteers','attendance_log','reporting_metrics','suspected_duplicates','merge_log','form_import_batches','form_submissions','attendance_reconciliations') then raise exception 'MakLom audit trigger invoked from unexpected relation %.%',tg_table_schema,tg_table_name; end if;
  if tg_op='DELETE' then record_id=old.id; version_value=to_jsonb(old)->>'row_version'; else record_id=new.id; version_value=to_jsonb(new)->>'row_version'; end if;
  insert into public.audit_log(actor_user_id,entity_type,entity_id,action,details) values(auth.uid(),tg_table_name,record_id,lower(tg_op),jsonb_strip_nulls(jsonb_build_object('source','database-trigger','row_version',version_value)));
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function maklom_private.log_maklom_change() from public,anon,authenticated;
drop trigger if exists audit_form_import_batches_changes on public.form_import_batches;
create trigger audit_form_import_batches_changes after insert or update or delete on public.form_import_batches for each row execute function maklom_private.log_maklom_change();
drop trigger if exists audit_form_submissions_changes on public.form_submissions;
create trigger audit_form_submissions_changes after insert or update or delete on public.form_submissions for each row execute function maklom_private.log_maklom_change();
drop trigger if exists audit_attendance_reconciliations_changes on public.attendance_reconciliations;
create trigger audit_attendance_reconciliations_changes after insert or update or delete on public.attendance_reconciliations for each row execute function maklom_private.log_maklom_change();

revoke all on public.form_import_batches,public.form_submissions,public.attendance_reconciliations from anon;
grant select,insert,update,delete on public.form_import_batches to authenticated,service_role;
grant select,insert,delete on public.form_submissions to authenticated; grant select,insert,update,delete on public.form_submissions to service_role;
grant select,insert,update,delete on public.attendance_reconciliations to authenticated,service_role;
alter table public.form_import_batches enable row level security; alter table public.form_submissions enable row level security; alter table public.attendance_reconciliations enable row level security;

drop policy if exists form_import_batches_read_members on public.form_import_batches;
create policy form_import_batches_read_members on public.form_import_batches for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
drop policy if exists form_submissions_read_members on public.form_submissions;
create policy form_submissions_read_members on public.form_submissions for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
drop policy if exists attendance_reconciliations_read_members on public.attendance_reconciliations;
create policy attendance_reconciliations_read_members on public.attendance_reconciliations for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));

drop policy if exists form_import_batches_insert_editors on public.form_import_batches;
create policy form_import_batches_insert_editors on public.form_import_batches for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists form_import_batches_update_editors on public.form_import_batches;
create policy form_import_batches_update_editors on public.form_import_batches for update to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text]))) with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists form_import_batches_delete_admins on public.form_import_batches;
create policy form_import_batches_delete_admins on public.form_import_batches for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));
drop policy if exists form_submissions_insert_editors on public.form_submissions;
create policy form_submissions_insert_editors on public.form_submissions for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists form_submissions_delete_admins on public.form_submissions;
create policy form_submissions_delete_admins on public.form_submissions for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));
drop policy if exists attendance_reconciliations_insert_editors on public.attendance_reconciliations;
create policy attendance_reconciliations_insert_editors on public.attendance_reconciliations for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists attendance_reconciliations_update_editors on public.attendance_reconciliations;
create policy attendance_reconciliations_update_editors on public.attendance_reconciliations for update to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text]))) with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists attendance_reconciliations_delete_admins on public.attendance_reconciliations;
create policy attendance_reconciliations_delete_admins on public.attendance_reconciliations for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));
