create or replace view public.maklom_volunteer_search_directory
with (security_invoker = true)
as
with attendance_summary as (
  select
    volunteer_id,
    count(*)::integer as attendance_rows,
    coalesce(sum(
      case when attended then
        coalesce(staff_credited_duration_minutes,calculated_duration_minutes,duration_minutes,0)
      else 0 end
    ),0)::bigint as total_credited_minutes,
    max(event_date) filter (where attended) as last_active
  from public.attendance_log
  where volunteer_id is not null
  group by volunteer_id
)
select
  v.id,v.core_volunteer_id,c.volunteer_code,v.name,v.nric,v.phone,v.email,v.gender,
  v.address,v.recruited_year,v.chat_session,v.chat_session_date,v.interests,
  v.languages_spoken,v.programmes_registered,v.tags,v.emergency_name,v.emergency_phone,
  v.shirt_size,v.dietary,v.notes,v.updated_at,v.row_version,
  coalesce(a.attendance_rows,0) as attendance_rows,
  coalesce(a.total_credited_minutes,0) as total_credited_minutes,
  a.last_active,
  coalesce((select min(tag) from unnest(v.tags) tag),'') as first_tag,
  lower(concat_ws(' ',
    c.volunteer_code,v.name,v.phone,v.email,v.gender,v.address,
    v.neighbourhood,v.planning_area,v.electoral_division,
    v.recruited_year::text,v.chat_session,v.chat_session_date::text,v.interests,v.languages_spoken,
    array_to_string(v.programmes_registered,' '),array_to_string(v.tags,' '),
    v.shirt_size,v.dietary,v.notes
  )) as search_text,
  v.neighbourhood,
  v.planning_area,
  v.electoral_division
from public.volunteers v
join core.volunteers c on c.id=v.core_volunteer_id
left join attendance_summary a on a.volunteer_id=v.id;

revoke all on public.maklom_volunteer_search_directory from anon;
grant select on public.maklom_volunteer_search_directory to authenticated,service_role;
