grant select on public.phaseone_roster to authenticated;
grant execute on function public.phaseone_canonical_mobile(text) to authenticated;

drop policy if exists "MakLom editors can resolve KELUARGA roster volunteers"
  on public.phaseone_roster;
create policy "MakLom editors can resolve KELUARGA roster volunteers"
on public.phaseone_roster
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
  volunteer_id, volunteer_key, volunteer_name, email, mobile,
  source_assignment_status, uploaded_by, uploaded_at
) on public.phaseone_roster to authenticated;

drop policy if exists "MakLom members can read KELUARGA volunteer reviews"
  on public.phaseone_volunteer_reviews;
create policy "MakLom members can read KELUARGA volunteer reviews"
on public.phaseone_volunteer_reviews
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
  )
);
grant select (id,event_id,roster_id) on public.phaseone_volunteer_reviews to authenticated;

drop policy if exists "MakLom members can read KELUARGA volunteer insights"
  on public.phaseone_volunteer_insights;
create policy "MakLom members can read KELUARGA volunteer insights"
on public.phaseone_volunteer_insights
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
  )
);
grant select (id,event_id,roster_id) on public.phaseone_volunteer_insights to authenticated;

create or replace function core.sync_roster_age_to_volunteer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
begin
  if new.volunteer_id is not null and new.age is not null then
    update core.volunteers
    set age = new.age,
        updated_at = now()
    where id = new.volunteer_id
      and age is distinct from new.age;
  end if;
  return new;
end;
$$;
revoke all on function core.sync_roster_age_to_volunteer()
from public, anon, authenticated;

create or replace function public.guard_event_resolution_duplicate_volunteer()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(new.email,''))), '');
  v_phone text := public.phaseone_canonical_mobile(new.phone);
begin
  if new.profile_origin <> 'event_resolution' then return new; end if;

  if v_email is not null and exists (
    select 1 from public.volunteers v
    where lower(btrim(coalesce(v.email,''))) = v_email
  ) then
    raise exception 'An existing volunteer has this email. Search and link the existing record instead.';
  end if;

  if v_phone is not null and exists (
    select 1 from public.volunteers v
    where public.phaseone_canonical_mobile(v.phone) = v_phone
  ) then
    raise exception 'An existing volunteer has this mobile number. Search and link the existing record instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists aa_guard_event_resolution_duplicate_volunteer on public.volunteers;
create trigger aa_guard_event_resolution_duplicate_volunteer
before insert on public.volunteers
for each row execute function public.guard_event_resolution_duplicate_volunteer();

revoke all on function public.guard_event_resolution_duplicate_volunteer()
from public, anon, authenticated;

create or replace function public.maklom_resolve_roster_volunteer(
  p_roster_id uuid,
  p_existing_core_volunteer_id uuid default null,
  p_create_name text default null,
  p_create_email text default null,
  p_create_phone text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_roster public.phaseone_roster%rowtype;
  v_core_id uuid;
  v_profile_id text;
  v_volunteer_code text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_updated_count integer := 0;
  v_inbox_count integer := 0;
  v_rows integer := 0;
  v_created boolean := false;
begin
  if v_uid is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.app_members m
    where m.user_id = v_uid and m.active and m.role in ('editor','admin')
  ) then raise exception 'MakLom editor or admin access is required'; end if;

  select * into v_roster
  from public.phaseone_roster
  where id = p_roster_id
  for update;

  if not found then raise exception 'Roster record was not found'; end if;
  if v_roster.volunteer_id is not null then
    raise exception 'This roster identity is already linked to a canonical volunteer';
  end if;

  if p_existing_core_volunteer_id is not null then
    select d.core_volunteer_id, d.id, d.volunteer_code, d.name, d.email, d.phone
    into v_core_id, v_profile_id, v_volunteer_code, v_display_name, v_email, v_phone
    from public.maklom_volunteer_search_directory d
    where d.core_volunteer_id = p_existing_core_volunteer_id
    limit 1;

    if v_core_id is null then
      raise exception 'Selected volunteer could not be found in the MakLom database';
    end if;
  else
    v_display_name := nullif(btrim(coalesce(p_create_name, v_roster.volunteer_name)), '');
    v_email := nullif(lower(btrim(coalesce(p_create_email, v_roster.email, ''))), '');
    v_phone := nullif(btrim(coalesce(p_create_phone, v_roster.mobile, '')), '');

    if v_display_name is null then raise exception 'Volunteer name is required'; end if;
    if v_email is null and v_phone is null then
      raise exception 'Email or mobile number is required to create a canonical volunteer';
    end if;

    v_profile_id := 'vol_resolve_' || replace(gen_random_uuid()::text, '-', '');

    insert into public.volunteers (
      id,name,email,phone,profile_origin,notes
    ) values (
      v_profile_id,v_display_name,v_email,v_phone,'event_resolution',
      'Created from MakLom unmatched event volunteer resolution'
    )
    returning core_volunteer_id into v_core_id;

    select d.volunteer_code, d.name, d.email, d.phone
    into v_volunteer_code, v_display_name, v_email, v_phone
    from public.maklom_volunteer_search_directory d
    where d.core_volunteer_id = v_core_id
    limit 1;

    v_created := true;
  end if;

  update public.phaseone_roster r
  set volunteer_id = v_core_id,
      volunteer_key = coalesce(v_volunteer_code, r.volunteer_key),
      volunteer_name = coalesce(nullif(btrim(v_display_name), ''), r.volunteer_name),
      email = coalesce(v_email, r.email),
      mobile = coalesce(v_phone, r.mobile),
      source_assignment_status = 'maklom_identity_resolved',
      uploaded_by = v_uid,
      uploaded_at = now()
  where r.event_id = v_roster.event_id
    and r.attendance_person_key = v_roster.attendance_person_key
    and r.volunteer_id is null;

  get diagnostics v_updated_count = row_count;

  update public.maklom_profile_inbox inbox
  set volunteer_id = v_core_id,
      status = case when inbox.status = 'needs_match' then 'pending' else inbox.status end,
      updated_at = now()
  from public.phaseone_volunteer_reviews review
  join public.phaseone_roster r on r.id = review.roster_id
  where inbox.source_kind = 'review'
    and inbox.source_record_id = review.id
    and r.event_id = v_roster.event_id
    and r.attendance_person_key = v_roster.attendance_person_key
    and inbox.volunteer_id is null;

  get diagnostics v_inbox_count = row_count;

  update public.maklom_profile_inbox inbox
  set volunteer_id = v_core_id,
      status = case when inbox.status = 'needs_match' then 'pending' else inbox.status end,
      updated_at = now()
  from public.phaseone_volunteer_insights insight
  join public.phaseone_roster r on r.id = insight.roster_id
  where inbox.source_kind = 'insight'
    and inbox.source_record_id = insight.id
    and r.event_id = v_roster.event_id
    and r.attendance_person_key = v_roster.attendance_person_key
    and inbox.volunteer_id is null;

  get diagnostics v_rows = row_count;
  v_inbox_count := v_inbox_count + v_rows;

  return jsonb_build_object(
    'core_volunteer_id', v_core_id,
    'profile_id', v_profile_id,
    'volunteer_code', v_volunteer_code,
    'display_name', v_display_name,
    'created', v_created,
    'roster_rows_linked', v_updated_count,
    'inbox_rows_linked', v_inbox_count
  );
end;
$$;

revoke all on function public.maklom_resolve_roster_volunteer(
  uuid,uuid,text,text,text
) from public, anon;
grant execute on function public.maklom_resolve_roster_volunteer(
  uuid,uuid,text,text,text
) to authenticated;
