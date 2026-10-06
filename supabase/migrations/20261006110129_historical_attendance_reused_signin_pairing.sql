alter table public.historical_attendance_import_rows
  add column if not exists source_check_out_at timestamptz,
  add column if not exists source_check_out_kind text,
  add column if not exists paired_source_row_id text
    references public.historical_attendance_import_rows(id) on delete set null,
  add column if not exists pair_role text;

alter table public.historical_attendance_import_rows
  drop constraint if exists historical_attendance_import_rows_source_check_out_kind_check,
  add constraint historical_attendance_import_rows_source_check_out_kind_check
    check (
      source_check_out_kind is null
      or source_check_out_kind in ('feedback_submission','reused_sign_in_form','manual')
    ),
  drop constraint if exists historical_attendance_import_rows_pair_role_check,
  add constraint historical_attendance_import_rows_pair_role_check
    check (pair_role is null or pair_role in ('check_in','check_out'));

create index if not exists historical_attendance_rows_paired_source_idx
  on public.historical_attendance_import_rows(paired_source_row_id)
  where paired_source_row_id is not null;

create or replace function maklom_domain.pair_staged_attendance_impl(
  p_check_in_row_id text,
  p_check_in_expected_version bigint,
  p_check_out_row_id text,
  p_check_out_expected_version bigint,
  p_keluarga_event_id uuid,
  p_reason_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_in public.historical_attendance_import_rows%rowtype;
  v_out public.historical_attendance_import_rows%rowtype;
  v_event public.phaseone_events%rowtype;
  v_core_volunteer_id uuid;
  v_profile_id text;
  v_duration_minutes integer;
  v_timeslot_ids uuid[];
  v_timeslot_count integer;
  v_origin_timeslot_id uuid;
  v_origin_roster_id uuid;
  v_roster public.phaseone_roster%rowtype;
  v_session public.phaseone_attendance_sessions%rowtype;
  v_transition jsonb;
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  perform maklom_domain.require_editor(p_actor);

  if p_check_in_row_id=p_check_out_row_id then
    raise exception 'Choose two different staged rows' using errcode='22023';
  end if;

  perform 1
  from public.historical_attendance_import_rows
  where id in (p_check_in_row_id,p_check_out_row_id)
  order by id
  for update;

  select * into v_in
  from public.historical_attendance_import_rows
  where id=p_check_in_row_id;

  select * into v_out
  from public.historical_attendance_import_rows
  where id=p_check_out_row_id;

  if v_in.id is null or v_out.id is null then
    raise exception 'One or both staged attendance rows could not be found'
      using errcode='P0002';
  end if;

  if v_in.row_version<>p_check_in_expected_version
     or v_out.row_version<>p_check_out_expected_version then
    raise exception 'One of these staged rows changed since it was opened. Refresh before pairing.'
      using errcode='40001';
  end if;

  if v_in.decision<>'pending' or v_out.decision<>'pending' then
    raise exception 'Both source rows must still be pending review'
      using errcode='P0001';
  end if;

  if v_in.matched_core_volunteer_id is null
     or v_out.matched_core_volunteer_id is null
     or v_in.matched_core_volunteer_id<>v_out.matched_core_volunteer_id then
    raise exception 'Both rows must resolve to the same existing volunteer'
      using errcode='P0001';
  end if;

  if v_in.event_date<>v_out.event_date then
    raise exception 'The paired rows must be for the same event date'
      using errcode='P0001';
  end if;

  if v_in.source_sign_in_at is null or v_out.source_sign_in_at is null then
    raise exception 'Both source rows need usable timestamps'
      using errcode='22023';
  end if;

  if v_out.source_sign_in_at<=v_in.source_sign_in_at then
    raise exception 'The checkout source must be later than the check-in source'
      using errcode='22023';
  end if;

  v_duration_minutes :=
    floor(extract(epoch from (v_out.source_sign_in_at-v_in.source_sign_in_at))/60)::integer;

  if v_duration_minutes<15 or v_duration_minutes>960 then
    raise exception 'The proposed attendance interval is not plausible for pairing'
      using errcode='P0001';
  end if;

  select * into v_event
  from public.phaseone_events
  where id=p_keluarga_event_id;

  if not found then
    raise exception 'Keluarga event not found' using errcode='P0002';
  end if;

  select array_agg(slot.id order by slot.starts_at),count(*)::integer
  into v_timeslot_ids,v_timeslot_count
  from public.phaseone_event_timeslots slot
  where slot.event_id=p_keluarga_event_id
    and slot.status<>'cancelled'
    and timezone('Asia/Singapore',slot.starts_at)::date=v_in.event_date
    and slot.starts_at<v_out.source_sign_in_at
    and (slot.ends_at is null or slot.ends_at>v_in.source_sign_in_at);

  if v_timeslot_count=0 then
    raise exception 'No Keluarga shift overlaps this proposed attendance interval'
      using errcode='P0001';
  end if;

  select slot.id
  into v_origin_timeslot_id
  from public.phaseone_event_timeslots slot
  where slot.id=any(v_timeslot_ids)
    and slot.starts_at<=v_in.source_sign_in_at
    and (slot.ends_at is null or v_in.source_sign_in_at<slot.ends_at)
  order by slot.starts_at
  limit 1;

  if v_origin_timeslot_id is null then
    v_origin_timeslot_id:=v_timeslot_ids[1];
  end if;

  v_core_volunteer_id:=v_in.matched_core_volunteer_id;

  perform public.phaseone_add_database_volunteers_to_roster(
    p_keluarga_event_id,
    v_timeslot_ids,
    array[v_core_volunteer_id],
    p_actor
  );

  select r.id into v_origin_roster_id
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
    raise exception 'Roster row has no attendance identity key'
      using errcode='P0001';
  end if;

  if exists(
    select 1
    from public.phaseone_attendance_sessions s
    where s.event_id=p_keluarga_event_id
      and s.attendance_date=v_in.event_date
      and s.person_key=v_roster.attendance_person_key
  ) then
    raise exception 'Attendance already exists for this volunteer on this event date. Review the existing session instead.'
      using errcode='P0001';
  end if;

  select public.phaseone_apply_attendance_transition(
    p_keluarga_event_id,
    v_origin_roster_id,
    'mark_sign_in',
    v_in.source_sign_in_at,
    coalesce(nullif(v_note,''),'Paired historical check-in from reused sign-in form'),
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

  perform public.phaseone_apply_attendance_transition(
    p_keluarga_event_id,
    v_origin_roster_id,
    'mark_sign_out',
    v_out.source_sign_in_at,
    coalesce(nullif(v_note,''),'Paired historical checkout from reused sign-in form'),
    p_actor
  );

  select * into v_session
  from public.phaseone_attendance_sessions
  where id=v_session.id;

  select id into v_profile_id
  from public.volunteers
  where core_volunteer_id=v_core_volunteer_id
  limit 1;

  update public.historical_attendance_import_rows
  set
    matched_volunteer_id=coalesce(v_profile_id,matched_volunteer_id),
    matched_keluarga_event_id=p_keluarga_event_id,
    matched_keluarga_timeslot_id=v_origin_timeslot_id,
    committed_keluarga_session_id=v_session.id,
    source_check_out_at=v_out.source_sign_in_at,
    source_check_out_kind='reused_sign_in_form',
    paired_source_row_id=v_out.id,
    pair_role='check_in',
    match_status='matched',
    match_reason='Paired with source row '||v_out.source_row_number||' as checkout; sign-in form was reused',
    decision='approved',
    decision_note=coalesce(nullif(v_note,''),'Confirmed paired check-in/check-out from reused sign-in form'),
    review_flags=array_append(
      array_remove(array_remove(review_flags,'event_unmatched'),'feedback_ambiguous'),
      'paired_reused_signin_form'
    ),
    reviewed_at=now(),
    reviewed_by=p_actor
  where id=v_in.id;

  update public.historical_attendance_import_rows
  set
    matched_volunteer_id=coalesce(v_profile_id,matched_volunteer_id),
    matched_keluarga_event_id=p_keluarga_event_id,
    matched_keluarga_timeslot_id=v_origin_timeslot_id,
    committed_keluarga_session_id=v_session.id,
    paired_source_row_id=v_in.id,
    pair_role='check_out',
    match_status='duplicate',
    match_reason='Consumed as checkout for source row '||v_in.source_row_number||'; sign-in form was reused',
    decision='approved',
    decision_note=coalesce(nullif(v_note,''),'Confirmed as checkout source for paired attendance'),
    review_flags=array_append(
      array_remove(array_remove(review_flags,'event_unmatched'),'feedback_ambiguous'),
      'paired_reused_signin_form'
    ),
    reviewed_at=now(),
    reviewed_by=p_actor
  where id=v_out.id;

  perform audit.write_event(
    'maklom.historical_attendance_paired_reused_signin',
    'historical_attendance',
    v_in.id,
    jsonb_build_object(
      'event_id',p_keluarga_event_id,
      'volunteer_id',v_core_volunteer_id,
      'check_in_row_id',v_in.id,
      'check_in_source_row_number',v_in.source_row_number,
      'check_in_at',v_in.source_sign_in_at,
      'check_out_row_id',v_out.id,
      'check_out_source_row_number',v_out.source_row_number,
      'check_out_at',v_out.source_sign_in_at,
      'duration_minutes',v_duration_minutes,
      'session_id',v_session.id,
      'timeslot_ids',to_jsonb(v_timeslot_ids),
      'reason_note',v_note
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'check_in_row_id',v_in.id,
    'check_out_row_id',v_out.id,
    'session_id',v_session.id,
    'event_id',p_keluarga_event_id,
    'checked_in_at',v_session.checked_in_at,
    'checked_out_at',v_session.checked_out_at,
    'duration_minutes',v_duration_minutes
  );
end;
$$;

create or replace function public.maklom_event_pair_staged_attendance(
  p_check_in_row_id text,
  p_check_in_expected_version bigint,
  p_check_out_row_id text,
  p_check_out_expected_version bigint,
  p_keluarga_event_id uuid,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  return maklom_domain.pair_staged_attendance_impl(
    p_check_in_row_id,
    p_check_in_expected_version,
    p_check_out_row_id,
    p_check_out_expected_version,
    p_keluarga_event_id,
    p_reason_note,
    auth.uid()
  );
end;
$$;

grant execute on function maklom_domain.pair_staged_attendance_impl(
  text,bigint,text,bigint,uuid,text,uuid
) to authenticated,service_role;

revoke all on function public.maklom_event_pair_staged_attendance(
  text,bigint,text,bigint,uuid,text
) from public,anon;

grant execute on function public.maklom_event_pair_staged_attendance(
  text,bigint,text,bigint,uuid,text
) to authenticated,service_role;
