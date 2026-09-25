alter table public.volunteer_contributions
  add column if not exists event_title text;

create or replace function core.set_maklom_contribution_event_title()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  select e.title into new.event_title
  from public.phaseone_events e
  where e.id=new.event_id;
  return new;
end;
$$;

revoke all on function core.set_maklom_contribution_event_title()
  from public,anon,authenticated;

drop trigger if exists volunteer_contributions_set_event_title
  on public.volunteer_contributions;
create trigger volunteer_contributions_set_event_title
before insert or update of event_id
on public.volunteer_contributions
for each row execute function core.set_maklom_contribution_event_title();

update public.volunteer_contributions c
set event_title=e.title
from public.phaseone_events e
where e.id=c.event_id
  and c.event_title is distinct from e.title;

create or replace view public.maklom_contribution_review_queue
with (security_invoker=true)
as
select
  c.id,
  c.volunteer_id,
  d.id as maklom_volunteer_id,
  d.volunteer_code,
  d.name as volunteer_name,
  d.email as volunteer_email,
  d.phone as volunteer_phone,
  c.event_id,
  c.event_title,
  c.attendance_session_id,
  c.occurred_at,
  c.operational_minutes,
  c.approved_minutes,
  c.status,
  c.approval_note,
  c.approved_by,
  c.approved_at,
  c.created_at,
  c.updated_at
from public.volunteer_contributions c
left join public.maklom_volunteer_search_directory d
  on d.core_volunteer_id=c.volunteer_id;

revoke all on public.maklom_contribution_review_queue from anon;
grant select on public.maklom_contribution_review_queue to authenticated,service_role;
