-- Authorised MakLom volunteer team can view Keluarga's existing private and skills records.
-- No new synced copies are created. All records are still RLS-protected.
CREATE POLICY "MakLom volunteers read private details" ON public.volunteer_private_details FOR SELECT TO authenticated
USING ((select public.maklom_can('volunteers.read')));
CREATE POLICY "MakLom volunteers read skills profile" ON public.keluarga_volunteer_profiles FOR SELECT TO authenticated
USING ((select public.maklom_can('volunteers.read')));
CREATE OR REPLACE VIEW public.maklom_volunteer_search_v2 WITH (security_invoker=true) AS
WITH attended AS (
         SELECT p.core_volunteer_id,
            COALESCE(array_agg(DISTINCT p.event_title ORDER BY p.event_title) FILTER (WHERE NULLIF(btrim(p.event_title), ''::text) IS NOT NULL), '{}'::text[]) AS attended_events
           FROM maklom_event_participation p
          GROUP BY p.core_volunteer_id
        ), registered AS (
         SELECT r_1.volunteer_id AS core_volunteer_id,
            count(DISTINCT r_1.event_id)::integer AS registered_event_count,
            COALESCE(array_agg(DISTINCT e.title ORDER BY e.title) FILTER (WHERE NULLIF(btrim(e.title), ''::text) IS NOT NULL), '{}'::text[]) AS registered_events
           FROM phaseone_roster r_1
             JOIN phaseone_events e ON e.id = r_1.event_id
          WHERE r_1.volunteer_id IS NOT NULL
          GROUP BY r_1.volunteer_id
        )
 SELECT v.id,
    v.core_volunteer_id,
    cv.volunteer_code,
    coalesce(nullif(btrim(cv.display_name),''),nullif(btrim(v.name),''),'Name not provided') AS name,
    v.nric,
    cv.primary_email_normalized AS email,
    cv.mobile AS phone,
    v.gender,
    v.address,
    v.neighbourhood,
    v.planning_area,
    v.electoral_division,
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
    v.row_version,
    COALESCE(i.event_count, 0) AS attended_event_count,
    COALESCE(r.registered_event_count, 0) AS registered_event_count,
    COALESCE(i.historical_credited_minutes, 0::bigint) + COALESCE(i.approved_keluarga_minutes, 0::bigint) AS total_credited_minutes,
    i.first_event_date,
    i.last_event_date AS last_active,
    COALESCE(i.events_last_90d, 0) AS events_last_90d,
    COALESCE(i.active_last_90d, false) AS active_last_90d,
    COALESCE(a.attended_events, '{}'::text[]) AS attended_events,
    COALESCE(r.registered_events, '{}'::text[]) AS registered_events,
    COALESCE(( SELECT min(tag.tag) AS min
           FROM unnest(v.tags) tag(tag)), ''::text) AS first_tag,
    lower(concat_ws(' '::text, cv.volunteer_code, v.name, v.nric, v.phone, v.email, v.gender, v.address, v.neighbourhood, v.planning_area, v.electoral_division, v.recruited_year::text, v.chat_session, v.chat_session_date::text, v.interests, v.languages_spoken, array_to_string(v.programmes_registered, ' '::text), array_to_string(v.tags, ' '::text), v.emergency_name, v.emergency_phone, v.shirt_size, v.dietary, v.notes, array_to_string(COALESCE(a.attended_events, '{}'::text[]), ' '::text), array_to_string(COALESCE(r.registered_events, '{}'::text[]), ' '::text),
    coalesce(cv.display_name,''), coalesce(cv.primary_email_normalized,''), coalesce(cv.mobile,''),
    pd.postal_code,pd.highest_qualification,pd.institution,pd.field_of_study,
    array_to_string(kp.skills,' '),array_to_string(kp.interests,' '),
    array_to_string(kp.availability_slots,' '),kp.preferred_commitment)) AS search_text,
        CASE
            WHEN pd.date_of_birth IS NOT NULL AND pd.date_of_birth <= (now() AT TIME ZONE 'Asia/Singapore'::text)::date THEN EXTRACT(year FROM age((now() AT TIME ZONE 'Asia/Singapore'::text)::date::timestamp with time zone, pd.date_of_birth::timestamp with time zone))::integer
            WHEN pd.date_of_birth IS NULL AND cv.age >= 0 THEN cv.age::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN pd.date_of_birth IS NOT NULL THEN 'date_of_birth'::text
            WHEN cv.age >= 0 THEN 'staff_recorded'::text
            ELSE NULL::text
        END AS age_source,
    pd.date_of_birth,
    pd.postal_code,
    pd.highest_qualification,
    pd.institution,
    pd.field_of_study,
    kp.skills,
    kp.interests AS profile_interests,
    kp.availability_slots,
    kp.preferred_commitment,
    v.name AS maklom_stored_name,
    v.phone AS maklom_stored_phone,
    v.email AS maklom_stored_email,
    (v.phone IS DISTINCT FROM cv.mobile) AS mobile_needs_review
   FROM volunteers v
     JOIN core.volunteers cv ON cv.id = v.core_volunteer_id
     LEFT JOIN volunteer_private_details pd ON pd.volunteer_id = cv.id
     LEFT JOIN keluarga_volunteer_profiles kp ON kp.volunteer_id = cv.id
     LEFT JOIN maklom_volunteer_intelligence i ON i.core_volunteer_id = v.core_volunteer_id
     LEFT JOIN attended a ON a.core_volunteer_id = v.core_volunteer_id
     LEFT JOIN registered r ON r.core_volunteer_id = v.core_volunteer_id;
REVOKE ALL ON public.maklom_volunteer_search_v2 FROM anon;
GRANT SELECT ON public.maklom_volunteer_search_v2 TO authenticated,service_role;