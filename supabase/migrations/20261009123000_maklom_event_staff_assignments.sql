-- Operational assignments are explicit and independent of Keluarga volunteer leaders.
begin;
create table public.maklom_event_staff_assignments (
  event_id uuid not null references public.phaseone_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index maklom_event_staff_by_user on public.maklom_event_staff_assignments(user_id,event_id);
alter table public.maklom_event_staff_assignments enable row level security;
revoke all on public.maklom_event_staff_assignments from anon,authenticated;
grant select on public.maklom_event_staff_assignments to authenticated;
create policy maklom_event_staff_own on public.maklom_event_staff_assignments
for select to authenticated using (user_id=(select auth.uid()) or (select public.maklom_can('staff.manage')));

create or replace function public.maklom_assign_event_staff(p_user_id uuid,p_event_id uuid,p_assign boolean)
returns void language plpgsql security definer set search_path=''
as $fn$
begin
 if not public.maklom_can('staff.manage') then
  raise exception 'Superadmin access required' using errcode='42501';
 end if;
 if not exists(select 1 from public.maklom_staff_access a
               where a.user_id=p_user_id and a.active and a.role='operations_staff') then
  raise exception 'Target must have active Operations Staff access' using errcode='22023';
 end if;
 if not exists(select 1 from public.phaseone_events e where e.id=p_event_id) then
  raise exception 'Event not found' using errcode='22023';
 end if;
 if p_assign then
  insert into public.maklom_event_staff_assignments(event_id,user_id,assigned_by)
  values(p_event_id,p_user_id,auth.uid()) on conflict do nothing;
 else
  delete from public.maklom_event_staff_assignments
  where event_id=p_event_id and user_id=p_user_id;
 end if;
end;
$fn$;
revoke all on function public.maklom_assign_event_staff(uuid,uuid,boolean) from public,anon;
grant execute on function public.maklom_assign_event_staff(uuid,uuid,boolean) to authenticated;

create or replace function public.maklom_my_assigned_events()
returns table(event_id uuid,title text,reporting_at timestamptz,venue text,roster_count bigint)
language plpgsql stable security definer set search_path=''
as $fn$
begin
 if not exists(select 1 from public.maklom_staff_access a
               where a.user_id=auth.uid() and a.active and a.role='operations_staff') then
  raise exception 'Operations Staff access required' using errcode='42501';
 end if;
 return query
  select e.id,e.title,e.reporting_at,e.venue,
         (select count(*) from public.phaseone_roster r where r.event_id=e.id)
  from public.maklom_event_staff_assignments s
  join public.phaseone_events e on e.id=s.event_id
  where s.user_id=auth.uid()
  order by e.reporting_at desc;
end;
$fn$;
revoke all on function public.maklom_my_assigned_events() from public,anon;
grant execute on function public.maklom_my_assigned_events() to authenticated;

create or replace function public.maklom_my_event_roster(p_event_id uuid)
returns table(roster_id uuid,volunteer_name text,checked_in_at timestamptz,checked_out_at timestamptz)
language plpgsql stable security definer set search_path=''
as $fn$
begin
 if not exists(
   select 1 from public.maklom_event_staff_assignments a
   join public.maklom_staff_access m on m.user_id=a.user_id
   where a.user_id=auth.uid() and a.event_id=p_event_id
     and m.active and m.role='operations_staff'
 ) then raise exception 'Not assigned to this event' using errcode='42501'; end if;
 return query
 select r.id,r.volunteer_name,
   (select min(s.checked_in_at) from public.phaseone_attendance_sessions s
     where s.event_id=p_event_id and s.origin_roster_id=r.id),
   (select max(s.checked_out_at) from public.phaseone_attendance_sessions s
     where s.event_id=p_event_id and s.origin_roster_id=r.id)
 from public.phaseone_roster r
 where r.event_id=p_event_id
 order by r.volunteer_name;
end;
$fn$;
revoke all on function public.maklom_my_event_roster(uuid) from public,anon;
grant execute on function public.maklom_my_event_roster(uuid) to authenticated;
commit;
