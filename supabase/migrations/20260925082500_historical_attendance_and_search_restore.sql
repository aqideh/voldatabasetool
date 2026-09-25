begin;

create table if not exists public.historical_attendance_import_batches (
  id text primary key default ('hist_batch_' || substr(replace(gen_random_uuid()::text,'-',''),1,20)),
  source_filename text not null,
  source_file_hash text,
  row_count integer not null default 0 check (row_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  created_volunteer_count integer not null default 0 check (created_volunteer_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  total_minutes integer not null default 0 check (total_minutes >= 0),
  status text not null default 'committed' check (status in ('committed','partial','failed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1
);

create table if not exists public.historical_attendance_import_rows (
  id text primary key default ('hist_row_' || substr(replace(gen_random_uuid()::text,'-',''),1,20)),
  batch_id text not null references public.historical_attendance_import_batches(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  source_row_hash text not null,
  source_volunteer_identifier text,
  full_name text not null,
  email text,
  phone text,
  event_name text not null,
  event_date date not null,
  volunteer_role text,
  reported_minutes integer not null default 0 check (reported_minutes >= 0),
  attended boolean not null default true,
  match_status text not null check (match_status in ('matched','created','needs_review','duplicate','invalid')),
  matched_volunteer_id text references public.volunteers(id) on delete set null,
  matched_core_volunteer_id uuid references core.volunteers(id) on delete set null,
  match_reason text,
  review_flags text[] not null default '{}'::text[],
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload)='object'),
  committed_attendance_id text references public.attendance_log(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1,
  unique (batch_id, source_row_number)
);

create index if not exists historical_attendance_rows_hash_idx
  on public.historical_attendance_import_rows(source_row_hash);
create index if not exists historical_attendance_rows_match_idx
  on public.historical_attendance_import_rows(match_status, created_at desc);
create index if not exists historical_attendance_rows_volunteer_idx
  on public.historical_attendance_import_rows(matched_volunteer_id)
  where matched_volunteer_id is not null;
create index if not exists historical_attendance_batches_created_idx
  on public.historical_attendance_import_batches(created_at desc);

alter table public.attendance_log
  add column if not exists source_kind text not null default 'legacy_maklom',
  add column if not exists historical_import_batch_id text,
  add column if not exists historical_source_row_hash text,
  add column if not exists volunteer_role text;

alter table public.attendance_log
  drop constraint if exists attendance_log_source_kind_check;
alter table public.attendance_log
  add constraint attendance_log_source_kind_check
  check (source_kind in ('legacy_maklom','manual','form_attendance','event_report','historical_import'));

alter table public.attendance_log
  drop constraint if exists attendance_log_historical_import_batch_id_fkey;
alter table public.attendance_log
  add constraint attendance_log_historical_import_batch_id_fkey
  foreign key (historical_import_batch_id)
  references public.historical_attendance_import_batches(id)
  on delete set null;

create index if not exists attendance_log_historical_batch_idx
  on public.attendance_log(historical_import_batch_id)
  where historical_import_batch_id is not null;
create index if not exists attendance_log_source_kind_idx
  on public.attendance_log(source_kind);

alter table public.historical_attendance_import_batches enable row level security;
alter table public.historical_attendance_import_rows enable row level security;

create policy historical_attendance_batches_read_members
on public.historical_attendance_import_batches for select to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active
));
create policy historical_attendance_batches_insert_editors
on public.historical_attendance_import_batches for insert to authenticated
with check (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
));
create policy historical_attendance_batches_update_editors
on public.historical_attendance_import_batches for update to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
))
with check (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
));
create policy historical_attendance_batches_delete_admins
on public.historical_attendance_import_batches for delete to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role='admin'
));

create policy historical_attendance_rows_read_members
on public.historical_attendance_import_rows for select to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active
));
create policy historical_attendance_rows_insert_editors
on public.historical_attendance_import_rows for insert to authenticated
with check (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
));
create policy historical_attendance_rows_update_editors
on public.historical_attendance_import_rows for update to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
))
with check (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role in ('editor','admin')
));
create policy historical_attendance_rows_delete_admins
on public.historical_attendance_import_rows for delete to authenticated
using (exists (
  select 1 from public.app_members m
  where m.user_id=(select auth.uid()) and m.active and m.role='admin'
));

grant select,insert,update,delete on public.historical_attendance_import_batches to authenticated,service_role;
grant select,insert,update,delete on public.historical_attendance_import_rows to authenticated,service_role;

drop trigger if exists set_historical_attendance_batches_created_fields on public.historical_attendance_import_batches;
create trigger set_historical_attendance_batches_created_fields
before insert on public.historical_attendance_import_batches
for each row execute function public.set_maklom_created_fields();

drop trigger if exists set_historical_attendance_batches_updated_fields on public.historical_attendance_import_batches;
create trigger set_historical_attendance_batches_updated_fields
before update on public.historical_attendance_import_batches
for each row execute function public.set_maklom_updated_fields();

drop trigger if exists set_historical_attendance_rows_created_fields on public.historical_attendance_import_rows;
create trigger set_historical_attendance_rows_created_fields
before insert on public.historical_attendance_import_rows
for each row execute function public.set_maklom_created_fields();

drop trigger if exists set_historical_attendance_rows_updated_fields on public.historical_attendance_import_rows;
create trigger set_historical_attendance_rows_updated_fields
before update on public.historical_attendance_import_rows
for each row execute function public.set_maklom_updated_fields();

create or replace function maklom_private.log_maklom_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare record_id text; version_value text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in (
      'volunteers','volunteer_leads','attendance_log','reporting_metrics',
      'suspected_duplicates','merge_log','form_import_batches','form_submissions',
      'attendance_reconciliations','events','event_shifts','event_impact_metrics',
      'historical_attendance_import_batches','historical_attendance_import_rows'
    )
  then
    raise exception 'MakLom audit trigger invoked from unexpected relation %.%',tg_table_schema,tg_table_name;
  end if;

  if tg_op='DELETE' then
    record_id=old.id;
    version_value=to_jsonb(old)->>'row_version';
  else
    record_id=new.id;
    version_value=to_jsonb(new)->>'row_version';
  end if;

  insert into public.audit_log(actor_user_id,entity_type,entity_id,action,details)
  values(
    auth.uid(),tg_table_name,record_id,lower(tg_op),
    jsonb_strip_nulls(jsonb_build_object('source','database-trigger','row_version',version_value))
  );

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function maklom_private.log_maklom_change() from public,anon,authenticated;

drop trigger if exists audit_historical_attendance_batches_changes on public.historical_attendance_import_batches;
create trigger audit_historical_attendance_batches_changes
after insert or update or delete on public.historical_attendance_import_batches
for each row execute function maklom_private.log_maklom_change();

drop trigger if exists audit_historical_attendance_rows_changes on public.historical_attendance_import_rows;
create trigger audit_historical_attendance_rows_changes
after insert or update or delete on public.historical_attendance_import_rows
for each row execute function maklom_private.log_maklom_change();

create or replace view public.maklom_volunteer_search_directory
with (security_invoker = true)
as
with attendance_summary as (
  select
    volunteer_id,
    count(*)::integer as attendance_rows,
    coalesce(sum(
      case when attended then
        coalesce(staff_credited_duration_minutes,calculated_duration_minutes,duration_minutes,0)
      else 0 end
    ),0)::bigint as total_credited_minutes,
    max(event_date) filter (where attended) as last_active
  from public.attendance_log
  where volunteer_id is not null
  group by volunteer_id
)
select
  v.id,v.core_volunteer_id,c.volunteer_code,v.name,v.nric,v.phone,v.email,v.gender,
  v.address,v.recruited_year,v.chat_session,v.chat_session_date,v.interests,
  v.languages_spoken,v.programmes_registered,v.tags,v.emergency_name,v.emergency_phone,
  v.shirt_size,v.dietary,v.notes,v.updated_at,v.row_version,
  coalesce(a.attendance_rows,0) as attendance_rows,
  coalesce(a.total_credited_minutes,0) as total_credited_minutes,
  a.last_active,
  coalesce((select min(tag) from unnest(v.tags) tag),'') as first_tag,
  lower(concat_ws(' ',
    c.volunteer_code,v.name,v.phone,v.email,v.gender,v.address,v.recruited_year::text,
    v.chat_session,v.chat_session_date::text,v.interests,v.languages_spoken,
    array_to_string(v.programmes_registered,' '),array_to_string(v.tags,' '),
    v.shirt_size,v.dietary,v.notes
  )) as search_text
from public.volunteers v
join core.volunteers c on c.id=v.core_volunteer_id
left join attendance_summary a on a.volunteer_id=v.id;

revoke all on public.maklom_volunteer_search_directory from anon;
grant select on public.maklom_volunteer_search_directory to authenticated,service_role;

commit;
