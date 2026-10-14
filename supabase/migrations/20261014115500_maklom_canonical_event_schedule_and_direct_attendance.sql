-- MakLom edits the Keluarga schedule in place. Existing shift IDs are never
-- removed, because rosters, registrations and reviewed attendance reference them.
create or replace function maklom_domain.save_event_schedule_impl(
  p_event_id uuid, p_expected_updated_at timestamptz,
  p_shifts jsonb, p_reason_note text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.phaseone_events%rowtype;
  v_current public.phaseone_event_timeslots%rowtype;
  v_item jsonb;
  v_id uuid;
  v_label text;
  v_start timestamptz;
  v_end timestamptz;
  v_active_count integer := 0;
  v_existing_count integer;
  v_seen_ids uuid[] := array[]::uuid[];
  v_new_ids uuid[] := array[]::uuid[];
  v_changes jsonb := '[]'::jsonb;
  v_earliest timestamptz;
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  perform maklom_domain.require_editor(p_actor);
  if p_expected_updated_at is null then
    raise exception 'Refresh the event before correcting its schedule' using errcode='22023';
  end if;
  if char_length(v_note) < 5 or char_length(v_note) > 500 then
    raise exception 'A schedule correction reason between 5 and 500 characters is required' using errcode='22023';
  end if;
  if jsonb_typeof(p_shifts) is distinct from 'array'
     or jsonb_array_length(p_shifts) not between 1 and 100 then
    raise exception 'Provide between 1 and 100 event shifts' using errcode='22023';
  end if;

  select * into v_event from public.phaseone_events where id=p_event_id for update;
  if not found then
    raise exception 'Canonical event not found' using errcode='P0002';
  end if;
  if v_event.updated_at is distinct from p_expected_updated_at then
    raise exception 'The event has changed. Refresh before changing its schedule' using errcode='40001';
  end if;
  select count(*) into v_existing_count from public.phaseone_event_timeslots where event_id=p_event_id;

  for v_item in select value from jsonb_array_elements(p_shifts) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Invalid shift entry' using errcode='22023';
    end if;
    v_id := nullif(v_item->>'id','')::uuid;
    v_label := nullif(btrim(coalesce(v_item->>'label','')),'');
    v_start := (v_item->>'starts_at')::timestamptz;
    v_end := (v_item->>'ends_at')::timestamptz;
    if v_start is null or v_end is null or v_end <= v_start then
      raise exception 'Each shift needs an end time after its start time' using errcode='22023';
    end if;
    if v_label is not null and char_length(v_label)>120 then
      raise exception 'Shift labels must not exceed 120 characters' using errcode='22023';
    end if;
    if v_id is not null and v_id = any(v_seen_ids) then
      raise exception 'Duplicate shift in schedule submission' using errcode='22023';
    end if;

    if v_id is not null then
      select * into v_current from public.phaseone_event_timeslots
        where id=v_id and event_id=p_event_id for update;
      if not found then
        raise exception 'Shift does not belong to this event' using errcode='23503';
      end if;
      if v_current.starts_at is distinct from (v_item->>'expected_starts_at')::timestamptz
         or v_current.ends_at is distinct from (v_item->>'expected_ends_at')::timestamptz
         or v_current.label is distinct from (v_item->>'expected_label')
         or v_current.status is distinct from (v_item->>'expected_status')
         or v_current.sort_order is distinct from (v_item->>'expected_sort_order')::integer
         or v_current.registration_capacity is distinct from (v_item->>'expected_registration_capacity')::integer then
        raise exception 'A shift changed in another session. Refresh before saving' using errcode='40001';
      end if;
      v_seen_ids := array_append(v_seen_ids,v_id);
      if v_current.starts_at is distinct from v_start
         or v_current.ends_at is distinct from v_end
         or v_current.label is distinct from v_label then
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'shift_id',v_id, 'old',jsonb_build_object('label',v_current.label,'starts_at',v_current.starts_at,'ends_at',v_current.ends_at),
          'new',jsonb_build_object('label',v_label,'starts_at',v_start,'ends_at',v_end)
        ));
        update public.phaseone_event_timeslots
          set label=v_label, starts_at=v_start, ends_at=v_end
          where id=v_id;
      end if;
      if v_current.status='scheduled' then v_active_count := v_active_count+1; end if;
    else
      if coalesce(v_item->>'status','scheduled') <> 'scheduled' then
        raise exception 'New shifts must be scheduled' using errcode='22023';
      end if;
      insert into public.phaseone_event_timeslots(event_id,label,starts_at,ends_at,status,sort_order)
        values (p_event_id,v_label,v_start,v_end,'scheduled',
          (select coalesce(max(sort_order),-1)+1 from public.phaseone_event_timeslots where event_id=p_event_id))
        returning id into v_id;
      v_new_ids := array_append(v_new_ids,v_id);
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'shift_id',v_id,'old',null,'new',jsonb_build_object('label',v_label,'starts_at',v_start,'ends_at',v_end)
      ));
      v_active_count := v_active_count+1;
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids,1),0) <> v_existing_count then
    raise exception 'Existing shifts cannot be removed from MakLom; refresh and retain all shifts' using errcode='22023';
  end if;
  if v_active_count=0 then
    raise exception 'An event must retain a scheduled shift' using errcode='22023';
  end if;
  select min(starts_at) into v_earliest from public.phaseone_event_timeslots
    where event_id=p_event_id and status='scheduled';
  if jsonb_array_length(v_changes)>0 then
    update public.phaseone_events
      set reporting_at=v_earliest,updated_at=now(),updated_by=p_actor
      where id=p_event_id;
    perform audit.write_event(
      'maklom.event_schedule_corrected','event',p_event_id::text,
      jsonb_build_object('event_id',p_event_id,'reason_note',v_note,'changes',v_changes,
        'old_reporting_at',v_event.reporting_at,'new_reporting_at',v_earliest),
      p_actor,null
    );
  end if;
  return jsonb_build_object('event_id',p_event_id,'changed_count',jsonb_array_length(v_changes),
    'new_shift_ids',to_jsonb(v_new_ids),'reporting_at',v_earliest);
end; $$;

create or replace function public.maklom_event_save_schedule(
  p_event_id uuid,p_expected_updated_at timestamptz,p_shifts jsonb,p_reason_note text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  return maklom_domain.save_event_schedule_impl(
    p_event_id,p_expected_updated_at,p_shifts,p_reason_note,auth.uid()
  );
end; $$;

revoke all on function public.maklom_event_save_schedule(uuid,timestamptz,jsonb,text) from public,anon;
grant execute on function public.maklom_event_save_schedule(uuid,timestamptz,jsonb,text) to authenticated;
revoke all on function maklom_domain.save_event_schedule_impl(uuid,timestamptz,jsonb,text,uuid) from public,anon;
grant execute on function maklom_domain.save_event_schedule_impl(uuid,timestamptz,jsonb,text,uuid) to authenticated;

-- Direct legacy attendance can lack a continuous session. Reuse the existing
-- audited Keluarga correction primitive rather than creating synthetic sessions.
create or replace function maklom_domain.correct_direct_roster_attendance_impl(
  p_roster_id uuid,p_expected_updated_at timestamptz,
  p_signed_in_at timestamptz,p_signed_out_at timestamptz,
  p_reason_note text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_att public.phaseone_attendance%rowtype;
  v_roster public.phaseone_roster%rowtype;
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  perform maklom_domain.require_editor(p_actor);
  if p_expected_updated_at is null or p_signed_in_at is null
     or (p_signed_out_at is not null and p_signed_out_at<p_signed_in_at) then
    raise exception 'Valid sign-in, sign-out and current record version are required' using errcode='22023';
  end if;
  if char_length(v_note)<5 or char_length(v_note)>500 then
    raise exception 'A correction reason between 5 and 500 characters is required' using errcode='22023';
  end if;
  select * into v_roster from public.phaseone_roster where id=p_roster_id;
  if not found then raise exception 'Roster row not found' using errcode='P0002'; end if;
  if exists(select 1 from public.phaseone_attendance_session_shifts where roster_id=p_roster_id) then
    raise exception 'This record has a linked session; correct the session instead' using errcode='22023';
  end if;
  select * into v_att from public.phaseone_attendance where roster_id=p_roster_id for update;
  if not found then raise exception 'Attendance row not found' using errcode='P0002'; end if;
  if v_att.updated_at is distinct from p_expected_updated_at then
    raise exception 'Attendance changed. Refresh before correcting it' using errcode='40001';
  end if;
  if v_att.non_attendance_status is not null then
    perform public.phaseone_apply_attendance_change(
      v_roster.event_id,p_roster_id,'clear_non_attendance',null,v_note,p_actor
    );
  end if;
  if v_att.signed_out_at is not null
     and (v_att.signed_in_at is distinct from p_signed_in_at
       or v_att.signed_out_at is distinct from p_signed_out_at) then
    perform public.phaseone_apply_attendance_change(
      v_roster.event_id,p_roster_id,'clear_sign_out',null,v_note,p_actor
    );
  end if;
  if v_att.signed_in_at is distinct from p_signed_in_at then
    perform public.phaseone_apply_attendance_change(
      v_roster.event_id,p_roster_id,'mark_sign_in',p_signed_in_at,v_note,p_actor
    );
  end if;
  if p_signed_out_at is not null and v_att.signed_out_at is distinct from p_signed_out_at then
    perform public.phaseone_apply_attendance_change(
      v_roster.event_id,p_roster_id,'mark_sign_out',p_signed_out_at,v_note,p_actor
    );
  end if;
  return (select jsonb_build_object('roster_id',roster_id,'signed_in_at',signed_in_at,
      'signed_out_at',signed_out_at,'updated_at',updated_at)
    from public.phaseone_attendance where roster_id=p_roster_id);
end; $$;

create or replace function public.maklom_event_correct_direct_roster_attendance(
  p_roster_id uuid,p_expected_updated_at timestamptz,
  p_signed_in_at timestamptz,p_signed_out_at timestamptz,p_reason_note text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
begin
  return maklom_domain.correct_direct_roster_attendance_impl(
    p_roster_id,p_expected_updated_at,p_signed_in_at,p_signed_out_at,p_reason_note,auth.uid()
  );
end; $$;

revoke all on function public.maklom_event_correct_direct_roster_attendance(uuid,timestamptz,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.maklom_event_correct_direct_roster_attendance(uuid,timestamptz,timestamptz,timestamptz,text) to authenticated;
revoke all on function maklom_domain.correct_direct_roster_attendance_impl(uuid,timestamptz,timestamptz,timestamptz,text,uuid) from public,anon;
grant execute on function maklom_domain.correct_direct_roster_attendance_impl(uuid,timestamptz,timestamptz,timestamptz,text,uuid) to authenticated;
