begin;

create table if not exists public.maklom_profile_reconciliation_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null check (char_length(source_filename) between 1 and 255),
  source_row_count integer not null check (source_row_count >= 0),
  matched_row_count integer not null default 0 check (matched_row_count >= 0),
  unmatched_row_count integer not null default 0 check (unmatched_row_count >= 0),
  conflict_row_count integer not null default 0 check (conflict_row_count >= 0),
  pending_match_count integer not null default 0 check (pending_match_count >= 0),
  change_count integer not null default 0 check (change_count >= 0),
  status text not null default 'staged' check (status in ('staged','completed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maklom_profile_reconciliation_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.maklom_profile_reconciliation_batches(id) on delete cascade,
  source_row_number integer not null check (source_row_number >= 2),
  source_record_id text,
  source_volunteer_code text,
  source_name text,
  source_email text,
  source_mobile text,
  maklom_volunteer_id text not null references public.volunteers(id) on delete restrict,
  core_volunteer_id uuid not null references core.volunteers(id) on delete restrict,
  target_volunteer_code text not null,
  target_name_at_stage text not null,
  target_email_at_stage text,
  target_mobile_at_stage text,
  match_method text not null check (match_method in ('legacy_code_alias','email_mobile','email','mobile')),
  match_status text not null default 'needs_confirmation' check (match_status in ('needs_confirmation','confirmed','rejected')),
  match_reason text not null,
  source_warnings text[] not null default '{}',
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  match_review_note text,
  created_at timestamptz not null default now(),
  unique(batch_id, source_row_number)
);

create table if not exists public.maklom_profile_reconciliation_changes (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.maklom_profile_reconciliation_rows(id) on delete cascade,
  target_scope text not null check (target_scope in ('maklom_profile','private_details')),
  field_name text not null,
  source_label text not null,
  source_value text,
  old_value text,
  proposed_value text not null,
  transformation text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(row_id, target_scope, field_name),
  check (
    (target_scope = 'maklom_profile' and field_name in (
      'name','email','phone','gender','address','languages_spoken',
      'emergency_name','emergency_phone','shirt_size','dietary'
    ))
    or
    (target_scope = 'private_details' and field_name in (
      'date_of_birth','postal_code','highest_qualification','institution'
    ))
  )
);

create index if not exists maklom_profile_reconciliation_rows_batch_idx
  on public.maklom_profile_reconciliation_rows(batch_id, source_row_number);
create index if not exists maklom_profile_reconciliation_rows_core_idx
  on public.maklom_profile_reconciliation_rows(core_volunteer_id);
create index if not exists maklom_profile_reconciliation_changes_row_status_idx
  on public.maklom_profile_reconciliation_changes(row_id, status);
create index if not exists maklom_profile_reconciliation_batches_created_idx
  on public.maklom_profile_reconciliation_batches(created_at desc);

alter table public.maklom_profile_reconciliation_batches enable row level security;
alter table public.maklom_profile_reconciliation_rows enable row level security;
alter table public.maklom_profile_reconciliation_changes enable row level security;

create policy maklom_profile_reconciliation_batches_read_members
on public.maklom_profile_reconciliation_batches
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
  )
);

create policy maklom_profile_reconciliation_rows_read_members
on public.maklom_profile_reconciliation_rows
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
  )
);

create policy maklom_profile_reconciliation_changes_read_members
on public.maklom_profile_reconciliation_changes
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
  )
);

revoke all on table public.maklom_profile_reconciliation_batches from anon;
revoke all on table public.maklom_profile_reconciliation_rows from anon;
revoke all on table public.maklom_profile_reconciliation_changes from anon;
revoke insert, update, delete on table public.maklom_profile_reconciliation_batches from authenticated;
revoke insert, update, delete on table public.maklom_profile_reconciliation_rows from authenticated;
revoke insert, update, delete on table public.maklom_profile_reconciliation_changes from authenticated;
grant select on table public.maklom_profile_reconciliation_batches to authenticated;
grant select on table public.maklom_profile_reconciliation_rows to authenticated;
grant select on table public.maklom_profile_reconciliation_changes to authenticated;
grant all on table public.maklom_profile_reconciliation_batches to service_role;
grant all on table public.maklom_profile_reconciliation_rows to service_role;
grant all on table public.maklom_profile_reconciliation_changes to service_role;

create or replace function public.maklom_profile_reconciliation_match_keys()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = actor_id and m.active
  ) then
    raise exception 'MakLom access is required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'emails', coalesce((
      select jsonb_agg(distinct lower(btrim(p.email)))
      from public.volunteers p
      where nullif(btrim(coalesce(p.email,'')), '') is not null
    ), '[]'::jsonb),
    'mobiles', coalesce((
      select jsonb_agg(distinct regexp_replace(p.phone, '[^0-9]', '', 'g'))
      from public.volunteers p
      where nullif(regexp_replace(coalesce(p.phone,''), '[^0-9]', '', 'g'), '') is not null
    ), '[]'::jsonb),
    'legacy_codes', coalesce((
      select jsonb_agg(distinct upper(btrim(a.source_id)))
      from core.volunteer_aliases a
      join public.volunteers p on p.core_volunteer_id = a.volunteer_id
      where a.source_system = 'legacy_volunteer_code'
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

create or replace function public.stage_maklom_profile_reconciliation(
  p_source_filename text,
  p_source_row_count integer,
  p_prefiltered_unmatched_count integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_source jsonb;
  v_change jsonb;
  v_row_id uuid;
  v_payload_count integer;
  v_matched integer := 0;
  v_unmatched integer := greatest(coalesce(p_prefiltered_unmatched_count, 0), 0);
  v_conflicts integer := 0;
  v_pending integer := 0;
  v_change_count integer := 0;
  v_source_row_number integer;
  v_source_record_id text;
  v_source_code text;
  v_source_name text;
  v_source_email text;
  v_source_mobile text;
  v_email_key text;
  v_phone_key text;
  v_profile_id text;
  v_core_id uuid;
  v_target_code text;
  v_target_name text;
  v_target_email text;
  v_target_mobile text;
  v_match_method text;
  v_match_status text;
  v_match_reason text;
  v_combo_count integer := 0;
  v_email_count integer := 0;
  v_phone_count integer := 0;
  v_email_profile_id text;
  v_email_core_id uuid;
  v_phone_profile_id text;
  v_phone_core_id uuid;
  v_scope text;
  v_field text;
  v_source_label text;
  v_source_value text;
  v_proposed text;
  v_transform text;
  v_old text;
  v_equal boolean;
  v_warnings text[];
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = actor_id
      and m.active
      and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor access is required' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_source_filename,'')), '') is null then
    raise exception 'Source filename is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Source rows must be a JSON array' using errcode = '22023';
  end if;

  v_payload_count := jsonb_array_length(p_rows);
  if p_source_row_count is null or p_source_row_count < 0 then
    raise exception 'Source row count must be zero or greater' using errcode = '22023';
  end if;
  if p_prefiltered_unmatched_count is null or p_prefiltered_unmatched_count < 0 then
    raise exception 'Prefiltered unmatched count must be zero or greater' using errcode = '22023';
  end if;
  if v_payload_count > 2000 then
    raise exception 'A maximum of 2000 candidate rows may be staged at once' using errcode = '22023';
  end if;
  if p_source_row_count <> p_prefiltered_unmatched_count + v_payload_count then
    raise exception 'Source row accounting does not match the staged payload' using errcode = '22023';
  end if;

  insert into public.maklom_profile_reconciliation_batches(
    id, source_filename, source_row_count, created_by
  ) values (
    v_batch_id, btrim(p_source_filename), p_source_row_count, actor_id
  );

  for v_source in
    select value from jsonb_array_elements(p_rows)
  loop
    v_source_row_number := nullif(v_source->>'source_row_number','')::integer;
    if v_source_row_number is null or v_source_row_number < 2 then
      raise exception 'Every source row requires a valid spreadsheet row number' using errcode = '22023';
    end if;

    v_source_record_id := nullif(btrim(coalesce(v_source->>'source_record_id','')), '');
    v_source_code := upper(nullif(btrim(coalesce(v_source->>'source_volunteer_code','')), ''));
    v_source_name := nullif(btrim(coalesce(v_source->>'source_name','')), '');
    v_source_email := nullif(btrim(coalesce(v_source->>'source_email','')), '');
    v_source_mobile := nullif(btrim(coalesce(v_source->>'source_mobile','')), '');
    v_email_key := lower(v_source_email);
    v_phone_key := nullif(regexp_replace(coalesce(v_source_mobile,''), '[^0-9]', '', 'g'), '');

    if jsonb_typeof(v_source->'warnings') = 'array' then
      select coalesce(array_agg(value), '{}')
      into v_warnings
      from jsonb_array_elements_text(v_source->'warnings');
    else
      v_warnings := '{}';
    end if;

    v_profile_id := null;
    v_core_id := null;
    v_target_code := null;
    v_target_name := null;
    v_target_email := null;
    v_target_mobile := null;
    v_match_method := null;
    v_match_status := null;
    v_match_reason := null;
    v_combo_count := 0;
    v_email_count := 0;
    v_phone_count := 0;
    v_email_profile_id := null;
    v_email_core_id := null;
    v_phone_profile_id := null;
    v_phone_core_id := null;

    if v_source_code is not null then
      select p.id, p.core_volunteer_id, c.volunteer_code, p.name, p.email, p.phone
      into v_profile_id, v_core_id, v_target_code, v_target_name, v_target_email, v_target_mobile
      from core.volunteer_aliases a
      join public.volunteers p on p.core_volunteer_id = a.volunteer_id
      join core.volunteers c on c.id = p.core_volunteer_id
      where a.source_system = 'legacy_volunteer_code'
        and upper(btrim(a.source_id)) = v_source_code
      limit 1;

      if v_profile_id is not null then
        v_match_method := 'legacy_code_alias';
        v_match_status := 'confirmed';
        v_match_reason := 'Previously confirmed legacy volunteer-code alias';
      end if;
    end if;

    if v_profile_id is null and v_email_key is not null and v_phone_key is not null then
      select
        count(*)::integer,
        (array_agg(p.id order by p.id))[1],
        (array_agg(p.core_volunteer_id order by p.id))[1]
      into v_combo_count, v_profile_id, v_core_id
      from public.volunteers p
      where lower(btrim(coalesce(p.email,''))) = v_email_key
        and regexp_replace(coalesce(p.phone,''), '[^0-9]', '', 'g') = v_phone_key;

      if v_combo_count = 1 then
        v_match_method := 'email_mobile';
        v_match_status := 'needs_confirmation';
        v_match_reason := 'Exact email and mobile match to an existing MakLom volunteer';
      elsif v_combo_count > 1 then
        v_conflicts := v_conflicts + 1;
        continue;
      else
        v_profile_id := null;
        v_core_id := null;
      end if;
    end if;

    if v_profile_id is null and v_email_key is not null then
      select
        count(*)::integer,
        (array_agg(p.id order by p.id))[1],
        (array_agg(p.core_volunteer_id order by p.id))[1]
      into v_email_count, v_email_profile_id, v_email_core_id
      from public.volunteers p
      where lower(btrim(coalesce(p.email,''))) = v_email_key;
    end if;

    if v_profile_id is null and v_phone_key is not null then
      select
        count(*)::integer,
        (array_agg(p.id order by p.id))[1],
        (array_agg(p.core_volunteer_id order by p.id))[1]
      into v_phone_count, v_phone_profile_id, v_phone_core_id
      from public.volunteers p
      where regexp_replace(coalesce(p.phone,''), '[^0-9]', '', 'g') = v_phone_key;
    end if;

    if v_profile_id is null then
      if v_email_key is not null and v_phone_key is not null then
        if v_email_count = 1 and v_phone_count = 0 then
          v_profile_id := v_email_profile_id;
          v_core_id := v_email_core_id;
          v_match_method := 'email';
          v_match_status := 'needs_confirmation';
          v_match_reason := 'Exact email match; source mobile does not match another MakLom volunteer';
        elsif v_phone_count = 1 and v_email_count = 0 then
          v_profile_id := v_phone_profile_id;
          v_core_id := v_phone_core_id;
          v_match_method := 'mobile';
          v_match_status := 'needs_confirmation';
          v_match_reason := 'Exact mobile match; source email does not match another MakLom volunteer';
        elsif v_email_count = 0 and v_phone_count = 0 then
          v_unmatched := v_unmatched + 1;
          continue;
        else
          v_conflicts := v_conflicts + 1;
          continue;
        end if;
      elsif v_email_key is not null then
        if v_email_count = 1 then
          v_profile_id := v_email_profile_id;
          v_core_id := v_email_core_id;
          v_match_method := 'email';
          v_match_status := 'needs_confirmation';
          v_match_reason := 'Exact email match to an existing MakLom volunteer';
        elsif v_email_count = 0 then
          v_unmatched := v_unmatched + 1;
          continue;
        else
          v_conflicts := v_conflicts + 1;
          continue;
        end if;
      elsif v_phone_key is not null then
        if v_phone_count = 1 then
          v_profile_id := v_phone_profile_id;
          v_core_id := v_phone_core_id;
          v_match_method := 'mobile';
          v_match_status := 'needs_confirmation';
          v_match_reason := 'Exact mobile match to an existing MakLom volunteer';
        elsif v_phone_count = 0 then
          v_unmatched := v_unmatched + 1;
          continue;
        else
          v_conflicts := v_conflicts + 1;
          continue;
        end if;
      else
        v_unmatched := v_unmatched + 1;
        continue;
      end if;
    end if;

    select c.volunteer_code, p.name, p.email, p.phone
    into v_target_code, v_target_name, v_target_email, v_target_mobile
    from public.volunteers p
    join core.volunteers c on c.id = p.core_volunteer_id
    where p.id = v_profile_id
      and p.core_volunteer_id = v_core_id;

    if not found then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    v_matched := v_matched + 1;

    insert into public.maklom_profile_reconciliation_rows(
      batch_id, source_row_number, source_record_id, source_volunteer_code,
      source_name, source_email, source_mobile, maklom_volunteer_id,
      core_volunteer_id, target_volunteer_code, target_name_at_stage, target_email_at_stage,
      target_mobile_at_stage, match_method, match_status, match_reason,
      source_warnings
    ) values (
      v_batch_id, v_source_row_number, v_source_record_id, v_source_code,
      v_source_name, v_source_email, v_source_mobile, v_profile_id,
      v_core_id, v_target_code, v_target_name, v_target_email, v_target_mobile,
      v_match_method, v_match_status, v_match_reason, v_warnings
    ) returning id into v_row_id;

    if jsonb_typeof(v_source->'changes') <> 'array' then
      continue;
    end if;

    for v_change in
      select value from jsonb_array_elements(v_source->'changes')
    loop
      v_scope := nullif(btrim(coalesce(v_change->>'target_scope','')), '');
      v_field := nullif(btrim(coalesce(v_change->>'field_name','')), '');
      v_source_label := nullif(btrim(coalesce(v_change->>'source_label','')), '');
      v_source_value := nullif(btrim(coalesce(v_change->>'source_value','')), '');
      v_proposed := nullif(btrim(coalesce(v_change->>'proposed_value','')), '');
      v_transform := nullif(btrim(coalesce(v_change->>'transformation','')), '');

      if v_proposed is null then
        continue;
      end if;

      if not (
        (v_scope = 'maklom_profile' and v_field in (
          'name','email','phone','gender','address','languages_spoken',
          'emergency_name','emergency_phone','shirt_size','dietary'
        ))
        or
        (v_scope = 'private_details' and v_field in (
          'date_of_birth','postal_code','highest_qualification','institution'
        ))
      ) then
        raise exception 'Unsupported reconciliation target %.%', v_scope, v_field using errcode = '22023';
      end if;

      if v_source_label is null then
        raise exception 'Every proposed change requires a source label' using errcode = '22023';
      end if;

      if char_length(v_proposed) > 2000 then
        raise exception 'Proposed value is too long for %.%', v_scope, v_field using errcode = '22023';
      end if;

      if v_scope = 'private_details' and v_field = 'postal_code'
         and v_proposed !~ '^[0-9]{6}$' then
        raise exception 'Postal code must contain exactly six digits' using errcode = '22023';
      end if;

      if v_scope = 'private_details' and v_field = 'highest_qualification'
         and v_proposed not in ('primary','secondary','n_level','o_level','a_level','ite','diploma','professional_certificate','bachelors','postgraduate','other') then
        raise exception 'Unsupported qualification value' using errcode = '22023';
      end if;

      if v_scope = 'private_details' and v_field = 'institution'
         and char_length(v_proposed) > 200 then
        raise exception 'Institution value is too long' using errcode = '22023';
      end if;

      if v_scope = 'private_details' and v_field = 'date_of_birth' then
        if v_proposed !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'Date of birth must use YYYY-MM-DD' using errcode = '22023';
        end if;
        perform v_proposed::date;
      end if;

      v_old := null;
      if v_scope = 'maklom_profile' then
        select case v_field
          when 'name' then p.name
          when 'email' then p.email
          when 'phone' then p.phone
          when 'gender' then p.gender
          when 'address' then p.address
          when 'languages_spoken' then p.languages_spoken
          when 'emergency_name' then p.emergency_name
          when 'emergency_phone' then p.emergency_phone
          when 'shirt_size' then p.shirt_size
          when 'dietary' then p.dietary
        end
        into v_old
        from public.volunteers p
        where p.id = v_profile_id;
      else
        select case v_field
          when 'date_of_birth' then d.date_of_birth::text
          when 'postal_code' then d.postal_code
          when 'highest_qualification' then d.highest_qualification
          when 'institution' then d.institution
        end
        into v_old
        from public.volunteer_private_details d
        where d.volunteer_id = v_core_id;
      end if;

      if v_field in ('phone','emergency_phone','postal_code') then
        v_equal := nullif(regexp_replace(coalesce(v_old,''), '[^0-9]', '', 'g'), '')
                   is not distinct from
                   nullif(regexp_replace(coalesce(v_proposed,''), '[^0-9]', '', 'g'), '');
      else
        v_equal := nullif(lower(btrim(coalesce(v_old,''))), '')
                   is not distinct from
                   nullif(lower(btrim(coalesce(v_proposed,''))), '');
      end if;

      if v_equal then
        continue;
      end if;

      insert into public.maklom_profile_reconciliation_changes(
        row_id, target_scope, field_name, source_label, source_value,
        old_value, proposed_value, transformation
      ) values (
        v_row_id, v_scope, v_field, v_source_label, v_source_value,
        v_old, v_proposed, v_transform
      )
      on conflict (row_id, target_scope, field_name) do nothing;
    end loop;
  end loop;

  update public.maklom_profile_reconciliation_rows r
  set
    match_status = 'needs_confirmation',
    source_warnings = case
      when 'Multiple spreadsheet rows resolve to this MakLom volunteer.' = any(r.source_warnings)
        then r.source_warnings
      else array_append(r.source_warnings, 'Multiple spreadsheet rows resolve to this MakLom volunteer.')
    end
  where r.batch_id = v_batch_id
    and r.core_volunteer_id in (
      select rr.core_volunteer_id
      from public.maklom_profile_reconciliation_rows rr
      where rr.batch_id = v_batch_id
      group by rr.core_volunteer_id
      having count(*) > 1
    );

  select count(*)::integer
  into v_pending
  from public.maklom_profile_reconciliation_rows r
  where r.batch_id = v_batch_id
    and r.match_status = 'needs_confirmation';

  select count(*)::integer
  into v_change_count
  from public.maklom_profile_reconciliation_changes c
  join public.maklom_profile_reconciliation_rows r on r.id = c.row_id
  where r.batch_id = v_batch_id;

  update public.maklom_profile_reconciliation_batches
  set
    matched_row_count = v_matched,
    unmatched_row_count = v_unmatched,
    conflict_row_count = v_conflicts,
    pending_match_count = v_pending,
    change_count = v_change_count,
    updated_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_rows', p_source_row_count,
    'matched_rows', v_matched,
    'unmatched_rows', v_unmatched,
    'conflict_rows', v_conflicts,
    'pending_matches', v_pending,
    'changes', v_change_count
  );
end;
$function$;

create or replace function public.review_maklom_profile_reconciliation_match(
  p_row_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  v_row public.maklom_profile_reconciliation_rows%rowtype;
  v_alias_target uuid;
  v_pending_matches integer;
  v_pending_changes integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = actor_id
      and m.active
      and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor access is required' using errcode = '42501';
  end if;

  if p_decision not in ('confirmed','rejected') then
    raise exception 'Decision must be confirmed or rejected' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.maklom_profile_reconciliation_rows
  where id = p_row_id
  for update;

  if not found then
    raise exception 'Reconciliation row was not found' using errcode = 'P0002';
  end if;

  if v_row.match_status = 'rejected' then
    raise exception 'This spreadsheet row has already been rejected' using errcode = 'P0001';
  end if;

  if p_decision = 'rejected' then
    update public.maklom_profile_reconciliation_rows
    set
      match_status = 'rejected',
      confirmed_by = actor_id,
      confirmed_at = now(),
      match_review_note = nullif(btrim(coalesce(p_review_note,'')), '')
    where id = v_row.id;

    update public.maklom_profile_reconciliation_changes
    set
      status = 'rejected',
      reviewed_by = actor_id,
      reviewed_at = now(),
      review_note = coalesce(nullif(btrim(coalesce(p_review_note,'')), ''), 'Source row match rejected.'),
      updated_at = now()
    where row_id = v_row.id
      and status = 'pending';
  else
    if not exists (
      select 1
      from public.volunteers p
      where p.id = v_row.maklom_volunteer_id
        and p.core_volunteer_id = v_row.core_volunteer_id
    ) then
      raise exception 'The matched MakLom volunteer no longer exists' using errcode = '40001';
    end if;

    if nullif(btrim(coalesce(v_row.source_volunteer_code,'')), '') is not null then
      select a.volunteer_id
      into v_alias_target
      from core.volunteer_aliases a
      where a.source_system = 'legacy_volunteer_code'
        and a.source_id = upper(btrim(v_row.source_volunteer_code))
      limit 1;

      if v_alias_target is not null and v_alias_target <> v_row.core_volunteer_id then
        raise exception 'This legacy volunteer code is already linked to another volunteer' using errcode = '40001';
      end if;

      if v_alias_target is null then
        insert into core.volunteer_aliases(
          volunteer_id, source_system, source_id, created_by
        ) values (
          v_row.core_volunteer_id,
          'legacy_volunteer_code',
          upper(btrim(v_row.source_volunteer_code)),
          actor_id
        );
      end if;
    end if;

    update public.maklom_profile_reconciliation_rows
    set
      match_status = 'confirmed',
      confirmed_by = actor_id,
      confirmed_at = now(),
      match_review_note = nullif(btrim(coalesce(p_review_note,'')), '')
    where id = v_row.id;
  end if;

  select count(*)::integer
  into v_pending_matches
  from public.maklom_profile_reconciliation_rows r
  where r.batch_id = v_row.batch_id
    and r.match_status = 'needs_confirmation';

  select count(*)::integer
  into v_pending_changes
  from public.maklom_profile_reconciliation_changes c
  join public.maklom_profile_reconciliation_rows r on r.id = c.row_id
  where r.batch_id = v_row.batch_id
    and c.status = 'pending';

  update public.maklom_profile_reconciliation_batches
  set
    pending_match_count = v_pending_matches,
    status = case when v_pending_matches = 0 and v_pending_changes = 0 then 'completed' else 'staged' end,
    updated_at = now()
  where id = v_row.batch_id;

  return jsonb_build_object('row_id', v_row.id, 'decision', p_decision, 'batch_id', v_row.batch_id);
end;
$function$;

create or replace function public.review_maklom_profile_reconciliation_change(
  p_change_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  v_change public.maklom_profile_reconciliation_changes%rowtype;
  v_row public.maklom_profile_reconciliation_rows%rowtype;
  v_current text;
  v_pending_matches integer;
  v_pending_changes integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_members m
    where m.user_id = actor_id
      and m.active
      and m.role in ('editor','admin')
  ) then
    raise exception 'MakLom editor access is required' using errcode = '42501';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select *
  into v_change
  from public.maklom_profile_reconciliation_changes
  where id = p_change_id
  for update;

  if not found then
    raise exception 'Reconciliation change was not found' using errcode = 'P0002';
  end if;

  if v_change.status <> 'pending' then
    raise exception 'This proposed change has already been resolved' using errcode = 'P0001';
  end if;

  select *
  into v_row
  from public.maklom_profile_reconciliation_rows
  where id = v_change.row_id
  for update;

  if not found then
    raise exception 'Reconciliation source row was not found' using errcode = 'P0002';
  end if;

  if p_decision = 'approved' and v_row.match_status <> 'confirmed' then
    raise exception 'Confirm the spreadsheet row match before approving field changes' using errcode = 'P0001';
  end if;

  if p_decision = 'rejected' then
    update public.maklom_profile_reconciliation_changes
    set
      status = 'rejected',
      reviewed_by = actor_id,
      reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_review_note,'')), ''),
      updated_at = now()
    where id = v_change.id;
  else
    v_current := null;

    if v_change.target_scope = 'maklom_profile' then
      select case v_change.field_name
        when 'name' then p.name
        when 'email' then p.email
        when 'phone' then p.phone
        when 'gender' then p.gender
        when 'address' then p.address
        when 'languages_spoken' then p.languages_spoken
        when 'emergency_name' then p.emergency_name
        when 'emergency_phone' then p.emergency_phone
        when 'shirt_size' then p.shirt_size
        when 'dietary' then p.dietary
      end
      into v_current
      from public.volunteers p
      where p.id = v_row.maklom_volunteer_id
        and p.core_volunteer_id = v_row.core_volunteer_id
      for update;

      if not found then
        raise exception 'The matched MakLom volunteer no longer exists' using errcode = '40001';
      end if;
    else
      select case v_change.field_name
        when 'date_of_birth' then d.date_of_birth::text
        when 'postal_code' then d.postal_code
        when 'highest_qualification' then d.highest_qualification
        when 'institution' then d.institution
      end
      into v_current
      from public.volunteer_private_details d
      where d.volunteer_id = v_row.core_volunteer_id
      for update;
    end if;

    if v_current is distinct from v_change.old_value
       and v_current is distinct from v_change.proposed_value then
      update public.maklom_profile_reconciliation_changes
      set
        status = 'stale',
        reviewed_by = actor_id,
        reviewed_at = now(),
        review_note = coalesce(
          nullif(btrim(coalesce(p_review_note,'')), ''),
          'Current MakLom value changed after this proposal was staged.'
        ),
        updated_at = now()
      where id = v_change.id;

      select count(*)::integer
      into v_pending_matches
      from public.maklom_profile_reconciliation_rows r
      where r.batch_id = v_row.batch_id
        and r.match_status = 'needs_confirmation';

      select count(*)::integer
      into v_pending_changes
      from public.maklom_profile_reconciliation_changes c
      join public.maklom_profile_reconciliation_rows r on r.id = c.row_id
      where r.batch_id = v_row.batch_id
        and c.status = 'pending';

      update public.maklom_profile_reconciliation_batches
      set
        pending_match_count = v_pending_matches,
        status = case when v_pending_matches = 0 and v_pending_changes = 0 then 'completed' else 'staged' end,
        updated_at = now()
      where id = v_row.batch_id;

      return jsonb_build_object('change_id', v_change.id, 'status', 'stale', 'current_value', v_current);
    end if;

    if v_current is distinct from v_change.proposed_value then
      if v_change.target_scope = 'maklom_profile' then
        if v_change.field_name = 'name' then
          update public.volunteers set name = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'email' then
          update public.volunteers set email = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'phone' then
          update public.volunteers set phone = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'gender' then
          update public.volunteers set gender = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'address' then
          update public.volunteers set address = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'languages_spoken' then
          update public.volunteers set languages_spoken = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'emergency_name' then
          update public.volunteers set emergency_name = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'emergency_phone' then
          update public.volunteers set emergency_phone = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'shirt_size' then
          update public.volunteers set shirt_size = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        elsif v_change.field_name = 'dietary' then
          update public.volunteers set dietary = v_change.proposed_value where id = v_row.maklom_volunteer_id;
        else
          raise exception 'Unsupported MakLom profile field' using errcode = '22023';
        end if;
      else
        if v_change.field_name = 'date_of_birth' then
          insert into public.volunteer_private_details(volunteer_id, date_of_birth)
          values (v_row.core_volunteer_id, v_change.proposed_value::date)
          on conflict (volunteer_id) do update
          set date_of_birth = excluded.date_of_birth, updated_at = now();
        elsif v_change.field_name = 'postal_code' then
          insert into public.volunteer_private_details(volunteer_id, postal_code)
          values (v_row.core_volunteer_id, v_change.proposed_value)
          on conflict (volunteer_id) do update
          set postal_code = excluded.postal_code, updated_at = now();
        elsif v_change.field_name = 'highest_qualification' then
          insert into public.volunteer_private_details(volunteer_id, highest_qualification)
          values (v_row.core_volunteer_id, v_change.proposed_value)
          on conflict (volunteer_id) do update
          set highest_qualification = excluded.highest_qualification, updated_at = now();
        elsif v_change.field_name = 'institution' then
          insert into public.volunteer_private_details(volunteer_id, institution)
          values (v_row.core_volunteer_id, v_change.proposed_value)
          on conflict (volunteer_id) do update
          set institution = excluded.institution, updated_at = now();
        else
          raise exception 'Unsupported private-details field' using errcode = '22023';
        end if;
      end if;
    end if;

    update public.maklom_profile_reconciliation_changes
    set
      status = 'approved',
      reviewed_by = actor_id,
      reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_review_note,'')), ''),
      updated_at = now()
    where id = v_change.id;
  end if;

  select count(*)::integer
  into v_pending_matches
  from public.maklom_profile_reconciliation_rows r
  where r.batch_id = v_row.batch_id
    and r.match_status = 'needs_confirmation';

  select count(*)::integer
  into v_pending_changes
  from public.maklom_profile_reconciliation_changes c
  join public.maklom_profile_reconciliation_rows r on r.id = c.row_id
  where r.batch_id = v_row.batch_id
    and c.status = 'pending';

  update public.maklom_profile_reconciliation_batches
  set
    pending_match_count = v_pending_matches,
    status = case when v_pending_matches = 0 and v_pending_changes = 0 then 'completed' else 'staged' end,
    updated_at = now()
  where id = v_row.batch_id;

  return jsonb_build_object('change_id', v_change.id, 'status', p_decision, 'batch_id', v_row.batch_id);
end;
$function$;

revoke all on function public.maklom_profile_reconciliation_match_keys() from public, anon;
revoke all on function public.stage_maklom_profile_reconciliation(text,integer,integer,jsonb) from public, anon;
revoke all on function public.review_maklom_profile_reconciliation_match(uuid,text,text) from public, anon;
revoke all on function public.review_maklom_profile_reconciliation_change(uuid,text,text) from public, anon;
grant execute on function public.maklom_profile_reconciliation_match_keys() to authenticated, service_role;
grant execute on function public.stage_maklom_profile_reconciliation(text,integer,integer,jsonb) to authenticated, service_role;
grant execute on function public.review_maklom_profile_reconciliation_match(uuid,text,text) to authenticated, service_role;
grant execute on function public.review_maklom_profile_reconciliation_change(uuid,text,text) to authenticated, service_role;

comment on table public.maklom_profile_reconciliation_batches is
  'Audited spreadsheet reconciliation batches. Source files may propose changes only for volunteers already present in the MakLom roster.';
comment on table public.maklom_profile_reconciliation_rows is
  'Matched source rows for legacy profile reconciliation. Contact evidence may suggest a match, but field writes require explicit match confirmation.';
comment on table public.maklom_profile_reconciliation_changes is
  'Field-level proposed changes from legacy profile spreadsheets. No proposal is applied until explicitly approved by a MakLom editor or admin.';
comment on function public.stage_maklom_profile_reconciliation(text,integer,integer,jsonb) is
  'Stages deterministic profile proposals for existing MakLom volunteers only. Never creates canonical or MakLom volunteer rows.';
comment on function public.review_maklom_profile_reconciliation_match(uuid,text,text) is
  'Confirms or rejects a staged source-row match. Confirmation may attach the reviewed legacy V-code as an alias to the existing canonical volunteer.';
comment on function public.review_maklom_profile_reconciliation_change(uuid,text,text) is
  'Approves or rejects one staged field change with stale-value protection. Does not create volunteers.';

commit;
