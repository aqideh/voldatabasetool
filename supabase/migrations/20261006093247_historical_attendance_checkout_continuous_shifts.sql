CREATE OR REPLACE FUNCTION maklom_domain.review_staged_attendance_impl(p_row_id text, p_expected_version bigint, p_decision text, p_keluarga_event_id uuid, p_keluarga_timeslot_id uuid, p_target_core_volunteer_id uuid, p_reason_note text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_event public.phaseone_events%rowtype;
  v_core_volunteer_id uuid;
  v_maklom_volunteer_id text;
  v_roster public.phaseone_roster%rowtype;
  v_session public.phaseone_attendance_sessions%rowtype;
  v_note text := btrim(coalesce(p_reason_note,''));
  v_timeslot_ids uuid[];
  v_origin_timeslot_id uuid;
  v_origin_roster_id uuid;
  v_existing boolean := false;
  v_transition jsonb;
  v_timeslot_count integer := 0;
  v_checkout_at timestamptz;
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

  v_checkout_at := v_row.source_feedback_at;
  if v_checkout_at is not null and v_checkout_at < v_row.source_sign_in_at then
    raise exception 'Source check-out cannot be before source sign-in' using errcode='22023';
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
    select array_agg(slot.id order by slot.starts_at), count(*)::integer
    into v_timeslot_ids, v_timeslot_count
    from public.phaseone_event_timeslots slot
    where slot.id=p_keluarga_timeslot_id
      and slot.event_id=p_keluarga_event_id
      and slot.status <> 'cancelled'
      and timezone('Asia/Singapore',slot.starts_at)::date=v_row.event_date;

    if v_timeslot_count <> 1 then
      raise exception 'The selected Keluarga shift is unavailable for this attendance date'
        using errcode='P0001';
    end if;
  elsif v_checkout_at is not null then
    select array_agg(slot.id order by slot.starts_at), count(*)::integer
    into v_timeslot_ids, v_timeslot_count
    from public.phaseone_event_timeslots slot
    where slot.event_id=p_keluarga_event_id
      and slot.status <> 'cancelled'
      and timezone('Asia/Singapore',slot.starts_at)::date=v_row.event_date
      and slot.starts_at < v_checkout_at
      and (slot.ends_at is null or slot.ends_at > v_row.source_sign_in_at);

    if v_timeslot_count = 0 then
      raise exception 'No Keluarga shift overlaps the source sign-in/check-out interval'
        using errcode='P0001';
    end if;
  else
    select array_agg(slot.id order by slot.starts_at), count(*)::integer
    into v_timeslot_ids, v_timeslot_count
    from public.phaseone_event_timeslots slot
    where slot.event_id=p_keluarga_event_id
      and slot.status <> 'cancelled'
      and timezone('Asia/Singapore',slot.starts_at)::date=v_row.event_date
      and slot.starts_at <= v_row.source_sign_in_at
      and (slot.ends_at is null or v_row.source_sign_in_at < slot.ends_at);

    if v_timeslot_count = 0 then
      raise exception 'No Keluarga shift contains the source sign-in time'
        using errcode='P0001';
    elsif v_timeslot_count > 1 then
      raise exception 'Multiple Keluarga shifts contain the source sign-in time'
        using errcode='P0001';
    end if;
  end if;

  select slot.id
  into v_origin_timeslot_id
  from public.phaseone_event_timeslots slot
  where slot.id = any(v_timeslot_ids)
    and slot.starts_at <= v_row.source_sign_in_at
    and (slot.ends_at is null or v_row.source_sign_in_at < slot.ends_at)
  order by slot.starts_at
  limit 1;

  if v_origin_timeslot_id is null then
    v_origin_timeslot_id := v_timeslot_ids[1];
  end if;

  perform public.phaseone_add_database_volunteers_to_roster(
    p_keluarga_event_id,
    v_timeslot_ids,
    array[v_core_volunteer_id],
    p_actor
  );

  select r.id
  into v_origin_roster_id
  from public.phaseone_roster r
  where r.event_id=p_keluarga_event_id
    and r.volunteer_id=v_core_volunteer_id
    and r.timeslot_id=v_origin_timeslot_id
  order by r.id
  limit 1;

  if v_origin_roster_id is null then
    raise exception 'Volunteer roster assignment could not be resolved'
      using errcode='P0001';
  end if;

  select * into v_roster
  from public.phaseone_roster
  where id=v_origin_roster_id
  for update;

  if v_roster.attendance_person_key is null then
    raise exception 'Roster row has no attendance identity key' using errcode='P0001';
  end if;

  select * into v_session
  from public.phaseone_attendance_sessions
  where event_id=p_keluarga_event_id
    and attendance_date=v_row.event_date
    and person_key=v_roster.attendance_person_key
  order by checked_in_at
  limit 1
  for update;

  if found then
    v_existing := true;
  else
    select public.phaseone_apply_attendance_transition(
      p_keluarga_event_id,
      v_origin_roster_id,
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
      raise exception 'Keluarga attendance session could not be resolved after sign-in'
        using errcode='P0001';
    end if;
  end if;

  if v_checkout_at is not null and v_session.checked_out_at is null then
    perform public.phaseone_apply_attendance_transition(
      p_keluarga_event_id,
      v_origin_roster_id,
      'mark_sign_out',
      v_checkout_at,
      coalesce(nullif(v_note,''),'Historical source check-out accepted in MakLom'),
      p_actor
    );

    select * into v_session
    from public.phaseone_attendance_sessions
    where id=v_session.id;
  end if;

  update public.historical_attendance_import_rows
  set
    matched_core_volunteer_id=v_core_volunteer_id,
    matched_volunteer_id=coalesce(v_maklom_volunteer_id,matched_volunteer_id),
    matched_keluarga_event_id=p_keluarga_event_id,
    matched_keluarga_timeslot_id=v_origin_timeslot_id,
    committed_keluarga_session_id=v_session.id,
    match_status=case when v_existing then 'duplicate' else 'matched' end,
    match_reason=case
      when v_existing then 'Attendance already existed for this Keluarga event session'
      when v_checkout_at is not null and v_timeslot_count > 1
        then 'Accepted as continuous Keluarga attendance across '||v_timeslot_count||' adjacent shifts'
      when v_checkout_at is not null
        then 'Accepted with source sign-in and source check-out'
      else 'Accepted with source sign-in'
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
      'origin_timeslot_id',v_origin_timeslot_id,
      'linked_timeslot_ids',to_jsonb(v_timeslot_ids),
      'linked_shift_count',v_timeslot_count,
      'roster_id',v_origin_roster_id,
      'volunteer_id',v_core_volunteer_id,
      'session_id',v_session.id,
      'source_row_number',v_row.source_row_number,
      'source_sign_in_at',v_row.source_sign_in_at,
      'source_check_out_at',v_checkout_at,
      'existing_session',v_existing,
      'review_note',v_note
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
    'origin_timeslot_id',v_origin_timeslot_id,
    'linked_timeslot_ids',to_jsonb(v_timeslot_ids),
    'linked_shift_count',v_timeslot_count,
    'checked_in_at',v_session.checked_in_at,
    'checked_out_at',v_session.checked_out_at
  );
end;
$function$

