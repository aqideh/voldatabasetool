begin;

create or replace function maklom_domain.review_legacy_staged_attendance_impl(
  p_row_id text,
  p_expected_version bigint,
  p_decision text,
  p_shift_id text,
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
  v_event public.events%rowtype;
  v_shift public.event_shifts%rowtype;
  v_profile public.volunteers%rowtype;
  v_existing_id text;
  v_attendance_id text;
  v_checkout_at timestamptz;
  v_duration integer := 0;
  v_pending integer := 0;
  v_total integer := 0;
  v_note text := btrim(coalesce(p_reason_note,''));
  v_decision text := lower(btrim(coalesce(p_decision,'')));
begin
  perform maklom_domain.require_editor(p_actor);

  if v_decision not in ('accept','reject') then
    raise exception 'Decision must be accept or reject' using errcode='22023';
  end if;
  if char_length(v_note)>500 then
    raise exception 'Review note must be 500 characters or fewer' using errcode='22023';
  end if;

  select * into v_row
  from public.historical_attendance_import_rows
  where id=p_row_id
  for update;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;
  if v_row.row_version<>p_expected_version then
    raise exception 'Staged attendance changed since it was opened. Refresh before reviewing it.'
      using errcode='40001';
  end if;

  if v_decision='reject' then
    update public.historical_attendance_import_rows
    set
      decision='rejected',
      decision_note=coalesce(nullif(v_note,''),'Rejected from event data review'),
      reviewed_at=now(),
      reviewed_by=p_actor
    where id=p_row_id;

    perform audit.write_event(
      'maklom.historical_attendance_rejected',
      'historical_attendance',
      p_row_id,
      jsonb_build_object(
        'legacy_event_id',v_row.matched_event_id,
        'source_row_number',v_row.source_row_number,
        'review_note',v_note
      ),
      p_actor,
      null
    );
  else
    if v_row.matched_event_id is null then
      raise exception 'Resolve the event before accepting this attendance row' using errcode='P0001';
    end if;

    select * into v_event
    from public.events
    where id=v_row.matched_event_id;

    if not found then
      raise exception 'Matched MakLom event not found' using errcode='P0002';
    end if;

    if v_row.matched_volunteer_id is null or v_row.matched_core_volunteer_id is null then
      raise exception 'Resolve the volunteer before accepting this attendance row' using errcode='P0001';
    end if;

    select * into v_profile
    from public.volunteers
    where id=v_row.matched_volunteer_id
      and core_volunteer_id=v_row.matched_core_volunteer_id;

    if not found then
      raise exception 'The staged volunteer match no longer points to the canonical volunteer' using errcode='P0001';
    end if;

    if nullif(btrim(coalesce(p_shift_id,'')),'') is not null then
      select * into v_shift
      from public.event_shifts
      where id=p_shift_id
        and event_id=v_event.id
        and shift_date=v_row.event_date;
      if not found then
        raise exception 'The selected shift does not belong to this event and attendance date' using errcode='P0001';
      end if;
    elsif v_row.matched_shift_id is not null then
      select * into v_shift
      from public.event_shifts
      where id=v_row.matched_shift_id
        and event_id=v_event.id
        and shift_date=v_row.event_date;
      if not found then
        raise exception 'The previously matched shift is no longer valid' using errcode='P0001';
      end if;
    else
      select * into v_shift
      from public.event_shifts
      where event_id=v_event.id
        and shift_date=v_row.event_date
      order by start_time nulls last,id
      limit 1;

      if not found then
        raise exception 'This event has no shift for the attendance date' using errcode='P0001';
      end if;

      if (
        select count(*)
        from public.event_shifts
        where event_id=v_event.id
          and shift_date=v_row.event_date
      )>1 then
        raise exception 'Choose the correct event shift before accepting attendance' using errcode='P0001';
      end if;
    end if;

    if v_row.source_sign_in_at is null then
      raise exception 'This staged row has no usable sign-in timestamp' using errcode='P0001';
    end if;

    v_checkout_at:=coalesce(v_row.source_check_out_at,v_row.source_feedback_at);
    if v_checkout_at is not null and v_checkout_at<v_row.source_sign_in_at then
      raise exception 'Source check-out cannot be before source sign-in' using errcode='P0001';
    end if;

    if v_checkout_at is not null then
      v_duration:=greatest(
        floor(extract(epoch from (v_checkout_at-v_row.source_sign_in_at))/60)::integer,
        0
      );
    else
      v_duration:=greatest(coalesce(v_row.reported_minutes,0),0);
    end if;

    if v_duration>6059 then
      raise exception 'Calculated attendance duration exceeds the supported limit' using errcode='22023';
    end if;

    select a.id into v_existing_id
    from public.attendance_log a
    where a.historical_source_row_hash=v_row.source_row_hash
       or (
         a.volunteer_id=v_row.matched_volunteer_id
         and a.event_id=v_event.id
         and a.shift_id=v_shift.id
         and a.event_date=v_row.event_date
         and a.attended=v_row.attended
       )
    order by case when a.historical_source_row_hash=v_row.source_row_hash then 0 else 1 end,a.created_at
    limit 1;

    if v_existing_id is not null then
      update public.historical_attendance_import_rows
      set
        matched_shift_id=v_shift.id,
        match_status='duplicate',
        duplicate_of_attendance_id=v_existing_id,
        committed_attendance_id=v_existing_id,
        match_reason='Attendance already exists for this volunteer and event shift',
        review_flags=array_remove(review_flags,'shift_ambiguous'),
        source_check_out_at=coalesce(source_check_out_at,v_checkout_at),
        source_check_out_kind=case
          when source_check_out_at is not null then source_check_out_kind
          when source_feedback_at is not null then 'feedback_submission'
          else source_check_out_kind
        end,
        reported_minutes=v_duration,
        decision='approved',
        decision_note=coalesce(nullif(v_note,''),'Confirmed against existing MakLom attendance'),
        reviewed_at=now(),
        reviewed_by=p_actor
      where id=p_row_id;
    else
      v_attendance_id:='hist_att_'||substr(md5(v_row.id||'|'||v_row.source_row_hash),1,24);

      insert into public.attendance_log(
        id,volunteer_id,name,email,contact,attended,event_name,event_date,
        duration_minutes,sign_in_at,sign_out_at,calculated_duration_minutes,
        staff_credited_duration_minutes,staff_credit_note,event_id,shift_id,shift_label,
        source_kind,historical_import_batch_id,historical_source_row_hash,volunteer_role,
        created_by,updated_by
      ) values (
        v_attendance_id,v_row.matched_volunteer_id,v_row.full_name,v_row.email,v_row.phone,
        v_row.attended,v_event.name,v_row.event_date,
        case when v_row.attended then v_duration else 0 end,
        v_row.source_sign_in_at,v_checkout_at,
        case when v_checkout_at is not null then v_duration else null end,
        null,
        case
          when v_checkout_at is not null then 'Historical import: source interval confirmed in event review'
          when v_duration>0 then 'Historical import: reviewed duration'
          else null
        end,
        v_event.id,v_shift.id,v_shift.name,'historical_import',v_row.batch_id,
        v_row.source_row_hash,v_row.volunteer_role,p_actor,p_actor
      );

      update public.historical_attendance_import_rows
      set
        matched_shift_id=v_shift.id,
        match_status='matched',
        match_reason=case
          when v_checkout_at is not null then 'Confirmed event shift with source sign-in and check-out'
          else 'Confirmed event shift with source sign-in'
        end,
        review_flags=array_remove(review_flags,'shift_ambiguous'),
        source_check_out_at=coalesce(source_check_out_at,v_checkout_at),
        source_check_out_kind=case
          when source_check_out_at is not null then source_check_out_kind
          when source_feedback_at is not null then 'feedback_submission'
          else source_check_out_kind
        end,
        reported_minutes=v_duration,
        committed_attendance_id=v_attendance_id,
        duplicate_of_attendance_id=null,
        decision='approved',
        decision_note=coalesce(nullif(v_note,''),'Confirmed in MakLom event data review'),
        reviewed_at=now(),
        reviewed_by=p_actor
      where id=p_row_id;
    end if;

    perform audit.write_event(
      case when v_existing_id is not null
        then 'maklom.historical_attendance_linked_existing'
        else 'maklom.historical_attendance_accepted'
      end,
      'historical_attendance',
      p_row_id,
      jsonb_build_object(
        'legacy_event_id',v_event.id,
        'shift_id',v_shift.id,
        'volunteer_id',v_row.matched_core_volunteer_id,
        'attendance_id',coalesce(v_existing_id,v_attendance_id),
        'source_row_number',v_row.source_row_number,
        'source_sign_in_at',v_row.source_sign_in_at,
        'source_check_out_at',v_checkout_at,
        'credited_minutes',v_duration,
        'existing_attendance',v_existing_id is not null,
        'review_note',v_note
      ),
      p_actor,
      null
    );
  end if;

  select count(*)::integer,count(*) filter(where decision='pending')::integer
  into v_total,v_pending
  from public.historical_attendance_import_rows
  where batch_id=v_row.batch_id;

  update public.historical_attendance_import_batches b
  set
    row_count=v_total,
    matched_count=(
      select count(*)::integer from public.historical_attendance_import_rows r
      where r.batch_id=v_row.batch_id and r.matched_volunteer_id is not null
    ),
    review_count=(
      select count(*)::integer from public.historical_attendance_import_rows r
      where r.batch_id=v_row.batch_id and r.decision='pending'
    ),
    duplicate_count=(
      select count(*)::integer from public.historical_attendance_import_rows r
      where r.batch_id=v_row.batch_id and r.match_status='duplicate'
    ),
    imported_count=(
      select count(*)::integer from public.historical_attendance_import_rows r
      where r.batch_id=v_row.batch_id
        and r.committed_attendance_id is not null
        and r.match_status<>'duplicate'
    ),
    total_minutes=(
      select coalesce(sum(case
        when r.committed_attendance_id is not null
          and r.match_status<>'duplicate'
          and r.attended
        then r.reported_minutes else 0 end),0)::integer
      from public.historical_attendance_import_rows r
      where r.batch_id=v_row.batch_id
    ),
    status=case when v_pending>0 then 'partial' else 'committed' end,
    completed_at=case when v_pending>0 then null else now() end
  where b.id=v_row.batch_id;

  return jsonb_build_object(
    'row_id',p_row_id,
    'decision',case when v_decision='reject' then 'rejected' else 'approved' end,
    'attendance_id',coalesce(v_existing_id,v_attendance_id),
    'event_id',v_row.matched_event_id,
    'shift_id',case when v_decision='accept' then v_shift.id else null end,
    'pending_in_batch',v_pending
  );
end;
$$;

revoke all on function maklom_domain.review_legacy_staged_attendance_impl(
  text,bigint,text,text,text,uuid
) from public,anon;
grant execute on function maklom_domain.review_legacy_staged_attendance_impl(
  text,bigint,text,text,text,uuid
) to authenticated,service_role;

create or replace function public.maklom_event_review_legacy_staged_attendance(
  p_row_id text,
  p_expected_version bigint,
  p_decision text,
  p_shift_id text default null,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  return maklom_domain.review_legacy_staged_attendance_impl(
    p_row_id,p_expected_version,p_decision,p_shift_id,p_reason_note,auth.uid()
  );
end;
$$;

revoke all on function public.maklom_event_review_legacy_staged_attendance(
  text,bigint,text,text,text
) from public,anon;
grant execute on function public.maklom_event_review_legacy_staged_attendance(
  text,bigint,text,text,text
) to authenticated,service_role;

commit;
