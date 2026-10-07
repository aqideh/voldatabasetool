-- Surface approved historical source timestamps through MakLom's attendance read model
-- without overwriting the original legacy attendance credit.

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
  coalesce(a.sign_in_at, source.source_sign_in_at) as sign_in_at,
  coalesce(a.sign_out_at, source.source_sign_out_at) as sign_out_at,
  coalesce(
    a.calculated_duration_minutes,
    case
      when coalesce(a.sign_in_at, source.source_sign_in_at) is not null
       and coalesce(a.sign_out_at, source.source_sign_out_at) is not null
      then greatest(
        floor(extract(epoch from (
          coalesce(a.sign_out_at, source.source_sign_out_at)
          - coalesce(a.sign_in_at, source.source_sign_in_at)
        )) / 60)::integer,
        0
      )
      else null
    end
  ) as calculated_duration_minutes,
  a.staff_credited_duration_minutes,
  a.staff_credit_note,
  a.event_id,
  a.shift_id,
  coalesce(a.shift_label, legacy_shift.name) as shift_label,
  a.row_version,
  'maklom'::text as record_source,
  null::text as contribution_status
from public.attendance_log a
left join public.event_shifts legacy_shift on legacy_shift.id = a.shift_id
left join lateral (
  select
    h.source_sign_in_at,
    coalesce(h.source_check_out_at, h.source_feedback_at) as source_sign_out_at
  from public.historical_attendance_import_rows h
  where h.decision = 'approved'
    and coalesce(h.duplicate_of_attendance_id, h.committed_attendance_id) = a.id
  order by h.reviewed_at desc nulls last, h.source_row_number desc
  limit 1
) source on true

union all

select
  'keluarga:'::text || s.id::text as id,
  mv.id as volunteer_id,
  r.volunteer_name as name,
  r.email,
  r.mobile as contact,
  s.checked_in_at is not null as attended,
  e.title as event_name,
  s.attendance_date as event_date,
  coalesce(
    greatest(floor(extract(epoch from s.checked_out_at - s.checked_in_at) / 60::numeric)::integer, 0),
    0
  ) as duration_minutes,
  s.checked_in_at as sign_in_at,
  s.checked_out_at as sign_out_at,
  case
    when s.checked_in_at is not null and s.checked_out_at is not null
      then greatest(floor(extract(epoch from s.checked_out_at - s.checked_in_at) / 60::numeric)::integer, 0)
    else null::integer
  end as calculated_duration_minutes,
  case when c.status = 'approved'::text then c.approved_minutes else null::integer end as staff_credited_duration_minutes,
  c.approval_note as staff_credit_note,
  s.event_id::text as event_id,
  null::text as shift_id,
  shift_names.shift_label,
  s.row_version,
  'keluarga'::text as record_source,
  c.status as contribution_status
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
