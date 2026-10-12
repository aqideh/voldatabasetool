-- Keep absent volunteer names as NULL, never as a KEL ID.
-- Existing Keluarga account profiles without verified names remain usable in MakLom.
BEGIN;
ALTER TABLE public.volunteers ALTER COLUMN name DROP NOT NULL;
CREATE OR REPLACE FUNCTION core.ensure_maklom_profile_extension(p_volunteer_id uuid, p_origin text DEFAULT 'keluarga_native'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_email text;
  v_mobile text;
  v_code text;
  v_profile_id text;
begin
  if p_volunteer_id is null then
    raise exception 'Volunteer ID is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_volunteer_id::text, 0)
  );

  if exists (
    select 1
    from public.volunteers profile
    where profile.core_volunteer_id = p_volunteer_id
  ) then
    return 'already_exists';
  end if;

  select
    nullif(btrim(volunteer.display_name), ''),
    nullif(lower(btrim(volunteer.primary_email_normalized)), ''),
    nullif(btrim(volunteer.mobile), ''),
    volunteer.volunteer_code
  into v_name, v_email, v_mobile, v_code
  from core.volunteers volunteer
  where volunteer.id = p_volunteer_id;

  if not found then
    raise exception 'Canonical volunteer does not exist' using errcode = 'P0002';
  end if;

  if v_email is null and v_mobile is null then
    raise exception 'MakLom profile requires volunteer email or mobile'
      using errcode = '22023';
  end if;

  v_profile_id := 'vol_' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 20);

  insert into public.volunteers (
    id,
    core_volunteer_id,
    name,
    phone,
    email,
    profile_origin
  )
  values (
    v_profile_id,
    p_volunteer_id,
    v_name,
    v_mobile,
    v_email,
    coalesce(nullif(btrim(p_origin), ''), 'keluarga_native')
  );

  return 'created';
end;
$function$;
UPDATE public.volunteers p SET name=NULL
FROM core.volunteers c
WHERE p.core_volunteer_id=c.id
AND p.name=c.volunteer_code
AND nullif(btrim(c.display_name),'') IS NULL;
COMMIT;
