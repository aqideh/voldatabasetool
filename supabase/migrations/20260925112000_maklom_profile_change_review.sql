create or replace view public.maklom_profile_change_review_queue
with (security_invoker = true)
as
select
  c.id,
  c.volunteer_id,
  d.id as maklom_volunteer_id,
  d.volunteer_code,
  d.name as volunteer_name,
  d.email as volunteer_email,
  d.phone as volunteer_phone,
  c.field_name,
  c.old_value,
  c.new_value,
  case
    when c.field_name = 'mobile' then d.phone
    else null
  end as current_maklom_value,
  c.source,
  c.status,
  c.source_changed_at,
  c.reviewed_by,
  c.reviewed_at,
  c.review_note
from public.volunteer_profile_change_inbox c
left join public.maklom_volunteer_search_directory d
  on d.core_volunteer_id = c.volunteer_id;

revoke all on public.maklom_profile_change_review_queue from anon;
grant select on public.maklom_profile_change_review_queue to authenticated, service_role;

create or replace function public.review_volunteer_profile_change(
  p_change_id uuid,
  p_decision text,
  p_review_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
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
    from public.app_members m
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
        using errcode = '40001';
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
$$;

revoke all on function public.review_volunteer_profile_change(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_volunteer_profile_change(uuid, text, text)
  to authenticated, service_role;
