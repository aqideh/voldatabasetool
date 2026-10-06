-- Hardening for MakLom event workspace: cover FKs and route historical
-- attendance acceptance through Keluarga's canonical attendance transition.

create index if not exists pending_volunteer_identities_claimed_core_idx
  on public.pending_volunteer_identities(claimed_core_volunteer_id)
  where claimed_core_volunteer_id is not null;
create index if not exists pending_volunteer_identities_created_by_idx
  on public.pending_volunteer_identities(created_by);
create index if not exists pending_volunteer_identities_updated_by_idx
  on public.pending_volunteer_identities(updated_by);
create index if not exists phaseone_roster_operational_overrides_event_idx
  on public.phaseone_roster_operational_overrides(event_id);
create index if not exists phaseone_roster_operational_overrides_updated_by_idx
  on public.phaseone_roster_operational_overrides(updated_by);

create or replace function maklom_domain.review_staged_attendance_impl(
  p_row_id text,
  p_expected_version bigint,
  p_decision text,
  p_keluarga_event_id uuid,
  p_keluarga_timeslot_id uuid,
  p_target_core_volunteer_id uuid,
  p_reason_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_event public.phaseone_events%rowtype;
  v_core_volunteer_id uuid;
  v_maklom_volunteer_id text;
  v_roster public.phaseone_roster%rowtype;
  v_roster_count integer;
  v_session public.phaseone_attendance_sessions%rowtype;
  v_existing boolean := false;
  v_note text := btrim(coalesce(p_reason_note,''));
  v_transition jsonb;
  v_shift_date date;
begin
  perform maklom_domain.require_editor(p_actor);

  if lower(btrim(coalesce(p_decision,''))) not in ('accept','reject') then
    raise exception 'Decision must be accept or reject' using errcode='22023';
  end if;

  if char_length(v_note) > 500 then
    raise exception 'Review note must be 500 characters or fewer' using errcode='22023';
  end if;

  select * into v_row
  from public.historical_attendance_import_rows
  where id=p_row_id
  for update;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;

  if v_row.row_version <> p_expected_version then
    raise exception 'Staged attendance changed since it was opened. Refresh before reviewing it.'
      using errcode='40001';
  end if;

  select * into v_event
  from public.phaseone_events
  where id=p_keluarga_event_id;

  if not found then
    raise exception 'Keluarga event not found' using errcode='P0002';
  end if;

  if lower(btrim(p_decision))='reject' then
    update public.historical_attendance_import_rows
    set
      matched_keluarga_event_id=p_keluarga_event_id,
      matched_keluarga_timeslot_id=p_keluarga_timeslot_id,
      decision='rejected',
      decision_note=coalesce(nullif(v_note,''),'Rejected from event workspace'),
      reviewed_at=now(),
      reviewed_by=p_actor
    where id=p_row_id;

    perform audit.write_event(
      'maklom.historical_attendance_rejected',
      'historical_attendance',
      p_row_id,
      jsonb_build_object(
        'event_id',p_keluarga_event_id,
        'timeslot_id',p_keluarga_timeslot_id,
        'source_row_number',v_row.source_row_number,
        'review_note',v_note
      ),
      p_actor,
      null
    );

    return jsonb_build_object('row_id',p_row_id,'decision','rejected');
  end if;

  if v_row.source_sign_in_at is null then
    raise exception 'This staged row has no usable sign-in timestamp' using errcode='22023';
  end if;

  v_core_volunteer_id := coalesce(p_target_core_volunteer_id,v_row.matched_core_volunteer_id);

  if v_core_volunteer_id is null or not exists (
    select 1 from core.volunteers v where v.id=v_core_volunteer_id
  ) then
    raise exception 'Resolve this row to an existing volunteer before accepting attendance'
      using errcode='P0001';
  end if;

  select id into v_maklom_volunteer_id
  from public.volunteers
  where core_volunteer_id=v_core_volunteer_id
  limit 1;

  if p_keluarga_timeslot_id is not null then
    select * into v_roster
    from public.phaseone_roster
    where event_id=p_keluarga_event_id
      and volunteer_id=v_core_volunteer_id
      and timeslot_id=p_keluarga_timeslot_id
    order by id
    limit 1
    for update;

    if not found then
      raise exception 'The selected volunteer is not rostered for that event shift' using errcode='P0001';
    end if;
  else
    select count(*)::integer into v_roster_count
    from public.phaseone_roster
    where event_id=p_keluarga_event_id
      and volunteer_id=v_core_volunteer_id;

    if v_roster_count=0 then
      raise exception 'The matched volunteer is not on this event roster' using errcode='P0001';
    elsif v_roster_count>1 then
      raise exception 'Choose the specific event shift before accepting attendance' using errcode='P0001';
    end if;

    select * into v_roster
    from public.phaseone_roster
    where event_id=p_keluarga_event_id
      and volunteer_id=v_core_volunteer_id
    order by id
    limit 1
    for update;
  end if;

  if v_roster.attendance_person_key is null then
    raise exception 'Roster row has no attendance identity key' using errcode='P0001';
  end if;

  select timezone('Asia/Singapore', slot.starts_at)::date
  into v_shift_date
  from public.phaseone_event_timeslots slot
  where slot.id=v_roster.timeslot_id
    and slot.event_id=p_keluarga_event_id
    and slot.status <> 'cancelled';

  if v_shift_date is null then
    raise exception 'The rostered event shift is unavailable' using errcode='P0001';
  end if;

  if v_shift_date <> v_row.event_date then
    raise exception 'The staged attendance date does not match the selected Keluarga shift'
      using errcode='P0001';
  end if;

  select * into v_session
  from public.phaseone_attendance_sessions
  where event_id=p_keluarga_event_id
    and attendance_date=v_shift_date
    and person_key=v_roster.attendance_person_key
  for update;

  if found then
    v_existing := true;
  else
    select public.phaseone_apply_attendance_transition(
      p_keluarga_event_id,
      v_roster.id,
      'mark_sign_in',
      v_row.source_sign_in_at,
      coalesce(nullif(v_note,''),'Historical attendance accepted in MakLom'),
      p_actor
    ) into v_transition;

    if nullif(v_transition->>'session_id','') is null then
      raise exception 'Keluarga attendance transition did not create an attendance session'
        using errcode='P0001';
    end if;

    select * into v_session
    from public.phaseone_attendance_sessions
    where id=(v_transition->>'session_id')::uuid
    for update;

    if not found then
      raise exception 'Keluarga attendance session could not be resolved after transition'
        using errcode='P0001';
    end if;
  end if;

  update public.historical_attendance_import_rows
  set
    matched_core_volunteer_id=v_core_volunteer_id,
    matched_volunteer_id=coalesce(v_maklom_volunteer_id,matched_volunteer_id),
    matched_keluarga_event_id=p_keluarga_event_id,
    matched_keluarga_timeslot_id=v_roster.timeslot_id,
    committed_keluarga_session_id=v_session.id,
    match_status=case when v_existing then 'duplicate' else 'matched' end,
    match_reason=case
      when v_existing then 'Attendance already existed for this Keluarga event session'
      else 'Accepted through Keluarga attendance transition from staged historical attendance'
    end,
    decision='approved',
    decision_note=coalesce(nullif(v_note,''),'Reviewed against Keluarga event roster'),
    reviewed_at=now(),
    reviewed_by=p_actor
  where id=p_row_id;

  perform audit.write_event(
    case when v_existing
      then 'maklom.historical_attendance_linked_existing'
      else 'maklom.historical_attendance_accepted'
    end,
    'historical_attendance',
    p_row_id,
    jsonb_build_object(
      'event_id',p_keluarga_event_id,
      'timeslot_id',v_roster.timeslot_id,
      'roster_id',v_roster.id,
      'volunteer_id',v_core_volunteer_id,
      'session_id',v_session.id,
      'source_row_number',v_row.source_row_number,
      'source_sign_in_at',v_row.source_sign_in_at,
      'existing_session',v_existing,
      'review_note',v_note,
      'domain_transition_used',not v_existing
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'row_id',p_row_id,
    'decision','approved',
    'session_id',v_session.id,
    'existing_session',v_existing,
    'event_id',p_keluarga_event_id,
    'timeslot_id',v_roster.timeslot_id
  );
end;
$$;

create or replace function public.maklom_event_review_staged_attendance(
  p_row_id text,
  p_expected_version bigint,
  p_decision text,
  p_keluarga_event_id uuid,
  p_keluarga_timeslot_id uuid default null,
  p_target_core_volunteer_id uuid default null,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.review_staged_attendance_impl(
    p_row_id,p_expected_version,p_decision,p_keluarga_event_id,
    p_keluarga_timeslot_id,p_target_core_volunteer_id,p_reason_note,auth.uid()
  );
end;
$$;

grant execute on function maklom_domain.review_staged_attendance_impl(
  text,bigint,text,uuid,uuid,uuid,text,uuid
) to authenticated,service_role;

revoke all on function public.maklom_event_review_staged_attendance(
  text,bigint,text,uuid,uuid,uuid,text
) from public,anon;
grant execute on function public.maklom_event_review_staged_attendance(
  text,bigint,text,uuid,uuid,uuid,text
) to authenticated,service_role;
