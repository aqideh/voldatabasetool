
create or replace function maklom_domain.staged_identity_candidates_impl(
  p_row_id text,
  p_query text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_query text := lower(btrim(coalesce(p_query,'')));
  v_phone text;
  v_result jsonb;
begin
  perform maklom_domain.require_editor(p_actor);

  select * into v_row
  from public.historical_attendance_import_rows
  where id=p_row_id;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;

  -- Historical email/mobile are source evidence only. They are deliberately
  -- excluded from automatic candidate matching.
  v_phone := public.phaseone_canonical_mobile(nullif(v_query,''));

  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.name),'[]'::jsonb)
  into v_result
  from (
    select
      d.core_volunteer_id,
      d.id as profile_id,
      d.volunteer_code,
      d.name,
      d.email,
      d.phone,
      greatest(
        case when lower(btrim(d.name))=lower(btrim(v_row.full_name)) then 100 else 0 end,
        case when v_query<>'' and lower(d.name) like '%'||v_query||'%' then 80 else 0 end,
        case when v_query<>'' and lower(coalesce(d.email,'')) like '%'||v_query||'%' then 70 else 0 end,
        case when v_phone is not null and public.phaseone_canonical_mobile(d.phone) like '%'||v_phone||'%' then 60 else 0 end
      ) as score
    from public.maklom_volunteer_search_directory d
    where lower(btrim(d.name))=lower(btrim(v_row.full_name))
      or (
        v_query<>''
        and (
          lower(d.name) like '%'||v_query||'%'
          or lower(coalesce(d.email,'')) like '%'||v_query||'%'
          or (
            v_phone is not null
            and public.phaseone_canonical_mobile(d.phone) like '%'||v_phone||'%'
          )
        )
      )
    order by score desc,d.name
    limit 20
  ) x;

  return v_result;
end;
$$;

create or replace function maklom_domain.resolve_staged_identity_impl(
  p_row_id text,
  p_expected_version bigint,
  p_existing_core_volunteer_id uuid,
  p_create_new boolean,
  p_name text,
  p_email text,
  p_phone text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.historical_attendance_import_rows%rowtype;
  v_core_id uuid;
  v_profile_id text;
  v_code text;
  v_name text;
  v_email text;
  v_phone text;
  v_created boolean := false;
begin
  perform maklom_domain.require_editor(p_actor);

  if (p_existing_core_volunteer_id is null and not coalesce(p_create_new,false))
     or (p_existing_core_volunteer_id is not null and coalesce(p_create_new,false)) then
    raise exception 'Choose either an existing volunteer or create a new volunteer'
      using errcode='22023';
  end if;

  select * into v_row
  from public.historical_attendance_import_rows
  where id=p_row_id
  for update;

  if not found then
    raise exception 'Staged attendance row not found' using errcode='P0002';
  end if;

  if v_row.row_version<>p_expected_version then
    raise exception 'Staged attendance changed since it was opened. Refresh before resolving the volunteer.'
      using errcode='40001';
  end if;

  if p_existing_core_volunteer_id is not null then
    select d.core_volunteer_id,d.id,d.volunteer_code,d.name,d.email,d.phone
    into v_core_id,v_profile_id,v_code,v_name,v_email,v_phone
    from public.maklom_volunteer_search_directory d
    where d.core_volunteer_id=p_existing_core_volunteer_id
    limit 1;

    if v_core_id is null then
      raise exception 'Selected volunteer could not be found in MakLom'
        using errcode='P0002';
    end if;
  else
    v_name := nullif(btrim(coalesce(p_name,v_row.full_name,'')),'');
    if v_name is null then
      raise exception 'Volunteer name is required' using errcode='22023';
    end if;

    -- Source email/mobile are retained on the staged attendance row, but are
    -- not copied into canonical identity or used for duplicate matching.
    v_email := null;
    v_phone := null;

    insert into core.volunteers(
      display_name,primary_email_normalized,mobile,account_access_eligible
    )
    values(v_name,null,null,false)
    returning id,volunteer_code into v_core_id,v_code;

    v_profile_id := 'vol_'||substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,20);

    insert into public.volunteers(
      id,
      core_volunteer_id,
      name,
      phone,
      email,
      profile_origin,
      notes
    )
    values(
      v_profile_id,
      v_core_id,
      v_name,
      null,
      null,
      'historical_attendance_resolution',
      'Created from staged historical attendance identity resolution. Source contact evidence was not copied.'
    );

    v_created := true;
  end if;

  if v_profile_id is null then
    select id into v_profile_id
    from public.volunteers
    where core_volunteer_id=v_core_id
    limit 1;
  end if;

  if v_row.pending_identity_id is not null then
    update public.pending_volunteer_identities
    set status='claimed',claimed_core_volunteer_id=v_core_id,updated_by=p_actor
    where id=v_row.pending_identity_id;
  end if;

  update public.historical_attendance_import_rows
  set
    matched_core_volunteer_id=v_core_id,
    matched_volunteer_id=v_profile_id,
    match_status=case when matched_keluarga_event_id is not null then 'matched' else 'needs_review' end,
    match_reason=case
      when v_created then 'New canonical volunteer created without copying unverified source contact evidence'
      else 'Linked to existing canonical volunteer during staged attendance review'
    end,
    review_flags=array_remove(review_flags,'volunteer_unmatched'),
    pending_identity_id=null
  where id=p_row_id;

  perform audit.write_event(
    case when v_created
      then 'maklom.historical_attendance_volunteer_created'
      else 'maklom.historical_attendance_volunteer_linked'
    end,
    'historical_attendance',
    p_row_id,
    jsonb_build_object(
      'core_volunteer_id',v_core_id,
      'profile_id',v_profile_id,
      'volunteer_code',v_code,
      'created',v_created,
      'source_row_number',v_row.source_row_number,
      'source_contact_copied',false
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'row_id',p_row_id,
    'core_volunteer_id',v_core_id,
    'profile_id',v_profile_id,
    'volunteer_code',v_code,
    'display_name',v_name,
    'email',v_email,
    'phone',v_phone,
    'created',v_created
  );
end;
$$;
