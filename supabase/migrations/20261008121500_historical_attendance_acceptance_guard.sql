
create or replace function maklom_private.enforce_historical_attendance_acceptance_guard()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_blocking text[] := array[
    'volunteer_unmatched',
    'volunteer_ambiguous',
    'identity_conflict',
    'event_date_missing',
    'event_unmatched',
    'event_ambiguous',
    'shift_ambiguous',
    'sign_in_time_unreadable'
  ]::text[];
begin
  if new.decision='approved'
     and old.decision is distinct from new.decision then
    if coalesce(new.review_flags,'{}'::text[]) && v_blocking then
      raise exception 'Resolve all blocking review flags before accepting attendance'
        using errcode='P0001';
    end if;

    if new.matched_core_volunteer_id is null
       or new.matched_volunteer_id is null then
      raise exception 'Resolve the canonical volunteer before accepting attendance'
        using errcode='P0001';
    end if;

    if new.source_sign_in_at is null
       and new.effective_sign_in_at is null then
      raise exception 'Resolve the attendance sign-in time before accepting attendance'
        using errcode='P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function maklom_private.enforce_historical_attendance_acceptance_guard()
  from public,anon,authenticated;

drop trigger if exists enforce_historical_attendance_acceptance_guard
  on public.historical_attendance_import_rows;

create trigger enforce_historical_attendance_acceptance_guard
before update of decision on public.historical_attendance_import_rows
for each row
execute function maklom_private.enforce_historical_attendance_acceptance_guard();
