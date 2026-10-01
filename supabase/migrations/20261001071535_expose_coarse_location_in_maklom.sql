alter table public.volunteers
  add column if not exists neighbourhood text,
  add column if not exists planning_area text,
  add column if not exists electoral_division text;

create or replace function maklom_private.sync_coarse_location_to_maklom()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.volunteers
    set neighbourhood=null, planning_area=null, electoral_division=null
    where core_volunteer_id=old.volunteer_id;
    return old;
  end if;

  update public.volunteers
  set neighbourhood=new.neighbourhood,
      planning_area=new.planning_area,
      electoral_division=new.electoral_division
  where core_volunteer_id=new.volunteer_id;
  return new;
end;
$$;

revoke all on function maklom_private.sync_coarse_location_to_maklom()
from public, anon, authenticated;

drop trigger if exists sync_coarse_location_to_maklom
on public.volunteer_private_details;

create trigger sync_coarse_location_to_maklom
after insert or update of neighbourhood,planning_area,electoral_division
or delete on public.volunteer_private_details
for each row execute function maklom_private.sync_coarse_location_to_maklom();

update public.volunteers v
set neighbourhood=d.neighbourhood,
    planning_area=d.planning_area,
    electoral_division=d.electoral_division
from public.volunteer_private_details d
where d.volunteer_id=v.core_volunteer_id;
