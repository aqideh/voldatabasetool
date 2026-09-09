create table if not exists public.events (
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  programme text,
  venue text,
  notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1,
  check (end_date >= start_date)
);

create table if not exists public.event_shifts (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  shift_date date not null,
  start_time time,
  end_time time,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1
);

create table if not exists public.event_impact_metrics (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  label text not null,
  value numeric not null check (value >= 0),
  unit text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1
);

alter table public.attendance_log
  add column if not exists event_id text,
  add column if not exists shift_id text;

alter table public.attendance_log
  drop constraint if exists attendance_log_event_id_fkey,
  add constraint attendance_log_event_id_fkey foreign key (event_id) references public.events(id) on delete set null,
  drop constraint if exists attendance_log_shift_id_fkey,
  add constraint attendance_log_shift_id_fkey foreign key (shift_id) references public.event_shifts(id) on delete set null;

create index if not exists event_shifts_event_date_idx on public.event_shifts(event_id, shift_date);
create index if not exists event_impact_metrics_event_idx on public.event_impact_metrics(event_id);
create index if not exists attendance_log_event_id_idx on public.attendance_log(event_id);
create index if not exists attendance_log_shift_id_idx on public.attendance_log(shift_id);

drop trigger if exists set_events_created_fields on public.events;
create trigger set_events_created_fields before insert on public.events for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_events_updated_fields on public.events;
create trigger set_events_updated_fields before update on public.events for each row execute function public.set_maklom_updated_fields();
drop trigger if exists set_event_shifts_created_fields on public.event_shifts;
create trigger set_event_shifts_created_fields before insert on public.event_shifts for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_event_shifts_updated_fields on public.event_shifts;
create trigger set_event_shifts_updated_fields before update on public.event_shifts for each row execute function public.set_maklom_updated_fields();
drop trigger if exists set_event_impact_metrics_created_fields on public.event_impact_metrics;
create trigger set_event_impact_metrics_created_fields before insert on public.event_impact_metrics for each row execute function public.set_maklom_created_fields();
drop trigger if exists set_event_impact_metrics_updated_fields on public.event_impact_metrics;
create trigger set_event_impact_metrics_updated_fields before update on public.event_impact_metrics for each row execute function public.set_maklom_updated_fields();

create or replace function maklom_private.log_maklom_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare record_id text; version_value text;
begin
  if tg_table_schema <> 'public' or tg_table_name not in (
    'volunteers','attendance_log','reporting_metrics','suspected_duplicates','merge_log',
    'form_import_batches','form_submissions','attendance_reconciliations',
    'events','event_shifts','event_impact_metrics'
  ) then raise exception 'MakLom audit trigger invoked from unexpected relation %.%',tg_table_schema,tg_table_name; end if;
  if tg_op='DELETE' then record_id=old.id; version_value=to_jsonb(old)->>'row_version'; else record_id=new.id; version_value=to_jsonb(new)->>'row_version'; end if;
  insert into public.audit_log(actor_user_id,entity_type,entity_id,action,details)
  values(auth.uid(),tg_table_name,record_id,lower(tg_op),jsonb_strip_nulls(jsonb_build_object('source','database-trigger','row_version',version_value)));
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function maklom_private.log_maklom_change() from public,anon,authenticated;

drop trigger if exists audit_events_changes on public.events;
create trigger audit_events_changes after insert or update or delete on public.events for each row execute function maklom_private.log_maklom_change();
drop trigger if exists audit_event_shifts_changes on public.event_shifts;
create trigger audit_event_shifts_changes after insert or update or delete on public.event_shifts for each row execute function maklom_private.log_maklom_change();
drop trigger if exists audit_event_impact_metrics_changes on public.event_impact_metrics;
create trigger audit_event_impact_metrics_changes after insert or update or delete on public.event_impact_metrics for each row execute function maklom_private.log_maklom_change();

revoke all on public.events, public.event_shifts, public.event_impact_metrics from anon;
grant select,insert,update,delete on public.events, public.event_shifts, public.event_impact_metrics to authenticated,service_role;
alter table public.events enable row level security;
alter table public.event_shifts enable row level security;
alter table public.event_impact_metrics enable row level security;

drop policy if exists events_read_members on public.events;
create policy events_read_members on public.events for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
drop policy if exists events_insert_editors on public.events;
create policy events_insert_editors on public.events for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists events_update_editors on public.events;
create policy events_update_editors on public.events for update to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text]))) with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists events_delete_admins on public.events;
create policy events_delete_admins on public.events for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));

drop policy if exists event_shifts_read_members on public.event_shifts;
create policy event_shifts_read_members on public.event_shifts for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
drop policy if exists event_shifts_insert_editors on public.event_shifts;
create policy event_shifts_insert_editors on public.event_shifts for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists event_shifts_update_editors on public.event_shifts;
create policy event_shifts_update_editors on public.event_shifts for update to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text]))) with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists event_shifts_delete_admins on public.event_shifts;
create policy event_shifts_delete_admins on public.event_shifts for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));

drop policy if exists event_impact_metrics_read_members on public.event_impact_metrics;
create policy event_impact_metrics_read_members on public.event_impact_metrics for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
drop policy if exists event_impact_metrics_insert_editors on public.event_impact_metrics;
create policy event_impact_metrics_insert_editors on public.event_impact_metrics for insert to authenticated with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists event_impact_metrics_update_editors on public.event_impact_metrics;
create policy event_impact_metrics_update_editors on public.event_impact_metrics for update to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text]))) with check (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role=any(array['editor'::text,'admin'::text])));
drop policy if exists event_impact_metrics_delete_admins on public.event_impact_metrics;
create policy event_impact_metrics_delete_admins on public.event_impact_metrics for delete to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active and m.role='admin'));