begin;

create or replace function public.maklom_bulk_approve_contributions(
  p_event_id uuid,
  p_items jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_contribution_id uuid;
  v_expected_updated_at timestamptz;
  v_approved_minutes integer;
  v_updated public.volunteer_contributions%rowtype;
  v_count integer := 0;
begin
  if not exists (
    select 1
    from public.app_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor access is required';
  end if;

  if p_event_id is null then
    raise exception 'Event is required';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Contribution items must be an array';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one contribution to approve';
  end if;

  if jsonb_array_length(p_items) > 1000 then
    raise exception 'A maximum of 1000 contributions can be approved at once';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    begin
      v_contribution_id := nullif(v_item->>'id','')::uuid;
      v_expected_updated_at := nullif(v_item->>'expected_updated_at','')::timestamptz;
      v_approved_minutes := nullif(v_item->>'approved_minutes','')::integer;
    exception
      when others then
        raise exception 'One or more contribution rows contain invalid review values';
    end;

    if v_contribution_id is null
       or v_expected_updated_at is null
       or v_approved_minutes is null
       or v_approved_minutes < 0 then
      raise exception 'Each selected contribution requires an id, current version, and non-negative approved minutes';
    end if;

    update public.volunteer_contributions contribution
    set
      status = 'approved',
      approved_minutes = v_approved_minutes,
      approval_note = coalesce(nullif(btrim(p_note),''), contribution.approval_note)
    where contribution.id = v_contribution_id
      and contribution.event_id = p_event_id
      and contribution.updated_at = v_expected_updated_at
      and contribution.status in ('pending','needs_review','approved')
    returning contribution.* into v_updated;

    if not found then
      raise exception 'A selected contribution changed after this sheet was loaded. Refresh and review the event again.';
    end if;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'event_id', p_event_id,
    'approved_count', v_count
  );
end;
$$;

revoke all on function public.maklom_bulk_approve_contributions(uuid,jsonb,text)
from public,anon;

grant execute on function public.maklom_bulk_approve_contributions(uuid,jsonb,text)
to authenticated,service_role;

comment on function public.maklom_bulk_approve_contributions(uuid,jsonb,text) is
  'Atomically approves a staff-selected set of MakLom contribution rows for one event using optimistic updated_at checks.';

commit;
