alter table public.volunteers
  add column if not exists core_volunteer_id uuid,
  add column if not exists legacy_maklom_id text,
  add column if not exists profile_origin text not null default 'legacy';

update public.volunteers
set
  legacy_maklom_id = coalesce(legacy_maklom_id, id),
  profile_origin = case
    when id like 'vol_event_report_%' then 'event_report'
    when id like 'vol_event_repair_%' then 'event_repair'
    else coalesce(nullif(profile_origin, ''), 'legacy')
  end;

update public.volunteers
set core_volunteer_id = gen_random_uuid()
where core_volunteer_id is null;

insert into core.volunteers (
  id,
  display_name,
  primary_email_normalized,
  mobile,
  account_access_eligible,
  created_at,
  updated_at,
  volunteer_code
)
select
  v.core_volunteer_id,
  btrim(v.name),
  nullif(lower(btrim(coalesce(v.email, ''))), ''),
  nullif(btrim(coalesce(v.phone, '')), ''),
  false,
  v.created_at,
  v.updated_at,
  'KEL' || lpad(
    row_number() over (order by v.created_at, v.id)::text,
    5,
    '0'
  )
from public.volunteers v
where not exists (
  select 1
  from core.volunteers c
  where c.id = v.core_volunteer_id
);

select setval(
  'core.volunteer_code_seq',
  greatest(
    coalesce((
      select max(substring(volunteer_code from 4)::bigint)
      from core.volunteers
    ), 0),
    1
  ),
  true
);

create unique index if not exists volunteers_core_volunteer_id_key
  on public.volunteers(core_volunteer_id);

create unique index if not exists volunteers_legacy_maklom_id_key
  on public.volunteers(legacy_maklom_id)
  where legacy_maklom_id is not null;

alter table public.volunteers
  alter column core_volunteer_id set not null;

alter table public.volunteers
  drop constraint if exists volunteers_core_volunteer_id_fkey;

alter table public.volunteers
  add constraint volunteers_core_volunteer_id_fkey
  foreign key (core_volunteer_id)
  references core.volunteers(id)
  on delete restrict;

drop policy if exists volunteers_select_maklom_members on core.volunteers;
create policy volunteers_select_maklom_members
on core.volunteers
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

create or replace function maklom_private.prevent_core_volunteer_link_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.core_volunteer_id is distinct from new.core_volunteer_id then
    raise exception 'Canonical volunteer identity is immutable'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function maklom_private.prevent_core_volunteer_link_change()
  from public, anon, authenticated;

drop trigger if exists volunteers_prevent_core_link_change on public.volunteers;
create trigger volunteers_prevent_core_link_change
before update of core_volunteer_id on public.volunteers
for each row execute function maklom_private.prevent_core_volunteer_link_change();

create or replace function maklom_private.sync_profile_to_core()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update core.volunteers
  set
    display_name = btrim(new.name),
    primary_email_normalized = nullif(lower(btrim(coalesce(new.email, ''))), ''),
    mobile = nullif(btrim(coalesce(new.phone, '')), '')
  where id = new.core_volunteer_id;

  if not found then
    raise exception 'Canonical volunteer identity is missing'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function maklom_private.sync_profile_to_core()
  from public, anon, authenticated;

drop trigger if exists volunteers_sync_profile_to_core on public.volunteers;
create trigger volunteers_sync_profile_to_core
after update of name, email, phone on public.volunteers
for each row execute function maklom_private.sync_profile_to_core();

create or replace view public.maklom_volunteer_directory
with (security_invoker = true)
as
select
  v.id,
  v.core_volunteer_id,
  c.volunteer_code,
  v.name,
  v.nric,
  v.phone,
  v.email,
  v.gender,
  v.address,
  v.recruited_year,
  v.chat_session,
  v.chat_session_date,
  v.interests,
  v.languages_spoken,
  v.programmes_registered,
  v.tags,
  v.emergency_name,
  v.emergency_phone,
  v.shirt_size,
  v.dietary,
  v.notes,
  v.updated_at,
  v.row_version
from public.volunteers v
join core.volunteers c
  on c.id = v.core_volunteer_id;

revoke all on public.maklom_volunteer_directory from anon;
grant select on public.maklom_volunteer_directory to authenticated;

create or replace function maklom_private.match_or_create_volunteer(
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_recruited_year smallint default null,
  p_interests text default null,
  p_tags text[] default '{}'::text[],
  p_notes text default null,
  p_origin text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_profile_id text;
  v_core_id uuid;
  v_code text;
  v_match_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = v_actor
      and m.active
      and m.role = any(array['editor'::text, 'admin'::text])
  ) then
    raise exception 'MakLom editor access required' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'Volunteer name is required' using errcode = '22023';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'Volunteer email or phone is required' using errcode = '22023';
  end if;

  if v_email is not null then
    select count(*), min(v.id)
    into v_match_count, v_profile_id
    from public.volunteers v
    where lower(btrim(v.email)) = v_email;

    if v_match_count > 1 then
      raise exception 'Multiple volunteers already use this email; resolve duplicates first'
        using errcode = 'P0001';
    end if;
  end if;

  if v_match_count = 0 and v_phone is not null then
    select count(*), min(v.id)
    into v_match_count, v_profile_id
    from public.volunteers v
    where regexp_replace(coalesce(v.phone, ''), '[^0-9]', '', 'g')
          = regexp_replace(v_phone, '[^0-9]', '', 'g')
      and lower(btrim(v.name)) = lower(v_name);

    if v_match_count > 1 then
      raise exception 'Multiple volunteers match this name and phone; resolve duplicates first'
        using errcode = 'P0001';
    end if;
  end if;

  if v_match_count = 1 and v_profile_id is not null then
    select v.core_volunteer_id, c.volunteer_code
    into v_core_id, v_code
    from public.volunteers v
    join core.volunteers c on c.id = v.core_volunteer_id
    where v.id = v_profile_id;

    return jsonb_build_object(
      'status', 'linked_existing',
      'profile_id', v_profile_id,
      'core_volunteer_id', v_core_id,
      'volunteer_code', v_code
    );
  end if;

  insert into core.volunteers (
    display_name,
    primary_email_normalized,
    mobile,
    account_access_eligible
  )
  values (
    v_name,
    v_email,
    v_phone,
    false
  )
  returning id, volunteer_code into v_core_id, v_code;

  v_profile_id := gen_random_uuid()::text;

  insert into public.volunteers (
    id,
    core_volunteer_id,
    name,
    phone,
    email,
    recruited_year,
    interests,
    tags,
    notes,
    profile_origin
  )
  values (
    v_profile_id,
    v_core_id,
    v_name,
    v_phone,
    v_email,
    p_recruited_year,
    nullif(btrim(coalesce(p_interests, '')), ''),
    coalesce(p_tags, '{}'::text[]),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(nullif(btrim(p_origin), ''), 'manual')
  );

  return jsonb_build_object(
    'status', 'created',
    'profile_id', v_profile_id,
    'core_volunteer_id', v_core_id,
    'volunteer_code', v_code
  );
end;
$$;

revoke all on function maklom_private.match_or_create_volunteer(
  text, text, text, smallint, text, text[], text, text
) from public, anon;

grant usage on schema maklom_private to authenticated;
grant execute on function maklom_private.match_or_create_volunteer(
  text, text, text, smallint, text, text[], text, text
) to authenticated;

create or replace function public.maklom_match_or_create_volunteer(
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_recruited_year smallint default null,
  p_interests text default null,
  p_tags text[] default '{}'::text[],
  p_notes text default null,
  p_origin text default 'manual'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_private.match_or_create_volunteer(
    p_name,
    p_email,
    p_phone,
    p_recruited_year,
    p_interests,
    p_tags,
    p_notes,
    p_origin
  );
end;
$$;

revoke all on function public.maklom_match_or_create_volunteer(
  text, text, text, smallint, text, text[], text, text
) from public, anon;
grant execute on function public.maklom_match_or_create_volunteer(
  text, text, text, smallint, text, text[], text, text
) to authenticated;

create or replace function public.maklom_convert_volunteer_lead(p_lead_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.volunteer_leads%rowtype;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = v_actor
      and m.active
      and m.role = any(array['editor'::text, 'admin'::text])
  ) then
    raise exception 'MakLom editor access required' using errcode = '42501';
  end if;

  select *
  into v_lead
  from public.volunteer_leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Volunteer lead not found' using errcode = 'P0002';
  end if;

  if v_lead.status = 'converted' and v_lead.converted_volunteer_id is not null then
    return jsonb_build_object(
      'status', 'already_converted',
      'lead_id', v_lead.id,
      'profile_id', v_lead.converted_volunteer_id,
      'volunteer_code', (
        select c.volunteer_code
        from public.volunteers v
        join core.volunteers c on c.id = v.core_volunteer_id
        where v.id = v_lead.converted_volunteer_id
      )
    );
  end if;

  if v_lead.status <> 'accepted' then
    raise exception 'Lead must be accepted before conversion' using errcode = 'P0001';
  end if;

  v_result := maklom_private.match_or_create_volunteer(
    v_lead.full_name,
    v_lead.email,
    v_lead.phone,
    extract(year from coalesce(v_lead.submitted_at, now()))::smallint,
    v_lead.interest_area,
    array['FormSG lead']::text[],
    concat_ws(
      E'\n\n',
      case when nullif(btrim(coalesce(v_lead.motivation, '')), '') is not null
        then 'Volunteer motivation: ' || btrim(v_lead.motivation) end,
      case when nullif(btrim(coalesce(v_lead.skills_experience, '')), '') is not null
        then 'Skills / experience: ' || btrim(v_lead.skills_experience) end,
      case when nullif(btrim(coalesce(v_lead.availability_notes, '')), '') is not null
        then 'Availability: ' || btrim(v_lead.availability_notes) end,
      case when nullif(btrim(coalesce(v_lead.referral_source, '')), '') is not null
        then 'Referral source: ' || btrim(v_lead.referral_source) end,
      case when nullif(btrim(coalesce(v_lead.staff_notes, '')), '') is not null
        then 'Lead notes: ' || btrim(v_lead.staff_notes) end
    ),
    'formsg_lead'
  );

  update public.volunteer_leads
  set
    status = 'converted',
    converted_volunteer_id = v_result ->> 'profile_id',
    converted_at = now()
  where id = v_lead.id;

  return v_result || jsonb_build_object('lead_id', v_lead.id);
end;
$$;

revoke all on function public.maklom_convert_volunteer_lead(text)
  from public, anon;
grant execute on function public.maklom_convert_volunteer_lead(text)
  to authenticated;

comment on column public.volunteers.core_volunteer_id is
  'Canonical internal volunteer UUID in core.volunteers.';
comment on column public.volunteers.legacy_maklom_id is
  'Pre-canonicalisation MakLom primary key retained only as hidden migration provenance.';
comment on column public.volunteers.profile_origin is
  'Source metadata for the MakLom operational profile. Source is never encoded into the volunteer ID.';
