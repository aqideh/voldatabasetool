-- Historical attendance effective-time resolver foundation.
-- Original evidence is preserved; corrected operational timestamps are stored separately.

alter table public.historical_attendance_import_rows
  add column if not exists source_sign_in_original_at timestamptz,
  add column if not exists source_check_out_original_at timestamptz,
  add column if not exists effective_sign_in_at timestamptz,
  add column if not exists effective_sign_out_at timestamptz,
  add column if not exists sign_in_evidence_type text,
  add column if not exists sign_out_evidence_type text;

update public.historical_attendance_import_rows
set
  source_sign_in_original_at = coalesce(source_sign_in_original_at, source_sign_in_at),
  source_check_out_original_at = coalesce(source_check_out_original_at, source_check_out_at),
  effective_sign_in_at = coalesce(effective_sign_in_at, source_sign_in_at),
  effective_sign_out_at = coalesce(effective_sign_out_at, source_check_out_at),
  sign_in_evidence_type = coalesce(sign_in_evidence_type, case when source_sign_in_at is not null then 'SOURCE_CAPTURED' end),
  sign_out_evidence_type = coalesce(sign_out_evidence_type, case when source_check_out_at is not null then 'SOURCE_CAPTURED' end);

alter table public.historical_attendance_import_rows
  drop constraint if exists historical_attendance_sign_in_evidence_type_check,
  add constraint historical_attendance_sign_in_evidence_type_check
    check (sign_in_evidence_type is null or sign_in_evidence_type in (
      'SOURCE_CAPTURED','STAFF_CONFIRMED','ADMIN_CORRECTED','SHIFT_START_ESTIMATE','IMPORTED_RECORD'
    )),
  drop constraint if exists historical_attendance_sign_out_evidence_type_check,
  add constraint historical_attendance_sign_out_evidence_type_check
    check (sign_out_evidence_type is null or sign_out_evidence_type in (
      'SOURCE_CAPTURED','STAFF_CONFIRMED','ADMIN_CORRECTED','SHIFT_END_ESTIMATE','IMPORTED_RECORD'
    ));

create table if not exists public.historical_attendance_adjustment_audit (
  id uuid primary key default gen_random_uuid(),
  attendance_row_id text not null references public.historical_attendance_import_rows(id) on delete cascade,
  batch_id text,
  previous_state jsonb not null,
  new_state jsonb not null,
  adjustment_reason_code text not null,
  adjustment_reason_note text,
  adjusted_by_user_id uuid not null references auth.users(id),
  adjusted_at timestamptz not null default now(),
  constraint historical_attendance_adjustment_reason_code_check
    check (char_length(btrim(adjustment_reason_code)) between 1 and 80),
  constraint historical_attendance_adjustment_reason_note_check
    check (adjustment_reason_note is null or char_length(adjustment_reason_note) <= 500)
);

create index if not exists historical_attendance_adjustment_audit_row_idx
  on public.historical_attendance_adjustment_audit(attendance_row_id, adjusted_at desc);
create index if not exists historical_attendance_adjustment_audit_batch_idx
  on public.historical_attendance_adjustment_audit(batch_id)
  where batch_id is not null;

alter table public.historical_attendance_adjustment_audit enable row level security;

grant select on public.historical_attendance_adjustment_audit to authenticated, service_role;

drop policy if exists historical_attendance_adjustment_audit_staff_select
  on public.historical_attendance_adjustment_audit;
create policy historical_attendance_adjustment_audit_staff_select
on public.historical_attendance_adjustment_audit
for select
to authenticated
using (
  exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
  )
);

create or replace function maklom_domain.resolve_historical_attendance_times_impl(
  p_row_id text,
  p_expected_version bigint,
  p_effective_sign_in timestamptz,
  p_effective_sign_out timestamptz,
  p_sign_in_evidence_type text,
  p_sign_out_evidence_type text,
  p_reason_code text,
  p_reason_note text,
  p_batch_id text,
  p_actor uuid
)
returns public.historical_attendance_import_rows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_updated public.historical_attendance_import_rows%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_reason_code text := btrim(coalesce(p_reason_code,''));
  v_reason_note text := nullif(btrim(coalesce(p_reason_note,'')),'');
begin
  perform maklom_domain.require_editor(p_actor);

  if char_length(v_reason_code) < 1 or char_length(v_reason_code) > 80 then
    raise exception 'An adjustment reason is required' using errcode='22023';
  end if;
  if v_reason_note is not null and char_length(v_reason_note) > 500 then
    raise exception 'Adjustment note must be 500 characters or fewer' using errcode='22023';
  end if;
  if p_effective_sign_in is null then
    raise exception 'Effective sign-in time is required' using errcode='22023';
  end if;
  if p_effective_sign_out is not null and p_effective_sign_out < p_effective_sign_in then
    raise exception 'Effective sign-out cannot be before effective sign-in' using errcode='22023';
  end if;
  if p_sign_in_evidence_type is not null and p_sign_in_evidence_type not in (
    'SOURCE_CAPTURED','STAFF_CONFIRMED','ADMIN_CORRECTED','SHIFT_START_ESTIMATE','IMPORTED_RECORD'
  ) then
    raise exception 'Invalid sign-in evidence type' using errcode='22023';
  end if;
  if p_sign_out_evidence_type is not null and p_sign_out_evidence_type not in (
    'SOURCE_CAPTURED','STAFF_CONFIRMED','ADMIN_CORRECTED','SHIFT_END_ESTIMATE','IMPORTED_RECORD'
  ) then
    raise exception 'Invalid sign-out evidence type' using errcode='22023';
  end if;

  select * into v_row
  from public.historical_attendance_import_rows
  where id = p_row_id
  for update;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;
  if v_row.row_version <> p_expected_version then
    raise exception 'Staged attendance changed since it was opened. Refresh before reviewing it.'
      using errcode='40001';
  end if;

  v_previous := jsonb_build_object(
    'source_sign_in_original_at', coalesce(v_row.source_sign_in_original_at, v_row.source_sign_in_at),
    'source_check_out_original_at', coalesce(v_row.source_check_out_original_at, v_row.source_check_out_at),
    'effective_sign_in_at', coalesce(v_row.effective_sign_in_at, v_row.source_sign_in_at),
    'effective_sign_out_at', coalesce(v_row.effective_sign_out_at, v_row.source_check_out_at),
    'sign_in_evidence_type', v_row.sign_in_evidence_type,
    'sign_out_evidence_type', v_row.sign_out_evidence_type
  );

  update public.historical_attendance_import_rows
  set
    source_sign_in_original_at = coalesce(source_sign_in_original_at, source_sign_in_at),
    source_check_out_original_at = coalesce(source_check_out_original_at, source_check_out_at),
    effective_sign_in_at = p_effective_sign_in,
    effective_sign_out_at = p_effective_sign_out,
    sign_in_evidence_type = coalesce(p_sign_in_evidence_type, sign_in_evidence_type, 'SOURCE_CAPTURED'),
    sign_out_evidence_type = case
      when p_effective_sign_out is null then null
      else coalesce(p_sign_out_evidence_type, sign_out_evidence_type, 'ADMIN_CORRECTED')
    end,
    decision = 'pending',
    decision_note = coalesce(v_reason_note, decision_note)
  where id = p_row_id
  returning * into v_updated;

  v_new := jsonb_build_object(
    'source_sign_in_original_at', v_updated.source_sign_in_original_at,
    'source_check_out_original_at', v_updated.source_check_out_original_at,
    'effective_sign_in_at', v_updated.effective_sign_in_at,
    'effective_sign_out_at', v_updated.effective_sign_out_at,
    'sign_in_evidence_type', v_updated.sign_in_evidence_type,
    'sign_out_evidence_type', v_updated.sign_out_evidence_type
  );

  insert into public.historical_attendance_adjustment_audit(
    attendance_row_id,batch_id,previous_state,new_state,adjustment_reason_code,
    adjustment_reason_note,adjusted_by_user_id
  ) values (
    p_row_id,p_batch_id,v_previous,v_new,v_reason_code,v_reason_note,p_actor
  );

  perform audit.write_event(
    'maklom.historical_attendance_effective_time_adjusted',
    'historical_attendance',
    p_row_id,
    jsonb_build_object(
      'batch_id',p_batch_id,
      'reason_code',v_reason_code,
      'reason_note',v_reason_note,
      'previous_state',v_previous,
      'new_state',v_new
    ),
    p_actor,
    null
  );

  return v_updated;
end;
$$;

revoke all on function maklom_domain.resolve_historical_attendance_times_impl(
  text,bigint,timestamptz,timestamptz,text,text,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function maklom_domain.resolve_historical_attendance_times_impl(
  text,bigint,timestamptz,timestamptz,text,text,text,text,text,uuid
) to service_role;

create or replace function public.maklom_resolve_historical_attendance_times(
  p_row_id text,
  p_expected_version bigint,
  p_effective_sign_in timestamptz,
  p_effective_sign_out timestamptz,
  p_sign_in_evidence_type text,
  p_sign_out_evidence_type text,
  p_reason_code text,
  p_reason_note text default null,
  p_batch_id text default null
)
returns public.historical_attendance_import_rows
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.resolve_historical_attendance_times_impl(
    p_row_id,p_expected_version,p_effective_sign_in,p_effective_sign_out,
    p_sign_in_evidence_type,p_sign_out_evidence_type,p_reason_code,p_reason_note,
    p_batch_id,auth.uid()
  );
end;
$$;

revoke all on function public.maklom_resolve_historical_attendance_times(
  text,bigint,timestamptz,timestamptz,text,text,text,text,text
) from public,anon;
grant execute on function public.maklom_resolve_historical_attendance_times(
  text,bigint,timestamptz,timestamptz,text,text,text,text,text
) to authenticated,service_role;
