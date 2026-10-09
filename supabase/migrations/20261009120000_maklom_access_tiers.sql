-- Add independent MakLom access grants. Existing Keluarga roles and the legacy
-- MakLom app_members table are deliberately left unchanged.
begin;

create table public.maklom_staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('superadmin','platform_admin','volunteer_manager','data_steward','operations_staff','reporting_viewer')),
  active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.maklom_staff_access enable row level security;
revoke all on public.maklom_staff_access from anon, authenticated;
grant select on public.maklom_staff_access to authenticated;
create policy maklom_access_self on public.maklom_staff_access
  for select to authenticated using (user_id = (select auth.uid()));

-- Bootstrap only the sole existing MakLom platform_admin; do not infer
-- superadmin from Keluarga staff/VolTeam/admin roles or email domain.
do $bootstrap$
declare v_id uuid;
begin
  if (select count(*) from public.app_members where role='admin' and active) <> 1 then
    raise exception 'Expected exactly one active legacy MakLom platform_admin. Bootstrap stopped.';
  end if;
  select user_id into v_id from public.app_members where role='admin' and active;
  insert into public.maklom_staff_access(user_id,role,active,granted_by)
  values (v_id,'superadmin',true,v_id);
end $bootstrap$;

create or replace function public.maklom_can(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $fn$
  select exists (
    select 1 from public.maklom_staff_access a
    where a.user_id = auth.uid() and a.active and (
      a.role = 'superadmin'
      or (a.role = 'platform_admin' and p_permission = any(array[
        'analytics.read','volunteers.read','volunteers.write','leads.read','leads.write',
        'data.read','data.write','ops.read','ops.write','audit.read']))
      or (a.role = 'volunteer_manager' and p_permission = any(array[
        'analytics.read','volunteers.read','volunteers.write','leads.read','leads.write',
        'data.read','data.write','ops.read','ops.write']))
      or (a.role = 'data_steward' and p_permission = any(array[
        'analytics.read','volunteers.read','volunteers.write','data.read','data.write']))
      or (a.role = 'operations_staff' and p_permission = any(array[
        'analytics.read','ops.read','ops.write']))
      or (a.role in ('reporting_viewer') and p_permission = 'analytics.read')
    )
  );
$fn$;
revoke all on function public.maklom_can(text) from public,anon;
grant execute on function public.maklom_can(text) to authenticated;

create table public.maklom_staff_access_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id),
  subject_user_id uuid not null references auth.users(id),
  previous_role text,
  new_role text not null,
  previous_active boolean,
  new_active boolean not null,
  changed_at timestamptz not null default now()
);
alter table public.maklom_staff_access_audit enable row level security;
revoke all on public.maklom_staff_access_audit from anon,authenticated;
grant select on public.maklom_staff_access_audit to authenticated;
create policy maklom_access_audit_superadmin_read on public.maklom_staff_access_audit
  for select to authenticated using ((select public.maklom_can('staff.manage')));

create or replace function public.maklom_list_staff_access()
returns table(user_id uuid,email text,role text,active boolean,updated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $fn$
begin
  if not public.maklom_can('staff.manage') then
    raise exception 'Superadmin access required' using errcode='42501';
  end if;
  return query
    select a.user_id,u.email::text,a.role,a.active,a.updated_at
    from public.maklom_staff_access a join auth.users u on u.id=a.user_id
    order by case when a.role='superadmin' then 0 else 1 end, lower(u.email);
end;
$fn$;
revoke all on function public.maklom_list_staff_access() from public,anon;
grant execute on function public.maklom_list_staff_access() to authenticated;

create or replace function public.maklom_set_staff_access(
  p_email text,p_role text,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_target uuid; v_before public.maklom_staff_access%rowtype;
begin
  if not public.maklom_can('staff.manage') then
    raise exception 'Superadmin access required' using errcode='42501';
  end if;
  if p_role not in ('platform_admin','volunteer_manager','data_steward','operations_staff','reporting_viewer')
    or p_role is null or p_active is null then
    raise exception 'Invalid MakLom role or status' using errcode='22023';
  end if;
  if p_email is null or lower(btrim(p_email)) !~ '^[a-z0-9._%+-]+@mendaki[.]org[.]sg then
    raise exception 'A registered MENDAKI staff email address is required' using errcode='22023';
  end if;
  select u.id into v_target from auth.users u where lower(u.email)=lower(btrim(p_email));
  if v_target is null then
    raise exception 'This email does not have an account yet. Ask the colleague to complete sign-in first.' using errcode='22023';
  end if;
  if v_target = auth.uid() then
    raise exception 'Superadmin access cannot be changed here' using errcode='42501';
  end if;
  select * into v_before from public.maklom_staff_access where user_id=v_target for update;
  if v_before.role='superadmin' then
    raise exception 'Superadmin cannot be reassigned' using errcode='42501';
  end if;
  insert into public.maklom_staff_access(user_id,role,active,granted_by,updated_at)
  values (v_target,p_role,p_active,auth.uid(),now())
  on conflict (user_id) do update
    set role=excluded.role,active=excluded.active,granted_by=excluded.granted_by,updated_at=now();
  if v_before.user_id is null or v_before.role is distinct from p_role or v_before.active is distinct from p_active then
    insert into public.maklom_staff_access_audit
      (actor_user_id,subject_user_id,previous_role,new_role,previous_active,new_active)
    values(auth.uid(),v_target,v_before.role,p_role,v_before.active,p_active);
  end if;
  return jsonb_build_object('user_id',v_target,'role',p_role,'active',p_active);
end;
$fn$;
revoke all on function public.maklom_set_staff_access(text,text,boolean) from public,anon;
grant execute on function public.maklom_set_staff_access(text,text,boolean) to authenticated;

-- Reporting-only access is aggregate, without name, contacts, or volunteer IDs.
create or replace function public.maklom_reporting_overview()
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
begin
  if not public.maklom_can('analytics.read') then
    raise exception 'MakLom reporting access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'volunteers',(select count(*) from public.volunteers),
    'events',(select count(*) from public.events),
    'attendance_rows',(select count(*) from public.attendance_log),
    'attended_rows',(select count(*) from public.attendance_log where attended),
    'leads',(select count(*) from public.volunteer_leads),
    'credited_hours',(select round(coalesce(sum(
        case when attended then coalesce(staff_credited_duration_minutes,calculated_duration_minutes,duration_minutes,0)
        else 0 end),0)/60.0,1) from public.attendance_log)
  );
end;
$fn$;
revoke all on function public.maklom_reporting_overview() from public,anon;
grant execute on function public.maklom_reporting_overview() to authenticated;

-- Non-superadmin colleagues are NOT added to app_members. Hence the old
-- all-members-can-read policies never grant those accounts blanket access.
-- These additive policies grant only explicitly mapped operational tables.
do $policies$
declare r record; policy_name text;
begin
  for r in
    select * from (values
      ('public','volunteers','select','volunteers.read'),
      ('public','volunteers','insert','volunteers.write'),
      ('public','volunteers','update','volunteers.write'),
      ('core','volunteers','select','volunteers.read'),
      ('public','volunteer_leads','select','leads.read'),
      ('public','volunteer_leads','insert','leads.write'),
      ('public','volunteer_leads','update','leads.write'),
      ('public','volunteer_profile_change_inbox','select','data.read'),
      ('public','volunteer_profile_change_inbox','update','data.write'),
      ('public','maklom_profile_inbox','select','data.read'),
      ('public','maklom_profile_inbox','update','data.write'),
      ('public','pending_volunteer_identities','select','data.read'),
      ('public','suspected_duplicates','select','data.read'),
      ('public','suspected_duplicates','update','data.write'),
      ('public','merge_log','select','data.read'),
      ('public','volunteer_contributions','select','ops.read'),
      ('public','volunteer_contributions','update','ops.write'),
      ('public','events','select','ops.read'),
      ('public','events','insert','ops.write'),
      ('public','events','update','ops.write'),
      ('public','event_shifts','select','ops.read'),
      ('public','event_shifts','insert','ops.write'),
      ('public','event_shifts','update','ops.write'),
      ('public','event_impact_metrics','select','ops.read'),
      ('public','event_impact_metrics','insert','ops.write'),
      ('public','event_impact_metrics','update','ops.write'),
      ('public','attendance_log','select','ops.read'),
      ('public','attendance_log','insert','ops.write'),
      ('public','attendance_log','update','ops.write'),
      ('public','attendance_reconciliations','select','ops.read'),
      ('public','attendance_reconciliations','insert','ops.write'),
      ('public','attendance_reconciliations','update','ops.write'),
      ('public','historical_attendance_import_batches','select','ops.read'),
      ('public','historical_attendance_import_batches','insert','ops.write'),
      ('public','historical_attendance_import_batches','update','ops.write'),
      ('public','historical_attendance_import_rows','select','ops.read'),
      ('public','historical_attendance_import_rows','insert','ops.write'),
      ('public','historical_attendance_import_rows','update','ops.write'),
      ('public','phaseone_events','select','ops.read'),
      ('public','phaseone_event_timeslots','select','ops.read'),
      ('public','phaseone_roster','select','ops.read'),
      ('public','phaseone_roster_operational_overrides','select','ops.read'),
      ('public','phaseone_attendance_sessions','select','ops.read'),
      ('public','phaseone_attendance_session_shifts','select','ops.read'),
      ('public','phaseone_attendance','select','ops.read'),
      ('public','phaseone_volunteer_insights','select','ops.read'),
      ('public','phaseone_volunteer_reviews','select','ops.read'),
      ('public','form_import_batches','select','ops.read'),
      ('public','form_import_batches','insert','ops.write'),
      ('public','form_import_batches','update','ops.write'),
      ('public','form_submissions','select','ops.read'),
      ('public','form_submissions','insert','ops.write'),
      ('public','maklom_profile_reconciliation_batches','select','data.read'),
      ('public','maklom_profile_reconciliation_rows','select','data.read'),
      ('public','maklom_profile_reconciliation_changes','select','data.read'),
      ('public','audit_log','select','audit.read')
    ) v(schema_name,table_name,operation,permission)
  loop
    if to_regclass(format('%I.%I',r.schema_name,r.table_name)) is null then
      raise exception 'Expected relation missing: %.%',r.schema_name,r.table_name;
    end if;
    policy_name := 'maklom_tiers_'||r.operation;
    if r.operation='select' or r.operation='delete' then
      execute format('create policy %I on %I.%I for %s to authenticated using (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.operation,r.permission);
    elsif r.operation='insert' then
      execute format('create policy %I on %I.%I for insert to authenticated with check (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.permission);
    else
      execute format('create policy %I on %I.%I for update to authenticated using (public.maklom_can(%L)) with check (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.permission,r.permission);
    end if;
  end loop;
end $policies$;

-- Domain event workflows check the permission at the database boundary.
create or replace function maklom_domain.require_editor(p_actor uuid)
returns void language plpgsql security definer set search_path=''
as $fn$
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception 'Authentication context mismatch' using errcode='42501';
  end if;
  if not public.maklom_can('ops.write') and not exists (
    select 1 from public.app_members m where m.user_id=p_actor
      and m.active and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom operations write access is required' using errcode='42501';
  end if;
end;
$fn$;

commit;
 then
    raise exception 'A registered MENDAKI staff email address is required' using errcode='22023';
  end if;
  select u.id into v_target from auth.users u where lower(u.email)=lower(btrim(p_email));
  if v_target is null then
    raise exception 'This email does not have an account yet. Ask the colleague to complete sign-in first.' using errcode='22023';
  end if;
  if v_target = auth.uid() then
    raise exception 'Superadmin access cannot be changed here' using errcode='42501';
  end if;
  select * into v_before from public.maklom_staff_access where user_id=v_target for update;
  if v_before.role='superadmin' then
    raise exception 'Superadmin cannot be reassigned' using errcode='42501';
  end if;
  insert into public.maklom_staff_access(user_id,role,active,granted_by,updated_at)
  values (v_target,p_role,p_active,auth.uid(),now())
  on conflict (user_id) do update
    set role=excluded.role,active=excluded.active,granted_by=excluded.granted_by,updated_at=now();
  if v_before.user_id is null or v_before.role is distinct from p_role or v_before.active is distinct from p_active then
    insert into public.maklom_staff_access_audit
      (actor_user_id,subject_user_id,previous_role,new_role,previous_active,new_active)
    values(auth.uid(),v_target,v_before.role,p_role,v_before.active,p_active);
  end if;
  return jsonb_build_object('user_id',v_target,'role',p_role,'active',p_active);
end;
$fn$;
revoke all on function public.maklom_set_staff_access(text,text,boolean) from public,anon;
grant execute on function public.maklom_set_staff_access(text,text,boolean) to authenticated;

-- Reporting-only access is aggregate, without name, contacts, or volunteer IDs.
create or replace function public.maklom_reporting_overview()
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
begin
  if not public.maklom_can('analytics.read') then
    raise exception 'MakLom reporting access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'volunteers',(select count(*) from public.volunteers),
    'events',(select count(*) from public.events),
    'attendance_rows',(select count(*) from public.attendance_log),
    'attended_rows',(select count(*) from public.attendance_log where attended),
    'leads',(select count(*) from public.volunteer_leads),
    'credited_hours',(select round(coalesce(sum(
        case when attended then coalesce(staff_credited_duration_minutes,calculated_duration_minutes,duration_minutes,0)
        else 0 end),0)/60.0,1) from public.attendance_log)
  );
end;
$fn$;
revoke all on function public.maklom_reporting_overview() from public,anon;
grant execute on function public.maklom_reporting_overview() to authenticated;

-- Non-superadmin colleagues are NOT added to app_members. Hence the old
-- all-members-can-read policies never grant those accounts blanket access.
-- These additive policies grant only explicitly mapped operational tables.
do $policies$
declare r record; policy_name text;
begin
  for r in
    select * from (values
      ('public','volunteers','select','volunteers.read'),
      ('public','volunteers','insert','volunteers.write'),
      ('public','volunteers','update','volunteers.write'),
      ('core','volunteers','select','volunteers.read'),
      ('public','volunteer_leads','select','leads.read'),
      ('public','volunteer_leads','insert','leads.write'),
      ('public','volunteer_leads','update','leads.write'),
      ('public','volunteer_profile_change_inbox','select','data.read'),
      ('public','volunteer_profile_change_inbox','update','data.write'),
      ('public','maklom_profile_inbox','select','data.read'),
      ('public','maklom_profile_inbox','update','data.write'),
      ('public','pending_volunteer_identities','select','data.read'),
      ('public','suspected_duplicates','select','data.read'),
      ('public','suspected_duplicates','update','data.write'),
      ('public','merge_log','select','data.read'),
      ('public','volunteer_contributions','select','ops.read'),
      ('public','volunteer_contributions','update','ops.write'),
      ('public','events','select','ops.read'),
      ('public','events','insert','ops.write'),
      ('public','events','update','ops.write'),
      ('public','event_shifts','select','ops.read'),
      ('public','event_shifts','insert','ops.write'),
      ('public','event_shifts','update','ops.write'),
      ('public','event_impact_metrics','select','ops.read'),
      ('public','event_impact_metrics','insert','ops.write'),
      ('public','event_impact_metrics','update','ops.write'),
      ('public','attendance_log','select','ops.read'),
      ('public','attendance_log','insert','ops.write'),
      ('public','attendance_log','update','ops.write'),
      ('public','attendance_reconciliations','select','ops.read'),
      ('public','attendance_reconciliations','insert','ops.write'),
      ('public','attendance_reconciliations','update','ops.write'),
      ('public','historical_attendance_import_batches','select','ops.read'),
      ('public','historical_attendance_import_batches','insert','ops.write'),
      ('public','historical_attendance_import_batches','update','ops.write'),
      ('public','historical_attendance_import_rows','select','ops.read'),
      ('public','historical_attendance_import_rows','insert','ops.write'),
      ('public','historical_attendance_import_rows','update','ops.write'),
      ('public','phaseone_events','select','ops.read'),
      ('public','phaseone_event_timeslots','select','ops.read'),
      ('public','phaseone_roster','select','ops.read'),
      ('public','phaseone_roster_operational_overrides','select','ops.read'),
      ('public','phaseone_attendance_sessions','select','ops.read'),
      ('public','phaseone_attendance_session_shifts','select','ops.read'),
      ('public','phaseone_attendance','select','ops.read'),
      ('public','phaseone_volunteer_insights','select','ops.read'),
      ('public','phaseone_volunteer_reviews','select','ops.read'),
      ('public','form_import_batches','select','ops.read'),
      ('public','form_import_batches','insert','ops.write'),
      ('public','form_import_batches','update','ops.write'),
      ('public','form_submissions','select','ops.read'),
      ('public','form_submissions','insert','ops.write'),
      ('public','maklom_profile_reconciliation_batches','select','data.read'),
      ('public','maklom_profile_reconciliation_rows','select','data.read'),
      ('public','maklom_profile_reconciliation_changes','select','data.read'),
      ('public','audit_log','select','audit.read')
    ) v(schema_name,table_name,operation,permission)
  loop
    if to_regclass(format('%I.%I',r.schema_name,r.table_name)) is null then
      raise exception 'Expected relation missing: %.%',r.schema_name,r.table_name;
    end if;
    policy_name := 'maklom_tiers_'||r.operation;
    if r.operation='select' or r.operation='delete' then
      execute format('create policy %I on %I.%I for %s to authenticated using (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.operation,r.permission);
    elsif r.operation='insert' then
      execute format('create policy %I on %I.%I for insert to authenticated with check (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.permission);
    else
      execute format('create policy %I on %I.%I for update to authenticated using (public.maklom_can(%L)) with check (public.maklom_can(%L))',
        policy_name,r.schema_name,r.table_name,r.permission,r.permission);
    end if;
  end loop;
end $policies$;

-- Domain event workflows check the permission at the database boundary.
create or replace function maklom_domain.require_editor(p_actor uuid)
returns void language plpgsql security definer set search_path=''
as $fn$
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception 'Authentication context mismatch' using errcode='42501';
  end if;
  if not public.maklom_can('ops.write') and not exists (
    select 1 from public.app_members m where m.user_id=p_actor
      and m.active and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom operations write access is required' using errcode='42501';
  end if;
end;
$fn$;

commit;
