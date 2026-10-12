-- Block stale mobile approvals; do not auto-approve or modify canonical data.
CREATE OR REPLACE FUNCTION public.review_volunteer_profile_change(p_change_id uuid, p_decision text, p_review_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  actor_id uuid := auth.uid();
  change_row public.volunteer_profile_change_inbox%rowtype;
  maklom_row public.volunteers%rowtype;
  clean_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.maklom_scoped_member('data.write') m
    where m.user_id = actor_id
      and m.active
      and m.role in ('editor', 'admin')
  ) then
    raise exception 'Profile change review access is required' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select *
  into change_row
  from public.volunteer_profile_change_inbox
  where id = p_change_id
  for update;

  if not found then
    raise exception 'Profile change request was not found' using errcode = 'P0002';
  end if;

  if change_row.status <> 'pending' then
    raise exception 'This profile change request has already been resolved' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    if change_row.field_name <> 'mobile' then
      raise exception 'Unsupported profile field: %', change_row.field_name using errcode = '22023';
    end if;

    -- Do not approve a stale request that differs from Keluarga's current mobile.
    if not exists (
      select 1 from core.volunteers c
      where c.id = change_row.volunteer_id
        and c.mobile is not distinct from change_row.new_value
    ) then
      raise exception 'The requested number no longer matches Keluarga. Review the current canonical mobile and this request before deciding.'
        using errcode = 'P0001';
    end if;

    select *
    into maklom_row
    from public.volunteers
    where core_volunteer_id = change_row.volunteer_id
    for update;

    if not found then
      raise exception 'MakLom volunteer profile was not found' using errcode = 'P0002';
    end if;

    if maklom_row.phone is distinct from change_row.old_value
       and maklom_row.phone is distinct from change_row.new_value then
      raise exception 'MakLom contact data changed after this request was submitted. Review the current volunteer record before approving.'
        using errcode = 'P0001';
    end if;

    update public.volunteers
    set phone = change_row.new_value
    where id = maklom_row.id
      and phone is distinct from change_row.new_value;
  end if;

  update public.volunteer_profile_change_inbox
  set
    status = p_decision,
    reviewed_by = actor_id,
    reviewed_at = now(),
    review_note = clean_note
  where id = change_row.id;

  return change_row.id;
end;
$function$;