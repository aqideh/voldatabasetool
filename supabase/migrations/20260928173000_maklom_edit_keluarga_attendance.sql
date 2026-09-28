grant select on public.phaseone_attendance_sessions to authenticated;

drop policy if exists "MakLom editors can update KELUARGA attendance sessions"
  on public.phaseone_attendance_sessions;
create policy "MakLom editors can update KELUARGA attendance sessions"
on public.phaseone_attendance_sessions
for update to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role in ('editor','admin')
  )
)
with check (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role in ('editor','admin')
  )
);

grant update (
  checked_in_at,
  checked_out_at,
  checked_in_by,
  checked_out_by,
  updated_at
) on public.phaseone_attendance_sessions to authenticated;

drop policy if exists "MakLom editors can add KELUARGA attendance audit"
  on public.phaseone_attendance_session_audit;
create policy "MakLom editors can add KELUARGA attendance audit"
on public.phaseone_attendance_session_audit
for insert to authenticated
with check (
  changed_by = (select auth.uid())
  and exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role in ('editor','admin')
  )
);

grant insert on public.phaseone_attendance_session_audit to authenticated;

create or replace function public.maklom_correct_keluarga_attendance(
  p_session_id uuid,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz,
  p_reason text,
  p_credit_action text default 'unchanged',
  p_approved_minutes integer default null,
  p_approval_note text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_credit_action text := lower(btrim(coalesce(p_credit_action, 'unchanged')));
  v_session public.phaseone_attendance_sessions%rowtype;
  v_updated public.phaseone_attendance_sessions%rowtype;
  v_contribution public.volunteer_contributions%rowtype;
begin
  if v_uid is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.app_members m
    where m.user_id = v_uid and m.active and m.role in ('editor','admin')
  ) then raise exception 'MakLom editor or admin access is required'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'A correction reason between 5 and 500 characters is required';
  end if;
  if p_checked_in_at is null then raise exception 'Check-in time is required'; end if;
  if p_checked_out_at is not null and p_checked_out_at < p_checked_in_at then
    raise exception 'Check-out cannot be before check-in';
  end if;
  if v_credit_action not in ('unchanged','approve','needs_review','reject') then
    raise exception 'Unsupported contribution review action';
  end if;
  if v_credit_action = 'approve' and (p_approved_minutes is null or p_approved_minutes < 0) then
    raise exception 'Approved minutes are required when approving contribution hours';
  end if;

  select * into v_session
  from public.phaseone_attendance_sessions
  where id = p_session_id
  for update;
  if not found then raise exception 'Keluarga attendance session was not found'; end if;

  if v_session.checked_out_at is not null and p_checked_out_at is null then
    raise exception 'A completed attendance session cannot be reopened from MakLom';
  end if;

  update public.phaseone_attendance_sessions
  set checked_in_at = p_checked_in_at,
      checked_out_at = p_checked_out_at,
      checked_in_by = case when checked_in_at is distinct from p_checked_in_at then v_uid else checked_in_by end,
      checked_out_by = case when checked_out_at is distinct from p_checked_out_at then v_uid else checked_out_by end,
      updated_at = now()
  where id = p_session_id
  returning * into v_updated;

  insert into public.phaseone_attendance_session_audit (
    session_id,event_id,roster_id,action,metadata,changed_by
  ) values (
    v_updated.id,v_updated.event_id,v_updated.origin_roster_id,'session_backfilled',
    jsonb_build_object(
      'source','maklom_admin_correction',
      'reason',v_reason,
      'old_checked_in_at',v_session.checked_in_at,
      'old_checked_out_at',v_session.checked_out_at,
      'new_checked_in_at',v_updated.checked_in_at,
      'new_checked_out_at',v_updated.checked_out_at,
      'credit_action',v_credit_action,
      'requested_approved_minutes',p_approved_minutes,
      'approval_note',nullif(btrim(coalesce(p_approval_note,'')),'')
    ),
    v_uid
  );

  select * into v_contribution
  from public.volunteer_contributions
  where attendance_session_id = p_session_id
  for update;

  if found then
    if v_credit_action = 'approve' then
      update public.volunteer_contributions
      set status='approved',
          approved_minutes=p_approved_minutes,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),'')
      where id=v_contribution.id;
    elsif v_credit_action = 'needs_review' then
      update public.volunteer_contributions
      set status='needs_review',approved_minutes=null,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),'')
      where id=v_contribution.id;
    elsif v_credit_action = 'reject' then
      update public.volunteer_contributions
      set status='rejected',approved_minutes=null,
          approval_note=nullif(btrim(coalesce(p_approval_note,'')),'')
      where id=v_contribution.id;
    end if;
  elsif v_credit_action <> 'unchanged' then
    raise exception 'This attendance session is not linked to a canonical volunteer contribution';
  end if;

  return jsonb_build_object(
    'session_id',v_updated.id,
    'event_id',v_updated.event_id,
    'checked_in_at',v_updated.checked_in_at,
    'checked_out_at',v_updated.checked_out_at,
    'credit_action',v_credit_action,
    'corrected_by',v_uid
  );
end;
$$;

revoke all on function public.maklom_correct_keluarga_attendance(
  uuid,timestamptz,timestamptz,text,text,integer,text
) from public, anon;
grant execute on function public.maklom_correct_keluarga_attendance(
  uuid,timestamptz,timestamptz,text,text,integer,text
) to authenticated;
