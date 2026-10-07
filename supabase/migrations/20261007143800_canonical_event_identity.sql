-- Canonical event identity across Keluarga and MakLom.
-- Keluarga phaseone_events is the canonical operational identity.
-- public.events remains a legacy/provenance container and may link to one canonical event.

create or replace function maklom_domain.event_identity_tokens(p_value text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(coalesce(p_value,'')),
                '\\mready\\s*set\\s*learn\\M',
                ' rsl ',
                'g'
              ),
              '\\mreadysetlearn\\M',
              ' rsl ',
              'g'
            ),
            '\\mraikan\\s+ilmu\\M',
            ' ri ',
            'g'
          ),
          '\\mmaths?\\s+explorer(?:\\s+buddy)?\\M',
          ' ',
          'g'
        ),
        '\\mcommunity\\s+(?:club|centre|center)\\M',
        ' cc ',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    ) as value
  ),
  tokens as (
    select distinct token
    from normalized,
         unnest(regexp_split_to_array(btrim(value), '\\s+')) as token
    where token <> ''
  )
  select coalesce(array_agg(token order by token), '{}'::text[])
  from tokens;
$$;

create or replace function maklom_domain.event_identity_strong_match(p_left text,p_right text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with
  left_tokens as (
    select unnest(maklom_domain.event_identity_tokens(p_left)) as token
  ),
  right_tokens as (
    select unnest(maklom_domain.event_identity_tokens(p_right)) as token
  ),
  counts as (
    select
      (select count(*) from left_tokens)::numeric as left_count,
      (select count(*) from right_tokens)::numeric as right_count,
      (
        select count(*)
        from left_tokens l
        join right_tokens r using (token)
      )::numeric as overlap_count
  )
  select case
    when left_count = 0 or right_count = 0 then false
    when overlap_count < 3 then false
    else overlap_count / least(left_count,right_count) >= 0.70
      and overlap_count / greatest(left_count,right_count) >= 0.45
  end
  from counts;
$$;

create or replace function maklom_domain.resolve_or_create_legacy_event_impl(
  p_id text,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_programme text,
  p_venue text,
  p_notes text,
  p_status text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name,''));
  v_venue text := nullif(btrim(coalesce(p_venue,'')),'');
  v_programme text := nullif(btrim(coalesce(p_programme,'')),'');
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_status text := lower(btrim(coalesce(p_status,'active')));
  v_candidate_count integer := 0;
  v_keluarga_event_id uuid;
  v_event public.events%rowtype;
begin
  perform maklom_domain.require_editor(p_actor);

  if nullif(btrim(coalesce(p_id,'')),'') is null then
    raise exception 'Event ID is required' using errcode='22023';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Event name is required' using errcode='22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid event date range is required' using errcode='22023';
  end if;
  if v_status not in ('active','archived') then
    raise exception 'Event status must be active or archived' using errcode='22023';
  end if;

  with canonical as (
    select
      e.id,
      e.title,
      e.venue,
      coalesce(
        min(timezone('Asia/Singapore',t.starts_at)::date),
        timezone('Asia/Singapore',e.reporting_at)::date,
        timezone('Asia/Singapore',e.created_at)::date
      ) as start_date,
      coalesce(
        max(timezone('Asia/Singapore',coalesce(t.ends_at,t.starts_at))::date),
        timezone('Asia/Singapore',e.reporting_at)::date,
        timezone('Asia/Singapore',e.created_at)::date
      ) as end_date
    from public.phaseone_events e
    left join public.phaseone_event_timeslots t
      on t.event_id=e.id
     and t.status <> 'cancelled'
    where e.operations_scope='canonical'
    group by e.id,e.title,e.venue,e.reporting_at,e.created_at
  ),
  candidates as (
    select id
    from canonical
    where start_date=p_start_date
      and end_date=p_end_date
      and (
        regexp_replace(lower(btrim(title)),'[^a-z0-9]+','','g')
          = regexp_replace(lower(v_name),'[^a-z0-9]+','','g')
        or maklom_domain.event_identity_strong_match(
          concat_ws(' ',title,venue),
          concat_ws(' ',v_name,v_venue)
        )
      )
  )
  select count(*)::integer,(array_agg(id order by id))[1]
  into v_candidate_count,v_keluarga_event_id
  from candidates;

  if v_candidate_count > 1 then
    raise exception 'More than one Keluarga event matches this event. Resolve the event match before importing attendance.'
      using errcode='P0001';
  end if;

  if v_keluarga_event_id is not null then
    select * into v_event
    from public.events
    where keluarga_event_id=v_keluarga_event_id
    limit 1
    for update;

    if found then
      return to_jsonb(v_event);
    end if;
  end if;

  select * into v_event
  from public.events
  where id=p_id
  for update;

  if found then
    if v_keluarga_event_id is not null and v_event.keluarga_event_id is null then
      update public.events
      set keluarga_event_id=v_keluarga_event_id
      where id=v_event.id
      returning * into v_event;
    end if;
    return to_jsonb(v_event);
  end if;

  select * into v_event
  from public.events
  where start_date=p_start_date
    and end_date=p_end_date
    and regexp_replace(lower(btrim(name)),'[^a-z0-9]+','','g')
      = regexp_replace(lower(v_name),'[^a-z0-9]+','','g')
  order by created_at,id
  limit 1
  for update;

  if found then
    if v_keluarga_event_id is not null and v_event.keluarga_event_id is null then
      update public.events
      set keluarga_event_id=v_keluarga_event_id
      where id=v_event.id
      returning * into v_event;
    end if;
    return to_jsonb(v_event);
  end if;

  insert into public.events(
    id,name,start_date,end_date,programme,venue,notes,status,keluarga_event_id
  )
  values(
    p_id,v_name,p_start_date,p_end_date,v_programme,v_venue,v_notes,v_status,v_keluarga_event_id
  )
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

create or replace function public.maklom_resolve_or_create_legacy_event(
  p_id text,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_programme text default null,
  p_venue text default null,
  p_notes text default null,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.resolve_or_create_legacy_event_impl(
    p_id,p_name,p_start_date,p_end_date,p_programme,p_venue,p_notes,p_status,auth.uid()
  );
end;
$$;

grant execute on function maklom_domain.resolve_or_create_legacy_event_impl(
  text,text,date,date,text,text,text,text,uuid
) to authenticated,service_role;

revoke all on function public.maklom_resolve_or_create_legacy_event(
  text,text,date,date,text,text,text,text
) from public,anon;
grant execute on function public.maklom_resolve_or_create_legacy_event(
  text,text,date,date,text,text,text,text
) to authenticated,service_role;

-- Backfill known duplicate identities. These rows keep their historical shifts and
-- attendance, but are no longer separate event identities in MakLom.
update public.events
set keluarga_event_id='f3cfe59f-c62f-4155-b9e4-750d7518c5c5'::uuid
where id='event_report_event_1n1jtsi'
  and keluarga_event_id is null;

update public.events
set keluarga_event_id='9196a187-d2a7-47d5-86ea-a6fd7a616684'::uuid
where id='event_report_event_v951l6'
  and keluarga_event_id is null;

update public.events
set keluarga_event_id='a596db76-6dda-4323-997b-9e63611397d4'::uuid
where id='event_report_event_1hiobyj'
  and keluarga_event_id is null;

update public.events
set keluarga_event_id='29b114dd-2e75-40bb-b342-57087e634701'::uuid
where id='event_mtv0ktgx_i562sg2'
  and keluarga_event_id is null;

update public.events
set keluarga_event_id='7704c9ce-8ed6-4bc8-a1f6-56bf25eb9716'::uuid
where id='event_mttj68ma_orpk3om'
  and keluarga_event_id is null;

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
    e.created_at,
    e.updated_at,
    coalesce(
      min(timezone('Asia/Singapore',t.starts_at)::date),
      timezone('Asia/Singapore',e.reporting_at)::date,
      timezone('Asia/Singapore',e.created_at)::date
    ) as start_date,
    coalesce(
      max(timezone('Asia/Singapore',coalesce(t.ends_at,t.starts_at))::date),
      timezone('Asia/Singapore',e.reporting_at)::date,
      timezone('Asia/Singapore',e.created_at)::date
    ) as end_date
  from public.phaseone_events e
  left join public.phaseone_event_timeslots t
    on t.event_id=e.id
   and t.status <> 'cancelled'
  where e.operations_scope='canonical'
  group by
    e.id,e.title,e.venue,e.opportunity_category,e.opportunity_summary,
    e.opportunity_description,e.is_published,e.reporting_at,e.created_at,e.updated_at
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
  'Canonical MakLom event read model: all Keluarga canonical events plus only unlinked legacy MakLom events. Linked legacy rows remain provenance and never create a second event identity.';

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
        floor(
          extract(epoch from (
            coalesce(a.sign_out_at,source.source_sign_out_at)
            - coalesce(a.sign_in_at,source.source_sign_in_at)
          )) / 60
        )::integer,
        0
      )
      else null
    end
  ) as calculated_duration_minutes,
  a.staff_credited_duration_minutes,
  a.staff_credit_note,
  coalesce(legacy_event.keluarga_event_id::text,a.event_id) as event_id,
  a.shift_id,
  coalesce(a.shift_label,legacy_shift.name) as shift_label,
  a.row_version,
  'maklom'::text as record_source,
  null::text as contribution_status
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
  'keluarga:'::text || s.id::text,
  mv.id,
  r.volunteer_name,
  r.email,
  r.mobile,
  s.checked_in_at is not null,
  e.title,
  s.attendance_date,
  coalesce(
    greatest(floor(extract(epoch from s.checked_out_at-s.checked_in_at)/60)::integer,0),
    0
  ),
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

comment on view public.maklom_attendance_feed is
  'Canonical attendance read model. Historical MakLom attendance linked to a Keluarga event is surfaced under the canonical event ID, with Keluarga sessions preferred when both represent the same volunteer/date evidence.';
