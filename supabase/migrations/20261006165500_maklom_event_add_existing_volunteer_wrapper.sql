create or replace function public.maklom_event_add_existing_volunteer_to_roster(
  p_event_id uuid,
  p_timeslot_id uuid,
  p_volunteer_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform maklom_domain.require_editor(auth.uid());

  return public.phaseone_add_database_volunteers_to_roster(
    p_event_id,
    array[p_timeslot_id],
    array[p_volunteer_id],
    auth.uid()
  );
end;
$$;

revoke all on function public.maklom_event_add_existing_volunteer_to_roster(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.maklom_event_add_existing_volunteer_to_roster(uuid,uuid,uuid)
  to authenticated, service_role;
