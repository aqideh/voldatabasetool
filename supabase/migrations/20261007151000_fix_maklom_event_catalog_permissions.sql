-- Fix MakLom canonical event catalog access.
-- The security-invoker view must reference only columns that authenticated MakLom users
-- are explicitly allowed to read from Keluarga's phaseone event tables.

create or replace view public.maklom_event_catalog
with (security_invoker = true)
as
with canonical as (
  select
    e.id,
    e.title,
    e.venue,
    e.opportunity_category,
    e.opportunity_summary,
    e.opportunity_description,
    e.is_published,
    e.reporting_at,
    e.updated_at,
    coalesce(
      min(timezone('Asia/Singapore',t.starts_at)::date),
      timezone('Asia/Singapore',e.reporting_at)::date
    ) as start_date,
    coalesce(
      max(timezone('Asia/Singapore',coalesce(t.ends_at,t.starts_at))::date),
      timezone('Asia/Singapore',e.reporting_at)::date
    ) as end_date
  from public.phaseone_events e
  left join public.phaseone_event_timeslots t
    on t.event_id=e.id
   and t.status <> 'cancelled'
  where e.operations_scope='canonical'
  group by
    e.id,e.title,e.venue,e.opportunity_category,e.opportunity_summary,
    e.opportunity_description,e.is_published,e.reporting_at,e.updated_at
)
select
  'keluarga:'::text || c.id::text as id,
  c.title as name,
  c.start_date,
  c.end_date,
  c.opportunity_category as programme,
  c.venue,
  coalesce(c.opportunity_summary,c.opportunity_description) as notes,
  case when c.is_published then 'active'::text else 'archived'::text end as status,
  c.updated_at,
  1::bigint as row_version,
  'keluarga'::text as source,
  c.id as keluarga_event_id
from canonical c
union all
select
  e.id,
  e.name,
  e.start_date,
  e.end_date,
  e.programme,
  e.venue,
  e.notes,
  e.status,
  e.updated_at,
  e.row_version,
  'maklom'::text as source,
  null::uuid as keluarga_event_id
from public.events e
where e.keluarga_event_id is null;

revoke all on public.maklom_event_catalog from anon;
grant select on public.maklom_event_catalog to authenticated,service_role;

comment on view public.maklom_event_catalog is
  'Canonical MakLom event read model using only Keluarga columns exposed to authenticated MakLom users.';
