-- Replace the historical-attendance pending-identity dead end with an explicit
-- staff resolver: either link to an existing canonical volunteer or create one.

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

  v_phone := public.phaseone_canonical_mobile(coalesce(nullif(v_query,''),v_row.phone));

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
        case when lower(btrim(coalesce(d.email,'')))=lower(btrim(coalesce(v_row.email,''))) and nullif(btrim(coalesce(v_row.email,'')),'') is not null then 120 else 0 end,
        case when public.phaseone_canonical_mobile(d.phone)=public.phaseone_canonical_mobile(v_row.phone) and public.phaseone_canonical_mobile(v_row.phone) is not null then 110 else 0 end,
        case when lower(btrim(d.name))=lower(btrim(v_row.full_name)) then 100 else 0 end,
        case when v_query<>'' and lower(d.name) like '%'||v_query||'%' then 80 else 0 end,
        case when v_query<>'' and lower(coalesce(d.email,'')) like '%'||v_query||'%' then 70 else 0 end,
        case when v_phone is not null and public.phaseone_canonical_mobile(d.phone) like '%'||v_phone||'%' then 60 else 0 end
      ) as score
    from public.maklom_volunteer_search_directory d
    where
      (
        nullif(btrim(coalesce(v_row.email,'')),'') is not null
        and lower(btrim(coalesce(d.email,'')))=lower(btrim(v_row.email))
      )
      or (
        public.phaseone_canonical_mobile(v_row.phone) is not null
        and public.phaseone_canonical_mobile(d.phone)=public.phaseone_canonical_mobile(v_row.phone)
      )
      or lower(btrim(d.name))=lower(btrim(v_row.full_name))
      or (
        v_query<>''
        and (
          lower(d.name) like '%'||v_query||'%'
          or lower(coalesce(d.email,'')) like '%'||v_query||'%'
          or (v_phone is not null and public.phaseone_canonical_mobile(d.phone) like '%'||v_phone||'%')
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
  v_phone_key text;
  v_duplicate_ids uuid[];
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
    v_email := nullif(lower(btrim(coalesce(p_email,v_row.email,''))),'');
    v_phone := nullif(btrim(coalesce(p_phone,v_row.phone,'')),'');
    v_phone_key := public.phaseone_canonical_mobile(v_phone);

    if v_name is null then
      raise exception 'Volunteer name is required' using errcode='22023';
    end if;

    if v_email is null and v_phone_key is null then
      raise exception 'Email or mobile number is required to create a volunteer'
        using errcode='22023';
    end if;

    select array_agg(v.id)
    into v_duplicate_ids
    from core.volunteers v
    where
      (v_email is not null and lower(btrim(coalesce(v.primary_email_normalized,'')))=v_email)
      or (v_phone_key is not null and public.phaseone_canonical_mobile(v.mobile)=v_phone_key);

    if cardinality(coalesce(v_duplicate_ids,'{}'::uuid[]))>0 then
      raise exception 'An existing volunteer already uses this email or mobile. Match the existing volunteer instead.'
        using errcode='23505';
    end if;

    insert into core.volunteers(
      display_name,primary_email_normalized,mobile,account_access_eligible
    )
    values(v_name,v_email,v_phone,false)
    returning id,volunteer_code into v_core_id,v_code;

    perform core.ensure_maklom_profile_extension(v_core_id,'historical_attendance_resolution');

    select id into v_profile_id
    from public.volunteers
    where core_volunteer_id=v_core_id
    limit 1;

    update public.volunteers
    set notes=coalesce(nullif(btrim(notes),''),'Created from staged historical attendance identity resolution')
    where id=v_profile_id;

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
      when v_created then 'New canonical volunteer created from staged attendance review'
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
      'source_row_number',v_row.source_row_number
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

create or replace function public.maklom_event_staged_identity_candidates(
  p_row_id text,
  p_query text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  return maklom_domain.staged_identity_candidates_impl(p_row_id,p_query,auth.uid());
end;
$$;

create or replace function public.maklom_event_resolve_staged_identity(
  p_row_id text,
  p_expected_version bigint,
  p_existing_core_volunteer_id uuid default null,
  p_create_new boolean default false,
  p_name text default null,
  p_email text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  return maklom_domain.resolve_staged_identity_impl(
    p_row_id,p_expected_version,p_existing_core_volunteer_id,p_create_new,
    p_name,p_email,p_phone,auth.uid()
  );
end;
$$;

grant execute on function maklom_domain.staged_identity_candidates_impl(text,text,uuid)
  to authenticated,service_role;
grant execute on function maklom_domain.resolve_staged_identity_impl(text,bigint,uuid,boolean,text,text,text,uuid)
  to authenticated,service_role;

revoke all on function public.maklom_event_staged_identity_candidates(text,text)
  from public,anon;
grant execute on function public.maklom_event_staged_identity_candidates(text,text)
  to authenticated,service_role;

revoke all on function public.maklom_event_resolve_staged_identity(text,bigint,uuid,boolean,text,text,text)
  from public,anon;
grant execute on function public.maklom_event_resolve_staged_identity(text,bigint,uuid,boolean,text,text,text)
  to authenticated,service_role;
