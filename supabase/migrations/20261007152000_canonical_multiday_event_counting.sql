-- Canonical reporting identity for events.
-- One event remains one event even when it spans multiple days, shifts, or attendance sessions.

create or replace view public.maklom_reporting_events
with (security_invoker = true)
as
select
  case
    when c.source='keluarga' then c.id
    else 'maklom:'::text || c.id
  end as event_key,
  c.id as catalog_event_id,
  c.name,
  c.start_date,
  c.end_date,
  c.programme,
  c.venue,
  c.status,
  c.source,
  c.keluarga_event_id
from public.maklom_event_catalog c;

revoke all on public.maklom_reporting_events from anon;
grant select on public.maklom_reporting_events to authenticated,service_role;

comment on view public.maklom_reporting_events is
  'One row per canonical MakLom event identity for reporting. Multi-day shifts and attendance dates remain children of the event and never create additional event-count rows.';

create or replace view public.maklom_event_participation
with (security_invoker = true)
as
with source_rows as (
  select
    v.core_volunteer_id,
    case
      when e.keluarga_event_id is not null then 'keluarga:'::text || e.keluarga_event_id::text
      when direct_pe.id is not null then 'keluarga:'::text || direct_pe.id::text
      else 'maklom:'::text || a.event_id
    end as event_key,
    coalesce(pe.title,direct_pe.title,e.name,a.event_name) as event_title,
    a.event_date,
    'historical_attendance'::text as source_kind
  from public.attendance_log a
  join public.volunteers v on v.id=a.volunteer_id
  left join public.events e on e.id=a.event_id
  left join public.phaseone_events pe on pe.id=e.keluarga_event_id
  left join public.phaseone_events direct_pe on direct_pe.id::text=a.event_id
  where a.attended
    and a.volunteer_id is not null
    and nullif(a.event_id,'') is not null

  union all

  select
    r.volunteer_id as core_volunteer_id,
    'keluarga:'::text || s.event_id::text as event_key,
    pe.title as event_title,
    s.attendance_date as event_date,
    'keluarga_attendance'::text as source_kind
  from public.phaseone_attendance_sessions s
  join public.phaseone_roster r on r.id=s.origin_roster_id
  join public.phaseone_events pe on pe.id=s.event_id
  where r.volunteer_id is not null
)
select
  core_volunteer_id,
  event_key,
  coalesce(
    max(event_title) filter (where source_kind='keluarga_attendance'),
    max(event_title)
  ) as event_title,
  min(event_date) as event_date,
  bool_or(source_kind='historical_attendance') as has_historical_source,
  bool_or(source_kind='keluarga_attendance') as has_keluarga_source
from source_rows
group by core_volunteer_id,event_key;

revoke all on public.maklom_event_participation from anon;
grant select on public.maklom_event_participation to authenticated,service_role;

comment on view public.maklom_event_participation is
  'One row per volunteer per canonical event identity. Multiple days, shifts, and attendance sessions for the same event do not increase event_count. Attendance without an event identity is excluded from event analytics until reconciled.';
