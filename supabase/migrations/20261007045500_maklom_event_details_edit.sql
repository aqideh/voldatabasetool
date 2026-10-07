-- Allow MakLom editors to correct shared canonical event metadata without granting
-- direct UPDATE access to phaseone_events. Publication and full guide editing remain
-- owned by Keluarga; this governed RPC only covers staff-facing metadata corrections.

create or replace function maklom_domain.update_event_details_impl(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_venue text,
  p_opportunity_category text,
  p_reason_note text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.phaseone_events%rowtype;
  v_updated public.phaseone_events%rowtype;
  v_title text := btrim(coalesce(p_title,''));
  v_venue text := nullif(btrim(coalesce(p_venue,'')),'');
  v_category text := nullif(btrim(coalesce(p_opportunity_category,'')),'');
  v_note text := btrim(coalesce(p_reason_note,''));
begin
  perform maklom_domain.require_editor(p_actor);

  if char_length(v_title) < 2 or char_length(v_title) > 160 then
    raise exception 'Event title must be between 2 and 160 characters' using errcode='22023';
  end if;
  if v_venue is not null and char_length(v_venue) > 300 then
    raise exception 'Venue must be 300 characters or fewer' using errcode='22023';
  end if;
  if v_category is not null and char_length(v_category) > 120 then
    raise exception 'Programme / category must be 120 characters or fewer' using errcode='22023';
  end if;
  if char_length(v_note) < 5 or char_length(v_note) > 500 then
    raise exception 'A correction note between 5 and 500 characters is required' using errcode='22023';
  end if;

  select * into v_event
  from public.phaseone_events
  where id=p_event_id
  for update;

  if not found then
    raise exception 'Keluarga event not found' using errcode='P0002';
  end if;

  if p_expected_updated_at is not null and v_event.updated_at is distinct from p_expected_updated_at then
    raise exception 'Event details changed since this workspace was opened. Refresh before saving.'
      using errcode='40001';
  end if;

  update public.phaseone_events
  set
    title=v_title,
    venue=v_venue,
    opportunity_category=v_category,
    updated_by=p_actor,
    updated_at=now()
  where id=p_event_id
  returning * into v_updated;

  perform audit.write_event(
    'maklom.event_details_corrected',
    'event',
    p_event_id::text,
    jsonb_build_object(
      'event_id',p_event_id,
      'reason_note',v_note,
      'old',jsonb_build_object(
        'title',v_event.title,
        'venue',v_event.venue,
        'opportunity_category',v_event.opportunity_category
      ),
      'new',jsonb_build_object(
        'title',v_updated.title,
        'venue',v_updated.venue,
        'opportunity_category',v_updated.opportunity_category
      )
    ),
    p_actor,
    null
  );

  return jsonb_build_object(
    'event_id',v_updated.id,
    'title',v_updated.title,
    'venue',v_updated.venue,
    'opportunity_category',v_updated.opportunity_category,
    'updated_at',v_updated.updated_at
  );
end;
$$;

create or replace function public.maklom_event_update_details(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_venue text,
  p_opportunity_category text,
  p_reason_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return maklom_domain.update_event_details_impl(
    p_event_id,
    p_expected_updated_at,
    p_title,
    p_venue,
    p_opportunity_category,
    p_reason_note,
    auth.uid()
  );
end;
$$;

grant execute on function maklom_domain.update_event_details_impl(
  uuid,timestamptz,text,text,text,text,uuid
) to authenticated,service_role;

revoke all on function public.maklom_event_update_details(
  uuid,timestamptz,text,text,text,text
) from public,anon;
grant execute on function public.maklom_event_update_details(
  uuid,timestamptz,text,text,text,text
) to authenticated,service_role;
