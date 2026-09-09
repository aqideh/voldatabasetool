create or replace function maklom_private.validate_event_shift() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_start date; event_end date;
begin
  select e.start_date,e.end_date into event_start,event_end from public.events e where e.id=new.event_id;
  if event_start is null then raise exception 'Event % not found',new.event_id; end if;
  if new.shift_date < event_start or new.shift_date > event_end then
    raise exception 'Shift date % is outside event range % to %',new.shift_date,event_start,event_end;
  end if;
  return new;
end; $$;
revoke all on function maklom_private.validate_event_shift() from public,anon,authenticated;

drop trigger if exists validate_event_shift_date on public.event_shifts;
create trigger validate_event_shift_date before insert or update of event_id,shift_date on public.event_shifts
for each row execute function maklom_private.validate_event_shift();

create or replace function maklom_private.sync_attendance_event_links() returns trigger
language plpgsql security definer set search_path='' as $$
declare shift_event_id text; shift_event_name text; linked_shift_date date; linked_event_name text;
begin
  if new.shift_id is not null then
    select s.event_id,e.name,s.shift_date into shift_event_id,shift_event_name,linked_shift_date
    from public.event_shifts s join public.events e on e.id=s.event_id where s.id=new.shift_id;
    if shift_event_id is null then raise exception 'Shift % not found',new.shift_id; end if;
    new.event_id=shift_event_id;
    new.event_name=shift_event_name;
    new.event_date=linked_shift_date;
  elsif new.event_id is not null then
    select e.name into linked_event_name from public.events e where e.id=new.event_id;
    if linked_event_name is null then raise exception 'Event % not found',new.event_id; end if;
    new.event_name=linked_event_name;
  end if;
  return new;
end; $$;
revoke all on function maklom_private.sync_attendance_event_links() from public,anon,authenticated;

drop trigger if exists sync_attendance_event_links on public.attendance_log;
create trigger sync_attendance_event_links before insert or update of event_id,shift_id,event_name,event_date on public.attendance_log
for each row execute function maklom_private.sync_attendance_event_links();

create or replace function maklom_private.propagate_event_metadata() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.name is distinct from old.name then
    update public.attendance_log set event_name=new.name where event_id=new.id;
  end if;
  return new;
end; $$;
revoke all on function maklom_private.propagate_event_metadata() from public,anon,authenticated;

drop trigger if exists propagate_event_metadata on public.events;
create trigger propagate_event_metadata after update of name on public.events
for each row execute function maklom_private.propagate_event_metadata();

create or replace function maklom_private.propagate_shift_metadata() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_name text;
begin
  select e.name into parent_name from public.events e where e.id=new.event_id;
  update public.attendance_log
  set event_id=new.event_id,event_name=parent_name,event_date=new.shift_date
  where shift_id=new.id;
  return new;
end; $$;
revoke all on function maklom_private.propagate_shift_metadata() from public,anon,authenticated;

drop trigger if exists propagate_shift_metadata on public.event_shifts;
create trigger propagate_shift_metadata after update of event_id,shift_date on public.event_shifts
for each row execute function maklom_private.propagate_shift_metadata();