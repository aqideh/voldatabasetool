create or replace function core.capture_maklom_contributions_after_roster_match()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, core
as $$
begin
  if new.volunteer_id is null or new.volunteer_id is not distinct from old.volunteer_id then
    return new;
  end if;

  insert into public.volunteer_contributions (
    volunteer_id,
    event_id,
    attendance_session_id,
    occurred_at,
    operational_minutes,
    status
  )
  select
    new.volunteer_id,
    s.event_id,
    s.id,
    s.checked_out_at,
    greatest(
      floor(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::integer,
      0
    ),
    'pending'
  from public.phaseone_attendance_sessions s
  where s.origin_roster_id = new.id
    and s.checked_in_at is not null
    and s.checked_out_at is not null
  on conflict (attendance_session_id) do update
  set
    volunteer_id = excluded.volunteer_id,
    event_id = excluded.event_id,
    occurred_at = excluded.occurred_at,
    status = case
      when public.volunteer_contributions.status = 'approved'
        and public.volunteer_contributions.operational_minutes is distinct from excluded.operational_minutes
        then 'needs_review'
      when public.volunteer_contributions.status = 'rejected'
        then 'pending'
      else public.volunteer_contributions.status
    end,
    approved_at = case
      when public.volunteer_contributions.status = 'approved'
        and public.volunteer_contributions.operational_minutes is distinct from excluded.operational_minutes
        then null
      else public.volunteer_contributions.approved_at
    end,
    approved_by = case
      when public.volunteer_contributions.status = 'approved'
        and public.volunteer_contributions.operational_minutes is distinct from excluded.operational_minutes
        then null
      else public.volunteer_contributions.approved_by
    end,
    operational_minutes = excluded.operational_minutes,
    updated_at = now();

  return new;
end;
$$;

revoke all on function core.capture_maklom_contributions_after_roster_match()
from public, anon, authenticated;

drop trigger if exists phaseone_roster_capture_maklom_contribution
  on public.phaseone_roster;
create trigger phaseone_roster_capture_maklom_contribution
after update of volunteer_id
on public.phaseone_roster
for each row
when (new.volunteer_id is not null and old.volunteer_id is distinct from new.volunteer_id)
execute function core.capture_maklom_contributions_after_roster_match();

insert into public.volunteer_contributions (
  volunteer_id,
  event_id,
  attendance_session_id,
  occurred_at,
  operational_minutes,
  status
)
select
  r.volunteer_id,
  s.event_id,
  s.id,
  s.checked_out_at,
  greatest(
    floor(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::integer,
    0
  ),
  'pending'
from public.phaseone_attendance_sessions s
join public.phaseone_roster r on r.id = s.origin_roster_id
where s.checked_in_at is not null
  and s.checked_out_at is not null
  and r.volunteer_id is not null
on conflict (attendance_session_id) do nothing;
