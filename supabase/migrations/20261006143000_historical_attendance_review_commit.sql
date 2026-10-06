alter table public.historical_attendance_import_batches
  drop constraint if exists historical_attendance_import_batches_status_check;

alter table public.historical_attendance_import_batches
  alter column status set default 'reviewing';

alter table public.historical_attendance_import_batches
  add constraint historical_attendance_import_batches_status_check
  check (status in ('reviewing','committed','partial','failed'));

alter table public.historical_attendance_import_rows
  add column if not exists source_sign_in_at timestamptz,
  add column if not exists source_feedback_at timestamptz,
  add column if not exists matched_event_id text references public.events(id) on delete set null,
  add column if not exists matched_shift_id text references public.event_shifts(id) on delete set null,
  add column if not exists feedback_payload jsonb not null default '{}'::jsonb,
  add column if not exists shirt_quantity integer not null default 0,
  add column if not exists shirt_size text,
  add column if not exists decision text not null default 'pending',
  add column if not exists decision_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists duplicate_of_attendance_id text references public.attendance_log(id) on delete set null;

alter table public.historical_attendance_import_rows
  drop constraint if exists historical_attendance_import_rows_feedback_payload_check,
  add constraint historical_attendance_import_rows_feedback_payload_check
    check (jsonb_typeof(feedback_payload) = 'object'),
  drop constraint if exists historical_attendance_import_rows_shirt_quantity_check,
  add constraint historical_attendance_import_rows_shirt_quantity_check
    check (shirt_quantity >= 0),
  drop constraint if exists historical_attendance_import_rows_decision_check,
  add constraint historical_attendance_import_rows_decision_check
    check (decision in ('pending','approved','rejected'));

create index if not exists historical_attendance_rows_event_idx
  on public.historical_attendance_import_rows(matched_event_id)
  where matched_event_id is not null;

create index if not exists historical_attendance_rows_shift_idx
  on public.historical_attendance_import_rows(matched_shift_id)
  where matched_shift_id is not null;

create index if not exists historical_attendance_rows_decision_idx
  on public.historical_attendance_import_rows(batch_id, decision, source_row_number);

create unique index if not exists attendance_log_historical_source_hash_unique
  on public.attendance_log(historical_source_row_hash)
  where historical_source_row_hash is not null;

create or replace function public.maklom_commit_historical_attendance_batch(
  p_batch_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted integer := 0;
  v_duplicate_hits integer := 0;
  v_unready integer := 0;
  v_pending integer := 0;
  v_total integer := 0;
  v_attendance_id text;
  v_existing_attendance_id text;
  v_row record;
begin
  if v_actor is null or not exists (
    select 1
    from public.app_members m
    where m.user_id = v_actor
      and m.active
      and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor access is required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.historical_attendance_import_batches b
    where b.id = p_batch_id
  ) then
    raise exception 'Historical attendance batch not found'
      using errcode = 'P0002';
  end if;

  select count(*)::integer
  into v_unready
  from public.historical_attendance_import_rows r
  left join public.volunteers v on v.id = r.matched_volunteer_id
  left join public.events e on e.id = r.matched_event_id
  left join public.event_shifts s on s.id = r.matched_shift_id
  where r.batch_id = p_batch_id
    and r.decision = 'approved'
    and (
      r.match_status <> 'matched'
      or r.matched_volunteer_id is null
      or r.matched_core_volunteer_id is null
      or v.id is null
      or v.core_volunteer_id is distinct from r.matched_core_volunteer_id
      or r.matched_event_id is null
      or e.id is null
      or (r.matched_shift_id is not null and (s.id is null or s.event_id <> r.matched_event_id))
    );

  if v_unready > 0 then
    raise exception '% approved row(s) are not safe to commit', v_unready
      using errcode = 'P0001';
  end if;

  for v_row in
    select
      r.*,
      e.name as canonical_event_name,
      s.name as canonical_shift_name
    from public.historical_attendance_import_rows r
    join public.volunteers v
      on v.id = r.matched_volunteer_id
     and v.core_volunteer_id = r.matched_core_volunteer_id
    join public.events e on e.id = r.matched_event_id
    left join public.event_shifts s
      on s.id = r.matched_shift_id
     and s.event_id = r.matched_event_id
    where r.batch_id = p_batch_id
      and r.decision = 'approved'
      and r.match_status = 'matched'
      and r.committed_attendance_id is null
    order by r.source_row_number
    for update of r
  loop
    v_existing_attendance_id := null;

    select a.id
      into v_existing_attendance_id
    from public.attendance_log a
    where a.historical_source_row_hash = v_row.source_row_hash
    limit 1;

    if v_existing_attendance_id is not null then
      update public.historical_attendance_import_rows
      set
        match_status = 'duplicate',
        duplicate_of_attendance_id = v_existing_attendance_id,
        committed_attendance_id = v_existing_attendance_id,
        match_reason = coalesce(match_reason, 'Source row was already committed from an earlier historical import')
      where id = v_row.id;
      v_duplicate_hits := v_duplicate_hits + 1;
      continue;
    end if;

    v_attendance_id :=
      'hist_att_' || substr(md5(v_row.id || '|' || v_row.source_row_hash), 1, 24);

    insert into public.attendance_log (
      id, volunteer_id, name, email, contact, attended, event_name, event_date,
      duration_minutes, sign_in_at, sign_out_at, calculated_duration_minutes,
      staff_credited_duration_minutes, staff_credit_note, event_id, shift_id,
      shift_label, source_kind, historical_import_batch_id,
      historical_source_row_hash, volunteer_role
    )
    values (
      v_attendance_id, v_row.matched_volunteer_id, v_row.full_name, v_row.email,
      v_row.phone, v_row.attended, v_row.canonical_event_name, v_row.event_date,
      case when v_row.attended then v_row.reported_minutes else 0 end,
      v_row.source_sign_in_at, null, null, null,
      case when v_row.reported_minutes > 0 then 'Historical import: reviewed duration' else null end,
      v_row.matched_event_id, v_row.matched_shift_id, v_row.canonical_shift_name,
      'historical_import', p_batch_id, v_row.source_row_hash, v_row.volunteer_role
    )
    on conflict (historical_source_row_hash)
      where historical_source_row_hash is not null
    do nothing;

    if found then
      update public.historical_attendance_import_rows
      set committed_attendance_id = v_attendance_id, duplicate_of_attendance_id = null
      where id = v_row.id;
      v_inserted := v_inserted + 1;
    else
      select a.id into v_existing_attendance_id
      from public.attendance_log a
      where a.historical_source_row_hash = v_row.source_row_hash
      limit 1;

      update public.historical_attendance_import_rows
      set
        match_status = 'duplicate',
        duplicate_of_attendance_id = v_existing_attendance_id,
        committed_attendance_id = v_existing_attendance_id,
        match_reason = coalesce(match_reason, 'Source row was committed concurrently or in an earlier import')
      where id = v_row.id;
      v_duplicate_hits := v_duplicate_hits + 1;
    end if;
  end loop;

  select count(*)::integer, count(*) filter (where decision = 'pending')::integer
  into v_total, v_pending
  from public.historical_attendance_import_rows
  where batch_id = p_batch_id;

  update public.historical_attendance_import_batches b
  set
    row_count = v_total,
    matched_count = (select count(*)::integer from public.historical_attendance_import_rows r where r.batch_id = p_batch_id and r.matched_volunteer_id is not null),
    created_volunteer_count = 0,
    review_count = (select count(*)::integer from public.historical_attendance_import_rows r where r.batch_id = p_batch_id and (r.decision = 'pending' or r.match_status in ('needs_review','invalid'))),
    duplicate_count = (select count(*)::integer from public.historical_attendance_import_rows r where r.batch_id = p_batch_id and r.match_status = 'duplicate'),
    imported_count = (select count(*)::integer from public.historical_attendance_import_rows r where r.batch_id = p_batch_id and r.committed_attendance_id is not null and r.match_status <> 'duplicate'),
    total_minutes = (select coalesce(sum(case when r.committed_attendance_id is not null and r.match_status <> 'duplicate' and r.attended then r.reported_minutes else 0 end),0)::integer from public.historical_attendance_import_rows r where r.batch_id = p_batch_id),
    status = case when v_pending > 0 then 'partial' else 'committed' end,
    completed_at = case when v_pending > 0 then null else now() end
  where b.id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'inserted', v_inserted,
    'duplicates', v_duplicate_hits,
    'pending', v_pending,
    'status', case when v_pending > 0 then 'partial' else 'committed' end
  );
end;
$$;

revoke all on function public.maklom_commit_historical_attendance_batch(text)
  from public, anon, authenticated;
grant execute on function public.maklom_commit_historical_attendance_batch(text)
  to authenticated, service_role;
