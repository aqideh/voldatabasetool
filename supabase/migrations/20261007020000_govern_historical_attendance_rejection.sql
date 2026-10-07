begin;

create or replace function maklom_domain.reject_historical_attendance_impl(
  p_row_id text,
  p_expected_version bigint,
  p_reason_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  perform maklom_domain.require_editor(p_actor);

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

  if v_row.committed_attendance_id is not null or v_row.committed_keluarga_session_id is not null then
    raise exception 'Committed attendance cannot be rejected from staging. Correct the attendance record instead.'
      using errcode='P0001';
  end if;

  update public.historical_attendance_import_rows
  set
    decision='rejected',
    decision_note=coalesce(nullif(v_note,''),'Rejected in Historical Attendance review'),
    reviewed_at=now(),
    reviewed_by=p_actor
  where id=p_row_id;

  perform audit.write_event(
    'maklom.historical_attendance_rejected',
    'historical_attendance',
    p_row_id,
    jsonb_build_object(
      'source_row_number',v_row.source_row_number,
      'legacy_event_id',v_row.matched_event_id,
      'keluarga_event_id',v_row.matched_keluarga_event_id,
      'review_note',v_note
    ),
    p_actor,
    null
  );

  return jsonb_build_object('row_id',p_row_id,'decision','rejected');
end;
$$;

revoke all on function maklom_domain.reject_historical_attendance_impl(text,bigint,text,uuid) from public,anon;
grant execute on function maklom_domain.reject_historical_attendance_impl(text,bigint,text,uuid) to authenticated,service_role;

create or replace function public.maklom_historical_reject_row(
  p_row_id text,
  p_expected_version bigint,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  return maklom_domain.reject_historical_attendance_impl(
    p_row_id,p_expected_version,p_reason_note,auth.uid()
  );
end;
$$;

revoke all on function public.maklom_historical_reject_row(text,bigint,text) from public,anon;
grant execute on function public.maklom_historical_reject_row(text,bigint,text) to authenticated,service_role;

commit;