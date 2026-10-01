-- Add age to the existing RLS-protected Central Database search.
-- DOB-based age uses today's Singapore date; staff-supplied ages retain their provenance.
create or replace view public.maklom_volunteer_search_v2 with (security_invoker=true) as
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
    v.name,
    v.nric,
    v.email,
    v.phone,
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
    lower(concat_ws(' '::text, cv.volunteer_code, v.name, v.nric, v.phone, v.email, v.gender, v.address, v.neighbourhood, v.planning_area, v.electoral_division, v.recruited_year::text, v.chat_session, v.chat_session_date::text, v.interests, v.languages_spoken, array_to_string(v.programmes_registered, ' '::text), array_to_string(v.tags, ' '::text), v.emergency_name, v.emergency_phone, v.shirt_size, v.dietary, v.notes, array_to_string(COALESCE(a.attended_events, '{}'::text[]), ' '::text), array_to_string(COALESCE(r.registered_events, '{}'::text[]), ' '::text))) AS search_text,
    case when pd.date_of_birth is not null and pd.date_of_birth <= (now() at time zone 'Asia/Singapore')::date
      then extract(year from age((now() at time zone 'Asia/Singapore')::date, pd.date_of_birth))::integer
      when pd.date_of_birth is null and cv.age >= 0 then cv.age::integer end AS age,
    case when pd.date_of_birth is not null then 'date_of_birth'
      when cv.age >= 0 then 'staff_recorded' end AS age_source
   FROM volunteers v
     JOIN core.volunteers cv ON cv.id = v.core_volunteer_id
     LEFT JOIN public.volunteer_private_details pd ON pd.volunteer_id = cv.id
     LEFT JOIN maklom_volunteer_intelligence i ON i.core_volunteer_id = v.core_volunteer_id
     LEFT JOIN attended a ON a.core_volunteer_id = v.core_volunteer_id
     LEFT JOIN registered r ON r.core_volunteer_id = v.core_volunteer_id;

CREATE OR REPLACE FUNCTION public.maklom_volunteer_query_matches(p_row jsonb, p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_type text := coalesce(p_node->>'type','group');
  v_join text := upper(coalesce(p_node->>'operator','AND'));
  v_field text;
  v_operator text;
  v_value jsonb;
  v_actual_text text;
  v_expected_text text;
  v_actual_number numeric;
  v_low numeric;
  v_high numeric;
  v_actual_date date;
  v_date_low date;
  v_date_high date;
  v_child jsonb;
  v_values text[];
  v_actual_values text[];
begin
  if p_node is null or p_node='null'::jsonb then
    return true;
  end if;

  if v_type='group' then
    if jsonb_typeof(p_node->'children') <> 'array'
       or jsonb_array_length(p_node->'children')=0 then
      return true;
    end if;

    if v_join='OR' then
      for v_child in select value from jsonb_array_elements(p_node->'children')
      loop
        if public.maklom_volunteer_query_matches(p_row,v_child) then
          return true;
        end if;
      end loop;
      return false;
    end if;

    for v_child in select value from jsonb_array_elements(p_node->'children')
    loop
      if not public.maklom_volunteer_query_matches(p_row,v_child) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  if v_type <> 'condition' then
    return true;
  end if;

  v_field := p_node->>'field';
  v_operator := p_node->>'operator';
  v_value := p_node->'value';

  if v_field in (
    'anyText','name','nric','phone','email','gender','address','neighbourhood',
    'planning_area','electoral_division','chat_session','interests',
    'languages_spoken','emergency_name','emergency_phone','shirt_size','dietary','notes'
  ) then
    v_actual_text := lower(coalesce(
      case v_field
        when 'anyText' then p_row->>'search_text'
        else p_row->>v_field
      end,''
    ));
    v_expected_text := lower(coalesce(v_value#>>'{}',''));

    if v_operator='isEmpty' then return btrim(v_actual_text)=''; end if;
    if v_operator='isNotEmpty' then return btrim(v_actual_text)<>''; end if;
    if v_expected_text='' then return true; end if;
    if v_operator='contains' then return position(v_expected_text in v_actual_text)>0; end if;
    if v_operator='notContains' then return position(v_expected_text in v_actual_text)=0; end if;
    if v_operator='equals' then return v_actual_text=v_expected_text; end if;
    if v_operator='notEquals' then return v_actual_text<>v_expected_text; end if;
    if v_operator='startsWith' then return left(v_actual_text,length(v_expected_text))=v_expected_text; end if;
    return true;
  end if;

  if v_field in ('programmes_registered','tags','attended_events','registered_events') then
    select coalesce(array_agg(lower(value)),'{}'::text[])
    into v_actual_values
    from jsonb_array_elements_text(coalesce(p_row->v_field,'[]'::jsonb));

    select coalesce(array_agg(lower(value)),'{}'::text[])
    into v_values
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_value)='array' then v_value else '[]'::jsonb end
    );

    if v_operator='isEmpty' then return cardinality(v_actual_values)=0; end if;
    if v_operator='isNotEmpty' then return cardinality(v_actual_values)>0; end if;
    if cardinality(v_values)=0 then return true; end if;

    if v_operator in ('hasAny','registeredAny','attendedAny') then
      return exists(select 1 from unnest(v_values) x where x=any(v_actual_values));
    end if;
    if v_operator in ('hasAll','registeredAll','attendedAll') then
      return not exists(select 1 from unnest(v_values) x where not (x=any(v_actual_values)));
    end if;
    if v_operator in ('hasNone','registeredNone','attendedNone') then
      return not exists(select 1 from unnest(v_values) x where x=any(v_actual_values));
    end if;
    return true;
  end if;

  if v_field in (
    'age','recruited_year','total_hours','attended_event_count','registered_event_count','events_last_90d'
  ) then
    begin
      v_actual_number := case
        when v_field='total_hours' then coalesce((p_row->>'total_credited_minutes')::numeric,0)/60.0
        else nullif(p_row->>v_field,'')::numeric
      end;
    exception when others then
      v_actual_number := null;
    end;

    if v_operator='isEmpty' then
      return v_actual_number is null or (v_field='total_hours' and v_actual_number=0);
    end if;
    if v_operator='isNotEmpty' then
      return v_actual_number is not null and (v_field<>'total_hours' or v_actual_number>0);
    end if;

    if v_operator='between' then
      begin
        v_low := nullif(v_value->>0,'')::numeric;
        v_high := nullif(v_value->>1,'')::numeric;
      exception when others then
        return true;
      end;
      if v_low is null or v_high is null then return true; end if;
      if v_actual_number is null then return false; end if;
      return v_actual_number between least(v_low,v_high) and greatest(v_low,v_high);
    end if;

    begin
      v_low := nullif(v_value#>>'{}','')::numeric;
    exception when others then
      return true;
    end;
    if v_low is null then return true; end if;
    if v_actual_number is null then return false; end if;
    if v_operator='eq' then return v_actual_number=v_low; end if;
    if v_operator='ne' then return v_actual_number<>v_low; end if;
    if v_operator='gt' then return v_actual_number>v_low; end if;
    if v_operator='gte' then return v_actual_number>=v_low; end if;
    if v_operator='lt' then return v_actual_number<v_low; end if;
    if v_operator='lte' then return v_actual_number<=v_low; end if;
    return true;
  end if;

  if v_field in ('chat_session_date','first_event_date','last_active') then
    begin
      v_actual_date := nullif(p_row->>v_field,'')::date;
    exception when others then
      v_actual_date := null;
    end;

    if v_operator='isEmpty' then return v_actual_date is null; end if;
    if v_operator='isNotEmpty' then return v_actual_date is not null; end if;
    if v_actual_date is null then return false; end if;

    if v_operator='between' then
      begin
        v_date_low := nullif(v_value->>0,'')::date;
        v_date_high := nullif(v_value->>1,'')::date;
      exception when others then
        return true;
      end;
      if v_date_low is null or v_date_high is null then return true; end if;
      return v_actual_date between least(v_date_low,v_date_high) and greatest(v_date_low,v_date_high);
    end if;

    begin
      v_date_low := nullif(v_value#>>'{}','')::date;
    exception when others then
      return true;
    end;
    if v_date_low is null then return true; end if;
    if v_operator='on' then return v_actual_date=v_date_low; end if;
    if v_operator='before' then return v_actual_date<v_date_low; end if;
    if v_operator='after' then return v_actual_date>v_date_low; end if;
    return true;
  end if;

  if v_field='activity' then
    if v_operator='hasAttendance' then return coalesce((p_row->>'attended_event_count')::integer,0)>0; end if;
    if v_operator='noAttendance' then return coalesce((p_row->>'attended_event_count')::integer,0)=0; end if;
    if v_operator='active90' then return coalesce((p_row->>'events_last_90d')::integer,0)>0; end if;
    return true;
  end if;

  return true;
end;
$function$

