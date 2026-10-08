
alter table public.attendance_log
  add column if not exists contact_evidence_status text not null default 'unverified',
  add column if not exists contact_evidence_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.attendance_log'::regclass
      and conname='attendance_log_contact_evidence_status_check'
  ) then
    alter table public.attendance_log
      add constraint attendance_log_contact_evidence_status_check
      check (contact_evidence_status in ('verified','unverified','disputed'));
  end if;
end
$$;

comment on column public.attendance_log.contact_evidence_status is
  'Trust state for source email/contact evidence. Only verified values may be used for identity matching or outbound communications.';
comment on column public.attendance_log.contact_evidence_note is
  'Staff-facing provenance note for why historical contact evidence is unverified, disputed, or verified.';

update public.attendance_log
set
  contact_evidence_status='disputed',
  contact_evidence_note='Identity-split source row carried contact details that belong to another canonical volunteer. Retained as source evidence only; do not use for matching or communications.',
  updated_at=now()
where id='evt_identitysplit_nurul_20260726';

create index if not exists attendance_log_verified_email_idx
  on public.attendance_log(lower(email))
  where contact_evidence_status='verified'
    and email is not null;

create index if not exists attendance_log_verified_contact_idx
  on public.attendance_log(contact)
  where contact_evidence_status='verified'
    and contact is not null;

create or replace function maklom_private.quarantine_historical_resolution_contacts()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_had_email boolean := nullif(btrim(coalesce(new.email,'')),'') is not null;
  v_had_phone boolean := nullif(btrim(coalesce(new.phone,'')),'') is not null;
begin
  if new.profile_origin='historical_attendance_resolution' then
    update core.volunteers
    set
      primary_email_normalized=null,
      mobile=null,
      account_access_eligible=false,
      updated_at=now()
    where id=new.core_volunteer_id
      and auth_user_id is null;

    new.email := null;
    new.phone := null;

    perform audit.write_event(
      'volunteer.historical_contact_quarantined',
      'volunteer',
      new.core_volunteer_id::text,
      jsonb_build_object(
        'profile_origin',new.profile_origin,
        'source_email_present',v_had_email,
        'source_phone_present',v_had_phone
      ),
      auth.uid(),
      null
    );
  end if;

  return new;
end;
$$;

revoke all on function maklom_private.quarantine_historical_resolution_contacts()
  from public,anon,authenticated;

drop trigger if exists quarantine_historical_resolution_contacts
  on public.volunteers;

create trigger quarantine_historical_resolution_contacts
before insert on public.volunteers
for each row
execute function maklom_private.quarantine_historical_resolution_contacts();

create or replace view public.maklom_attendance_feed
with (security_invoker=true)
as
select
  a.id,
  a.volunteer_id,
  a.name,
  a.email,
  a.contact,
  a.attended,
  coalesce(canonical_event.title,a.event_name) as event_name,
  a.event_date,
  a.duration_minutes,
  coalesce(a.sign_in_at,source.source_sign_in_at) as sign_in_at,
  coalesce(a.sign_out_at,source.source_sign_out_at) as sign_out_at,
  coalesce(
    a.calculated_duration_minutes,
    case
      when coalesce(a.sign_in_at,source.source_sign_in_at) is not null
       and coalesce(a.sign_out_at,source.source_sign_out_at) is not null
      then greatest(
        floor(extract(epoch from (
          coalesce(a.sign_out_at,source.source_sign_out_at)
          - coalesce(a.sign_in_at,source.source_sign_in_at)
        ))/60)::integer,
        0
      )
      else null::integer
    end
  ) as calculated_duration_minutes,
  a.staff_credited_duration_minutes,
  a.staff_credit_note,
  coalesce(legacy_event.keluarga_event_id::text,a.event_id) as event_id,
  a.shift_id,
  coalesce(a.shift_label,legacy_shift.name) as shift_label,
  a.row_version,
  'maklom'::text as record_source,
  null::text as contribution_status,
  a.contact_evidence_status
from public.attendance_log a
left join public.events legacy_event on legacy_event.id=a.event_id
left join public.phaseone_events canonical_event on canonical_event.id=legacy_event.keluarga_event_id
left join public.event_shifts legacy_shift on legacy_shift.id=a.shift_id
left join lateral (
  select
    h.source_sign_in_at,
    coalesce(h.source_check_out_at,h.source_feedback_at) as source_sign_out_at
  from public.historical_attendance_import_rows h
  where h.decision='approved'
    and coalesce(h.duplicate_of_attendance_id,h.committed_attendance_id)=a.id
  order by h.reviewed_at desc nulls last,h.source_row_number desc
  limit 1
) source on true
where not (
  legacy_event.keluarga_event_id is not null
  and a.volunteer_id is not null
  and exists (
    select 1
    from public.volunteers linked_volunteer
    join public.phaseone_roster linked_roster
      on linked_roster.volunteer_id=linked_volunteer.core_volunteer_id
     and linked_roster.event_id=legacy_event.keluarga_event_id
    join public.phaseone_attendance_sessions linked_session
      on linked_session.event_id=legacy_event.keluarga_event_id
     and linked_session.origin_roster_id=linked_roster.id
     and linked_session.attendance_date=a.event_date
    where linked_volunteer.id=a.volunteer_id
      and linked_session.checked_in_at is not null
  )
)

union all

select
  'keluarga:'::text||s.id::text as id,
  mv.id as volunteer_id,
  r.volunteer_name as name,
  r.email,
  r.mobile as contact,
  s.checked_in_at is not null as attended,
  e.title as event_name,
  s.attendance_date as event_date,
  coalesce(
    greatest(floor(extract(epoch from s.checked_out_at-s.checked_in_at)/60::numeric)::integer,0),
    0
  ) as duration_minutes,
  s.checked_in_at as sign_in_at,
  s.checked_out_at as sign_out_at,
  case
    when s.checked_in_at is not null and s.checked_out_at is not null
      then greatest(floor(extract(epoch from s.checked_out_at-s.checked_in_at)/60::numeric)::integer,0)
    else null::integer
  end as calculated_duration_minutes,
  case when c.status='approved' then c.approved_minutes else null::integer end as staff_credited_duration_minutes,
  c.approval_note as staff_credit_note,
  s.event_id::text as event_id,
  null::text as shift_id,
  shift_names.shift_label,
  s.row_version,
  'keluarga'::text as record_source,
  c.status as contribution_status,
  'verified'::text as contact_evidence_status
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
