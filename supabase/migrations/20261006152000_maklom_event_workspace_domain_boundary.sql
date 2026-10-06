-- MakLom event workspace domain boundary.
-- Keeps MakLom as a read-heavy staff surface while routing operational writes
-- through governed RPCs with RLS, optimistic concurrency and audit logging.

alter table public.phaseone_roster
  add column if not exists row_version bigint not null default 1;

alter table public.phaseone_attendance_sessions
  add column if not exists row_version bigint not null default 1;

create or replace function public.phaseone_bump_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_version = old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists phaseone_roster_bump_row_version on public.phaseone_roster;
create trigger phaseone_roster_bump_row_version
before update on public.phaseone_roster
for each row execute function public.phaseone_bump_row_version();

drop trigger if exists phaseone_attendance_sessions_bump_row_version on public.phaseone_attendance_sessions;
create trigger phaseone_attendance_sessions_bump_row_version
before update on public.phaseone_attendance_sessions
for each row execute function public.phaseone_bump_row_version();

create unique index if not exists phaseone_attendance_sessions_event_person_day_uidx
  on public.phaseone_attendance_sessions(event_id, attendance_date, person_key);

create table if not exists public.phaseone_roster_operational_overrides (
  roster_id uuid primary key references public.phaseone_roster(id) on delete cascade,
  event_id uuid not null references public.phaseone_events(id) on delete cascade,
  contact_on_day text,
  dietary_override text,
  tshirt_size_override text,
  note text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  constraint phaseone_roster_operational_overrides_tshirt_check
    check (tshirt_size_override is null or tshirt_size_override in ('S','M','L','XL','2XL','3XL','5XL','7XL')),
  constraint phaseone_roster_operational_overrides_contact_check
    check (contact_on_day is null or char_length(contact_on_day) <= 200),
  constraint phaseone_roster_operational_overrides_dietary_check
    check (dietary_override is null or char_length(dietary_override) <= 800),
  constraint phaseone_roster_operational_overrides_note_check
    check (note is null or char_length(note) <= 1000)
);

alter table public.phaseone_roster_operational_overrides enable row level security;

drop policy if exists "MakLom members can read roster operational overrides"
  on public.phaseone_roster_operational_overrides;
create policy "MakLom members can read roster operational overrides"
on public.phaseone_roster_operational_overrides
for select
to authenticated
using (
  exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
  )
);

grant select on public.phaseone_roster_operational_overrides to authenticated;
grant select, insert, update, delete on public.phaseone_roster_operational_overrides to service_role;
revoke insert, update, delete on public.phaseone_roster_operational_overrides from anon, authenticated;

create or replace function public.phaseone_roster_override_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.row_version = old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists phaseone_roster_override_bump_version
  on public.phaseone_roster_operational_overrides;
create trigger phaseone_roster_override_bump_version
before update on public.phaseone_roster_operational_overrides
for each row execute function public.phaseone_roster_override_bump_version();

create table if not exists public.pending_volunteer_identities (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  source_kind text not null,
  source_record_id text not null,
  status text not null default 'pending',
  claimed_core_volunteer_id uuid references core.volunteers(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  constraint pending_volunteer_identities_status_check
    check (status in ('pending','claimed','dismissed')),
  constraint pending_volunteer_identities_source_unique
    unique (source_kind, source_record_id)
);

alter table public.pending_volunteer_identities enable row level security;

drop policy if exists "MakLom members can read pending volunteer identities"
  on public.pending_volunteer_identities;
create policy "MakLom members can read pending volunteer identities"
on public.pending_volunteer_identities
for select
to authenticated
using (
  exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
  )
);

grant select on public.pending_volunteer_identities to authenticated;
grant select, insert, update, delete on public.pending_volunteer_identities to service_role;
revoke insert, update, delete on public.pending_volunteer_identities from anon, authenticated;

create or replace function public.pending_volunteer_identity_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  new.row_version = old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists pending_volunteer_identity_bump_version
  on public.pending_volunteer_identities;
create trigger pending_volunteer_identity_bump_version
before update on public.pending_volunteer_identities
for each row execute function public.pending_volunteer_identity_bump_version();

alter table public.historical_attendance_import_rows
  add column if not exists matched_keluarga_event_id uuid
    references public.phaseone_events(id) on delete set null,
  add column if not exists matched_keluarga_timeslot_id uuid
    references public.phaseone_event_timeslots(id) on delete set null,
  add column if not exists committed_keluarga_session_id uuid
    references public.phaseone_attendance_sessions(id) on delete set null,
  add column if not exists pending_identity_id uuid
    references public.pending_volunteer_identities(id) on delete set null;

create index if not exists historical_attendance_rows_keluarga_event_idx
  on public.historical_attendance_import_rows(matched_keluarga_event_id)
  where matched_keluarga_event_id is not null;
create index if not exists historical_attendance_rows_keluarga_timeslot_idx
  on public.historical_attendance_import_rows(matched_keluarga_timeslot_id)
  where matched_keluarga_timeslot_id is not null;
create index if not exists historical_attendance_rows_keluarga_session_idx
  on public.historical_attendance_import_rows(committed_keluarga_session_id)
  where committed_keluarga_session_id is not null;
create index if not exists historical_attendance_rows_pending_identity_idx
  on public.historical_attendance_import_rows(pending_identity_id)
  where pending_identity_id is not null;

create schema if not exists maklom_domain;
revoke all on schema maklom_domain from public, anon;
grant usage on schema maklom_domain to authenticated, service_role;

create or replace function maklom_domain.require_editor(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception 'Authentication context mismatch' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.app_members m
    where m.user_id=p_actor and m.active and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor or admin access is required' using errcode='42501';
  end if;
end;
$$;

create or replace function maklom_domain.validate_reason(
  p_reason_code text,
  p_reason_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_reason_code,'')));
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  if v_code not in (
    'system_outage','walk_in_adjustment','staff_correction','historical_import',
    'volunteer_request','event_logistics','other'
  ) then
    raise exception 'Choose a valid reason category' using errcode='22023';
  end if;
  if char_length(v_note) < 5 or char_length(v_note) > 500 then
    raise exception 'A staff note between 5 and 500 characters is required' using errcode='22023';
  end if;
end;
$$;

create or replace function maklom_domain.set_roster_override_impl(
  p_roster_id uuid,
  p_expected_roster_version bigint,
  p_expected_override_version bigint,
  p_contact_on_day text,
  p_dietary_override text,
  p_tshirt_size_override text,
  p_note text,
  p_reason_code text,
  p_reason_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roster public.phaseone_roster%rowtype;
  v_existing public.phaseone_roster_operational_overrides%rowtype;
  v_new public.phaseone_roster_operational_overrides%rowtype;
  v_expected_override bigint := coalesce(p_expected_override_version,0);
  v_shirt text := upper(nullif(btrim(coalesce(p_tshirt_size_override,'')),''));
begin
  perform maklom_domain.require_editor(p_actor);
  perform maklom_domain.validate_reason(p_reason_code,p_reason_note);

  select * into v_roster
  from public.phaseone_roster
  where id=p_roster_id
  for update;

  if not found then
    raise exception 'Roster row not found' using errcode='P0002';
  end if;
  if v_roster.row_version <> p_expected_roster_version then
    raise exception 'Roster changed since it was opened. Refresh before applying this override.'
      using errcode='40001';
  end if;
  if v_shirt is not null and v_shirt not in ('S','M','L','XL','2XL','3XL','5XL','7XL') then
    raise exception 'Choose a supported T-shirt size' using errcode='22023';
  end if;

  select * into v_existing
  from public.phaseone_roster_operational_overrides
  where roster_id=p_roster_id
  for update;

  if found then
    if v_existing.row_version <> v_expected_override then
      raise exception 'Operational override changed since it was opened. Refresh before saving.'
        using errcode='40001';
    end if;
    update public.phaseone_roster_operational_overrides
    set
      contact_on_day=nullif(btrim(coalesce(p_contact_on_day,'')),''),
      dietary_override=nullif(btrim(coalesce(p_dietary_override,'')),''),
      tshirt_size_override=v_shirt,
      note=nullif(btrim(coalesce(p_note,'')),''),
      updated_by=p_actor
    where roster_id=p_roster_id
    returning * into v_new;
  else
    if v_expected_override <> 0 then
      raise exception 'Operational override changed since it was opened. Refresh before saving.'
        using errcode='40001';
    end if;
    insert into public.phaseone_roster_operational_overrides(
      roster_id,event_id,contact_on_day,dietary_override,tshirt_size_override,note,updated_by
    )
    values(
      p_roster_id,v_roster.event_id,
      nullif(btrim(coalesce(p_contact_on_day,'')),''),
      nullif(btrim(coalesce(p_dietary_override,'')),''),
      v_shirt,
      nullif(btrim(coalesce(p_note,'')),''),
      p_actor
    )
    returning * into v_new;
  end if;

  perform audit.write_event(
    'maklom.roster_operational_override_changed',
    'roster',
    p_roster_id::text,
    jsonb_build_object(
      'event_id',v_roster.event_id,
      'reason_code',lower(btrim(p_reason_code)),
      'reason_note',btrim(p_reason_note),
      'old',case when v_existing.roster_id is null then null else jsonb_build_object(
        'contact_on_day',v_existing.contact_on_day,
        'dietary_override',v_existing.dietary_override,
        'tshirt_size_override',v_existing.tshirt_size_override,
        'note',v_existing.note
      ) end,
      'new',jsonb_build_object(
        'contact_on_day',v_new.contact_on_day,
        'dietary_override',v_new.dietary_override,
        'tshirt_size_override',v_new.tshirt_size_override,
        'note',v_new.note
      )
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'roster_id',v_new.roster_id,
    'event_id',v_new.event_id,
    'row_version',v_new.row_version,
    'updated_at',v_new.updated_at
  );
end;
$$;

create or replace function maklom_domain.correct_attendance_impl(
  p_session_id uuid,
  p_expected_version bigint,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz,
  p_reason_code text,
  p_reason_note text,
  p_credit_action text,
  p_approved_minutes integer,
  p_approval_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.phaseone_attendance_sessions%rowtype;
  v_updated public.phaseone_attendance_sessions%rowtype;
  v_contribution public.volunteer_contributions%rowtype;
  v_credit_action text := lower(btrim(coalesce(p_credit_action,'unchanged')));
begin
  perform maklom_domain.require_editor(p_actor);
  perform maklom_domain.validate_reason(p_reason_code,p_reason_note);

  if p_checked_in_at is null then
    raise exception 'Check-in time is required' using errcode='22023';
  end if;
  if p_checked_out_at is not null and p_checked_out_at < p_checked_in_at then
    raise exception 'Check-out cannot be before check-in' using errcode='22023';
  end if;
  if v_credit_action not in ('unchanged','approve','needs_review','reject') then
    raise exception 'Unsupported contribution review action' using errcode='22023';
  end if;
  if v_credit_action='approve' and (p_approved_minutes is null or p_approved_minutes < 0) then
    raise exception 'Approved minutes are required when approving contribution hours' using errcode='22023';
  end if;

  select * into v_session
  from public.phaseone_attendance_sessions
  where id=p_session_id
  for update;

  if not found then
    raise exception 'Attendance session not found' using errcode='P0002';
  end if;
  if v_session.row_version <> p_expected_version then
    raise exception 'Attendance changed since it was opened. Refresh before applying this correction.'
      using errcode='40001';
  end if;

  update public.phaseone_attendance_sessions
  set
    checked_in_at=p_checked_in_at,
    checked_out_at=p_checked_out_at,
    checked_in_by=case when checked_in_at is distinct from p_checked_in_at then p_actor else checked_in_by end,
    checked_out_by=case when checked_out_at is distinct from p_checked_out_at then p_actor else checked_out_by end,
    updated_at=now()
  where id=p_session_id
  returning * into v_updated;

  insert into public.phaseone_attendance_session_audit(
    session_id,event_id,roster_id,action,metadata,changed_by
  )
  values(
    v_updated.id,v_updated.event_id,v_updated.origin_roster_id,'staff_override',
    jsonb_build_object(
      'source','maklom_event_workspace',
      'reason_code',lower(btrim(p_reason_code)),
      'reason_note',btrim(p_reason_note),
      'old_checked_in_at',v_session.checked_in_at,
      'old_checked_out_at',v_session.checked_out_at,
      'new_checked_in_at',v_updated.checked_in_at,
      'new_checked_out_at',v_updated.checked_out_at,
      'credit_action',v_credit_action,
      'approved_minutes',p_approved_minutes,
      'approval_note',nullif(btrim(coalesce(p_approval_note,'')),'')
    ),
    p_actor
  );

  select * into v_contribution
  from public.volunteer_contributions
  where attendance_session_id=p_session_id
  for update;

  if found then
    if v_credit_action='approve' then
      update public.volunteer_contributions
      set status='approved',approved_minutes=p_approved_minutes,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),''),
          approved_by=p_actor,approved_at=now(),updated_at=now()
      where id=v_contribution.id;
    elsif v_credit_action='needs_review' then
      update public.volunteer_contributions
      set status='needs_review',approved_minutes=null,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),''),
          approved_by=p_actor,approved_at=now(),updated_at=now()
      where id=v_contribution.id;
    elsif v_credit_action='reject' then
      update public.volunteer_contributions
      set status='rejected',approved_minutes=null,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),''),
          approved_by=p_actor,approved_at=now(),updated_at=now()
      where id=v_contribution.id;
    end if;
  elsif v_credit_action <> 'unchanged' then
    raise exception 'This attendance session is not linked to a contribution record'
      using errcode='P0001';
  end if;

  perform audit.write_event(
    'maklom.attendance_corrected',
    'attendance_session',
    p_session_id::text,
    jsonb_build_object(
      'event_id',v_updated.event_id,
      'roster_id',v_updated.origin_roster_id,
      'reason_code',lower(btrim(p_reason_code)),
      'reason_note',btrim(p_reason_note),
      'old',jsonb_build_object(
        'checked_in_at',v_session.checked_in_at,
        'checked_out_at',v_session.checked_out_at
      ),
      'new',jsonb_build_object(
        'checked_in_at',v_updated.checked_in_at,
        'checked_out_at',v_updated.checked_out_at
      ),
      'credit_action',v_credit_action,
      'approved_minutes',p_approved_minutes
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'session_id',v_updated.id,
    'event_id',v_updated.event_id,
    'row_version',v_updated.row_version,
    'checked_in_at',v_updated.checked_in_at,
    'checked_out_at',v_updated.checked_out_at
  );
end;
$$;

create or replace function maklom_domain.pre_register_identity_impl(
  p_row_id text,
  p_expected_version bigint,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_identity public.pending_volunteer_identities%rowtype;
begin
  perform maklom_domain.require_editor(p_actor);

  select * into v_row
  from public.historical_attendance_import_rows
  where id=p_row_id
  for update;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;
  if v_row.row_version <> p_expected_version then
    raise exception 'Staged attendance changed since it was opened. Refresh before continuing.'
      using errcode='40001';
  end if;
  if v_row.matched_core_volunteer_id is not null then
    raise exception 'This row is already linked to an existing volunteer' using errcode='P0001';
  end if;

  insert into public.pending_volunteer_identities(
    full_name,email,phone,source_kind,source_record_id,status,created_by,updated_by
  )
  values(
    v_row.full_name,v_row.email,v_row.phone,'historical_attendance',v_row.id,'pending',p_actor,p_actor
  )
  on conflict(source_kind,source_record_id) do update
  set updated_by=excluded.updated_by
  returning * into v_identity;

  update public.historical_attendance_import_rows
  set pending_identity_id=v_identity.id
  where id=v_row.id;

  perform audit.write_event(
    'maklom.pending_volunteer_identity_created',
    'pending_volunteer_identity',
    v_identity.id::text,
    jsonb_build_object(
      'source_row_id',v_row.id,
      'source_row_number',v_row.source_row_number,
      'email_present',v_row.email is not null,
      'phone_present',v_row.phone is not null
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'pending_identity_id',v_identity.id,
    'status',v_identity.status,
    'source_row_id',v_row.id
  );
end;
$$;

create or replace function maklom_domain.event_audit_impl(
  p_event_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception 'Authentication context mismatch' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.app_members m
    where m.user_id=p_actor and m.active
  ) then
    raise exception 'MakLom access is required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb)
  into v_result
  from (
    select e.id,e.actor_user_id,e.action,e.target_type,e.target_id,e.metadata,e.occurred_at
    from audit.events e
    where e.metadata->>'event_id'=p_event_id::text
    order by e.occurred_at desc
    limit 100
  ) x;

  return v_result;
end;
$$;

create or replace function public.maklom_event_set_roster_override(
  p_roster_id uuid,
  p_expected_roster_version bigint,
  p_expected_override_version bigint,
  p_contact_on_day text,
  p_dietary_override text,
  p_tshirt_size_override text,
  p_note text,
  p_reason_code text,
  p_reason_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.set_roster_override_impl(
    p_roster_id,p_expected_roster_version,p_expected_override_version,
    p_contact_on_day,p_dietary_override,p_tshirt_size_override,p_note,
    p_reason_code,p_reason_note,auth.uid()
  );
end;
$$;

create or replace function public.maklom_event_correct_attendance(
  p_session_id uuid,
  p_expected_version bigint,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz,
  p_reason_code text,
  p_reason_note text,
  p_credit_action text default 'unchanged',
  p_approved_minutes integer default null,
  p_approval_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.correct_attendance_impl(
    p_session_id,p_expected_version,p_checked_in_at,p_checked_out_at,
    p_reason_code,p_reason_note,p_credit_action,p_approved_minutes,p_approval_note,auth.uid()
  );
end;
$$;

create or replace function public.maklom_event_pre_register_staged_identity(
  p_row_id text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.pre_register_identity_impl(
    p_row_id,p_expected_version,auth.uid()
  );
end;
$$;

create or replace function public.maklom_event_audit(
  p_event_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.event_audit_impl(p_event_id,auth.uid());
end;
$$;

grant execute on function maklom_domain.require_editor(uuid) to authenticated,service_role;
grant execute on function maklom_domain.validate_reason(text,text) to authenticated,service_role;
grant execute on function maklom_domain.set_roster_override_impl(uuid,bigint,bigint,text,text,text,text,text,text,uuid) to authenticated,service_role;
grant execute on function maklom_domain.correct_attendance_impl(uuid,bigint,timestamptz,timestamptz,text,text,text,integer,text,uuid) to authenticated,service_role;
grant execute on function maklom_domain.pre_register_identity_impl(text,bigint,uuid) to authenticated,service_role;
grant execute on function maklom_domain.event_audit_impl(uuid,uuid) to authenticated,service_role;

revoke all on function public.maklom_event_set_roster_override(uuid,bigint,bigint,text,text,text,text,text,text)
  from public,anon;
grant execute on function public.maklom_event_set_roster_override(uuid,bigint,bigint,text,text,text,text,text,text)
  to authenticated,service_role;

revoke all on function public.maklom_event_correct_attendance(uuid,bigint,timestamptz,timestamptz,text,text,text,integer,text)
  from public,anon;
grant execute on function public.maklom_event_correct_attendance(uuid,bigint,timestamptz,timestamptz,text,text,text,integer,text)
  to authenticated,service_role;

revoke all on function public.maklom_event_pre_register_staged_identity(text,bigint)
  from public,anon;
grant execute on function public.maklom_event_pre_register_staged_identity(text,bigint)
  to authenticated,service_role;

revoke all on function public.maklom_event_audit(uuid)
  from public,anon;
grant execute on function public.maklom_event_audit(uuid)
  to authenticated,service_role;

create or replace view public.maklom_attendance_feed
with (security_invoker = true)
as
select
  a.id,a.volunteer_id,a.name,a.email,a.contact,a.attended,a.event_name,a.event_date,
  a.duration_minutes,a.sign_in_at,a.sign_out_at,a.calculated_duration_minutes,
  a.staff_credited_duration_minutes,a.staff_credit_note,a.event_id,a.shift_id,
  a.shift_label,a.row_version,'maklom'::text as record_source,
  null::text as contribution_status
from public.attendance_log a
union all
select
  'keluarga:'::text || s.id::text,
  mv.id,
  r.volunteer_name,
  r.email,
  r.mobile,
  s.checked_in_at is not null,
  e.title,
  s.attendance_date,
  coalesce(greatest(floor(extract(epoch from s.checked_out_at-s.checked_in_at)/60)::integer,0),0),
  s.checked_in_at,
  s.checked_out_at,
  case
    when s.checked_in_at is not null and s.checked_out_at is not null
      then greatest(floor(extract(epoch from s.checked_out_at-s.checked_in_at)/60)::integer,0)
    else null
  end,
  case when c.status='approved' then c.approved_minutes else null end,
  c.approval_note,
  s.event_id::text,
  null::text,
  shift_names.shift_label,
  s.row_version,
  'keluarga'::text,
  c.status
from public.phaseone_attendance_sessions s
join public.phaseone_events e on e.id=s.event_id
join public.phaseone_roster r on r.id=s.origin_roster_id
left join public.volunteers mv on mv.core_volunteer_id=r.volunteer_id
left join public.volunteer_contributions c on c.attendance_session_id=s.id
left join lateral (
  select string_agg(
    coalesce(nullif(btrim(t.label),''),'General'),
    ', ' order by t.sort_order,t.starts_at,t.id
  ) as shift_label
  from public.phaseone_attendance_session_shifts ss
  join public.phaseone_event_timeslots t on t.id=ss.timeslot_id
  where ss.session_id=s.id
) shift_names on true;

grant select on public.maklom_attendance_feed to authenticated,service_role;
