-- MakLom prospective-volunteer lead pipeline.
-- FormSG responses are stored separately from canonical volunteer records until deliberate conversion.

create table if not exists public.volunteer_leads (
  id text primary key default ('lead_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  source text not null default 'formsg' check (source in ('formsg', 'manual')),
  source_form_id text,
  source_submission_id text,
  submitted_at timestamptz,
  status text not null default 'new'
    check (status in ('new','reviewing','contacted','accepted','converted','not_selected','withdrawn')),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 50),
  interest_area text check (interest_area is null or char_length(interest_area) <= 500),
  motivation text check (motivation is null or char_length(motivation) <= 5000),
  skills_experience text check (skills_experience is null or char_length(skills_experience) <= 5000),
  availability_notes text check (availability_notes is null or char_length(availability_notes) <= 3000),
  referral_source text check (referral_source is null or char_length(referral_source) <= 1000),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 10000),
  raw_payload jsonb not null default '{}'::jsonb,
  converted_volunteer_id text references public.volunteers(id) on delete set null,
  keluarga_volunteer_id uuid references core.volunteers(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version bigint not null default 1,
  constraint volunteer_leads_form_source_check check (source <> 'formsg' or source_form_id is not null),
  constraint volunteer_leads_conversion_check check (
    (status = 'converted' and converted_volunteer_id is not null and converted_at is not null)
    or status <> 'converted'
  ),
  constraint volunteer_leads_source_submission_unique unique (source, source_form_id, source_submission_id)
);

create index if not exists volunteer_leads_status_submitted_idx
  on public.volunteer_leads(status, submitted_at desc nulls last);
create index if not exists volunteer_leads_email_idx
  on public.volunteer_leads(lower(btrim(email))) where email is not null;
create index if not exists volunteer_leads_phone_idx
  on public.volunteer_leads(phone) where phone is not null;
create index if not exists volunteer_leads_converted_volunteer_idx
  on public.volunteer_leads(converted_volunteer_id) where converted_volunteer_id is not null;
create index if not exists volunteer_leads_keluarga_volunteer_idx
  on public.volunteer_leads(keluarga_volunteer_id) where keluarga_volunteer_id is not null;

drop trigger if exists set_volunteer_leads_created_fields on public.volunteer_leads;
create trigger set_volunteer_leads_created_fields
before insert on public.volunteer_leads
for each row execute function public.set_maklom_created_fields();

drop trigger if exists set_volunteer_leads_updated_fields on public.volunteer_leads;
create trigger set_volunteer_leads_updated_fields
before update on public.volunteer_leads
for each row execute function public.set_maklom_updated_fields();

create or replace function maklom_private.log_maklom_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare record_id text; version_value text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in (
      'volunteers','volunteer_leads','attendance_log','reporting_metrics',
      'suspected_duplicates','merge_log','form_import_batches','form_submissions',
      'attendance_reconciliations','events','event_shifts','event_impact_metrics'
    )
  then
    raise exception 'MakLom audit trigger invoked from unexpected relation %.%',tg_table_schema,tg_table_name;
  end if;

  if tg_op='DELETE' then
    record_id=old.id;
    version_value=to_jsonb(old)->>'row_version';
  else
    record_id=new.id;
    version_value=to_jsonb(new)->>'row_version';
  end if;

  insert into public.audit_log(actor_user_id,entity_type,entity_id,action,details)
  values(
    auth.uid(),tg_table_name,record_id,lower(tg_op),
    jsonb_strip_nulls(jsonb_build_object('source','database-trigger','row_version',version_value))
  );

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function maklom_private.log_maklom_change() from public,anon,authenticated;

drop trigger if exists audit_volunteer_leads_changes on public.volunteer_leads;
create trigger audit_volunteer_leads_changes
after insert or update or delete on public.volunteer_leads
for each row execute function maklom_private.log_maklom_change();

revoke all on public.volunteer_leads from anon;
grant select,insert,update,delete on public.volunteer_leads to authenticated,service_role;
alter table public.volunteer_leads enable row level security;

drop policy if exists volunteer_leads_read_members on public.volunteer_leads;
create policy volunteer_leads_read_members on public.volunteer_leads
for select to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
  )
);

drop policy if exists volunteer_leads_insert_editors on public.volunteer_leads;
create policy volunteer_leads_insert_editors on public.volunteer_leads
for insert to authenticated
with check (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
      and m.role=any(array['editor'::text,'admin'::text])
  )
);

drop policy if exists volunteer_leads_update_editors on public.volunteer_leads;
create policy volunteer_leads_update_editors on public.volunteer_leads
for update to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
      and m.role=any(array['editor'::text,'admin'::text])
  )
)
with check (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active
      and m.role=any(array['editor'::text,'admin'::text])
  )
);

drop policy if exists volunteer_leads_delete_admins on public.volunteer_leads;
create policy volunteer_leads_delete_admins on public.volunteer_leads
for delete to authenticated
using (
  exists (
    select 1 from public.app_members m
    where m.user_id=(select auth.uid()) and m.active and m.role='admin'
  )
);

create or replace function public.maklom_convert_volunteer_lead(p_lead_id text)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.volunteer_leads%rowtype;
  v_existing_id text;
  v_match_count integer := 0;
  v_new_id text;
  v_notes text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.app_members m
    where m.user_id=v_actor and m.active
      and m.role=any(array['editor'::text,'admin'::text])
  ) then
    raise exception 'MakLom editor access required' using errcode='42501';
  end if;

  select * into v_lead
  from public.volunteer_leads
  where id=p_lead_id
  for update;

  if not found then
    raise exception 'Volunteer lead not found' using errcode='P0002';
  end if;

  if v_lead.status='converted' and v_lead.converted_volunteer_id is not null then
    return jsonb_build_object(
      'status','already_converted',
      'lead_id',v_lead.id,
      'volunteer_id',v_lead.converted_volunteer_id
    );
  end if;

  if v_lead.status <> 'accepted' then
    raise exception 'Lead must be accepted before conversion' using errcode='P0001';
  end if;

  if nullif(btrim(coalesce(v_lead.email,'')),'') is not null then
    select count(*),min(v.id)
    into v_match_count,v_existing_id
    from public.volunteers v
    where lower(btrim(v.email))=lower(btrim(v_lead.email));

    if v_match_count > 1 then
      raise exception 'Multiple volunteers already use this email; resolve the duplicate before conversion'
        using errcode='P0001';
    end if;
  end if;

  if v_match_count=0 and nullif(btrim(coalesce(v_lead.phone,'')),'') is not null then
    select count(*),min(v.id)
    into v_match_count,v_existing_id
    from public.volunteers v
    where regexp_replace(coalesce(v.phone,''),'[^0-9]','','g')
          =regexp_replace(v_lead.phone,'[^0-9]','','g')
      and lower(btrim(v.name))=lower(btrim(v_lead.full_name));

    if v_match_count > 1 then
      raise exception 'Multiple volunteers match this name and phone; resolve the duplicate before conversion'
        using errcode='P0001';
    end if;
  end if;

  if v_match_count=1 and v_existing_id is not null then
    update public.volunteer_leads
    set status='converted',
        converted_volunteer_id=v_existing_id,
        converted_at=now()
    where id=v_lead.id;

    return jsonb_build_object(
      'status','linked_existing',
      'lead_id',v_lead.id,
      'volunteer_id',v_existing_id
    );
  end if;

  v_new_id := 'vol_' || substr(replace(gen_random_uuid()::text,'-',''),1,20);

  v_notes := concat_ws(
    E'\n\n',
    case when nullif(btrim(coalesce(v_lead.motivation,'')),'') is not null
      then 'Volunteer motivation: ' || btrim(v_lead.motivation) end,
    case when nullif(btrim(coalesce(v_lead.skills_experience,'')),'') is not null
      then 'Skills / experience: ' || btrim(v_lead.skills_experience) end,
    case when nullif(btrim(coalesce(v_lead.availability_notes,'')),'') is not null
      then 'Availability: ' || btrim(v_lead.availability_notes) end,
    case when nullif(btrim(coalesce(v_lead.referral_source,'')),'') is not null
      then 'Referral source: ' || btrim(v_lead.referral_source) end,
    case when nullif(btrim(coalesce(v_lead.staff_notes,'')),'') is not null
      then 'Lead notes: ' || btrim(v_lead.staff_notes) end
  );

  insert into public.volunteers (
    id,name,phone,email,recruited_year,interests,tags,notes
  ) values (
    v_new_id,
    btrim(v_lead.full_name),
    nullif(btrim(coalesce(v_lead.phone,'')),''),
    nullif(lower(btrim(coalesce(v_lead.email,''))),''),
    extract(year from coalesce(v_lead.submitted_at,now()))::smallint,
    nullif(btrim(coalesce(v_lead.interest_area,'')),''),
    array['FormSG lead']::text[],
    nullif(v_notes,'')
  );

  update public.volunteer_leads
  set status='converted',
      converted_volunteer_id=v_new_id,
      converted_at=now()
  where id=v_lead.id;

  return jsonb_build_object(
    'status','created',
    'lead_id',v_lead.id,
    'volunteer_id',v_new_id
  );
end;
$$;

revoke all on function public.maklom_convert_volunteer_lead(text) from public,anon;
grant execute on function public.maklom_convert_volunteer_lead(text) to authenticated,service_role;
