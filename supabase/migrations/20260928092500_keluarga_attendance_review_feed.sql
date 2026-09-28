grant select (
  id,event_id,attendance_date,person_key,origin_roster_id,
  checked_in_at,checked_out_at,created_at,updated_at
) on public.phaseone_attendance_sessions to authenticated;

grant select (
  id,event_id,volunteer_key,volunteer_name,email,mobile,email_normalized,
  attendance_person_key,timeslot_id,volunteer_id,entry_method
) on public.phaseone_roster to authenticated;

drop policy if exists "MakLom members can read KELUARGA attendance session shifts"
  on public.phaseone_attendance_session_shifts;
create policy "MakLom members can read KELUARGA attendance session shifts"
on public.phaseone_attendance_session_shifts
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
  )
);

grant select (
  session_id,event_id,roster_id,timeslot_id,continuation_type,linked_at
) on public.phaseone_attendance_session_shifts to authenticated;

create or replace function core.resolve_roster_volunteer_from_unique_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, core
as $$
declare
  matched_ids uuid[];
begin
  if new.volunteer_id is not null then
    return new;
  end if;

  if new.email_normalized is null or btrim(new.email_normalized) = '' then
    return new;
  end if;

  select array_agg(v.id order by v.id)
  into matched_ids
  from core.volunteers v
  where v.primary_email_normalized = lower(btrim(new.email_normalized));

  if coalesce(cardinality(matched_ids), 0) = 1 then
    new.volunteer_id := matched_ids[1];
  end if;

  return new;
end;
$$;

revoke all on function core.resolve_roster_volunteer_from_unique_email()
from public, anon, authenticated;

drop trigger if exists resolve_roster_volunteer_from_unique_email
  on public.phaseone_roster;
create trigger resolve_roster_volunteer_from_unique_email
before insert or update of email, email_normalized, volunteer_id
on public.phaseone_roster
for each row execute function core.resolve_roster_volunteer_from_unique_email();

with candidates as (
  select r.id as roster_id, (array_agg(v.id order by v.id))[1] as volunteer_id
  from public.phaseone_roster r
  join core.volunteers v
    on v.primary_email_normalized = lower(btrim(r.email_normalized))
  where r.volunteer_id is null
    and r.email_normalized is not null
    and btrim(r.email_normalized) <> ''
  group by r.id
  having count(*) = 1
)
update public.phaseone_roster r
set volunteer_id = c.volunteer_id
from candidates c
where r.id = c.roster_id
  and r.volunteer_id is null;

update public.maklom_profile_inbox inbox
set volunteer_id = roster.volunteer_id,
    status = 'pending',
    updated_at = now()
from public.phaseone_volunteer_reviews review
join public.phaseone_roster roster on roster.id = review.roster_id
where inbox.source_kind = 'review'
  and inbox.source_record_id = review.id
  and inbox.status = 'needs_match'
  and roster.volunteer_id is not null;

update public.maklom_profile_inbox inbox
set volunteer_id = roster.volunteer_id,
    status = 'pending',
    updated_at = now()
from public.phaseone_volunteer_insights insight
join public.phaseone_roster roster on roster.id = insight.roster_id
where inbox.source_kind = 'insight'
  and inbox.source_record_id = insight.id
  and inbox.status = 'needs_match'
  and roster.volunteer_id is not null;

create or replace view public.maklom_attendance_feed
with (security_invoker = true)
as
select
  a.id,
  a.volunteer_id,
  a.name,
  a.email,
  a.contact,
  a.attended,
  a.event_name,
  a.event_date,
  a.duration_minutes,
  a.sign_in_at,
  a.sign_out_at,
  a.calculated_duration_minutes,
  a.staff_credited_duration_minutes,
  a.staff_credit_note,
  a.event_id,
  a.shift_id,
  a.shift_label,
  a.row_version,
  'maklom'::text as record_source
from public.attendance_log a
union all
select
  'keluarga:' || s.id::text as id,
  mv.id as volunteer_id,
  r.volunteer_name as name,
  r.email,
  r.mobile as contact,
  (s.checked_in_at is not null) as attended,
  e.title as event_name,
  s.attendance_date as event_date,
  coalesce(
    greatest(floor(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::integer, 0),
    0
  ) as duration_minutes,
  s.checked_in_at as sign_in_at,
  s.checked_out_at as sign_out_at,
  case
    when s.checked_in_at is not null and s.checked_out_at is not null
      then greatest(floor(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::integer, 0)
    else null
  end as calculated_duration_minutes,
  case when c.status = 'approved' then c.approved_minutes else null end as staff_credited_duration_minutes,
  case when c.status = 'approved' then c.approval_note else null end as staff_credit_note,
  s.event_id::text as event_id,
  null::text as shift_id,
  shift_names.shift_label,
  1::bigint as row_version,
  'keluarga'::text as record_source
from public.phaseone_attendance_sessions s
join public.phaseone_events e on e.id = s.event_id
join public.phaseone_roster r on r.id = s.origin_roster_id
left join public.volunteers mv on mv.core_volunteer_id = r.volunteer_id
left join public.volunteer_contributions c on c.attendance_session_id = s.id
left join lateral (
  select string_agg(
    coalesce(nullif(btrim(t.label), ''), 'General'),
    ', ' order by t.sort_order, t.starts_at, t.id
  ) as shift_label
  from public.phaseone_attendance_session_shifts ss
  join public.phaseone_event_timeslots t on t.id = ss.timeslot_id
  where ss.session_id = s.id
) shift_names on true;

grant select on public.maklom_attendance_feed to authenticated;
revoke all on public.maklom_attendance_feed from anon;
