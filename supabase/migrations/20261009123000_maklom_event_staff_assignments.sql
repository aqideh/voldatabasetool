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
for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.maklom_staff_access a where a.user_id=(select auth.uid()) and a.role='superadmin' and a.active));

create or replace function public.maklom_assign_event_staff(p_user_id uuid,p_event_id uuid,p_assign boolean)
returns void language plpgsql security definer set search_path=''
as $fn$
begin
 if not exists(select 1 from public.maklom_staff_access a where a.user_id=auth.uid() and a.role='superadmin' and a.active) then
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
-- All on-site changes use the established Keluarga attendance/session helpers.
-- This is the only write path available to event-scoped MakLom Operations Staff.
create or replace function public.maklom_staff_record_attendance(
 p_event_id uuid, p_roster_id uuid, p_action text
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid := auth.uid();
 v_roster public.phaseone_roster%rowtype;
 v_slot public.phaseone_event_timeslots%rowtype;
 v_session_id uuid;
 v_session_result jsonb;
 v_time timestamptz := now();
begin
 if v_actor is null or p_event_id is null or p_roster_id is null
    or p_action not in ('check_in','check_out') or p_action is null then
   raise exception 'Invalid on-site attendance request' using errcode='22023';
 end if;
 -- Lock the grant and role for this transaction to prevent a concurrent
 -- reassignment or suspension from racing an on-site attendance change.
 perform 1 from public.maklom_event_staff_assignments a
 join public.maklom_staff_access m on m.user_id=a.user_id
 where a.user_id=v_actor and a.event_id=p_event_id
   and m.role='operations_staff' and m.active
 for share of a,m;
 if not found then
   raise exception 'Not assigned to this event' using errcode='42501';
 end if;
 select * into v_roster from public.phaseone_roster r
 where r.id=p_roster_id and r.event_id=p_event_id
 for share;
 if not found then
   raise exception 'Roster entry is not in the assigned event' using errcode='42501';
 end if;
 select * into v_slot from public.phaseone_event_timeslots t
 where t.id=v_roster.timeslot_id and t.event_id=p_event_id
   and t.status<>'cancelled';
 if not found or v_slot.ends_at is null then
   raise exception 'Scheduled shift is unavailable for on-site attendance' using errcode='22023';
 end if;
 if v_time < v_slot.starts_at - interval '12 hours'
   or v_time > v_slot.ends_at + interval '12 hours' then
   raise exception 'On-site attendance is only available around the assigned shift' using errcode='42501';
 end if;
 if p_action='check_in' then
   -- A second check-in must not overwrite an earlier attendance timestamp.
   perform 1 from public.phaseone_attendance att
   where att.event_id=p_event_id and att.roster_id=p_roster_id
     and att.signed_in_at is not null;
   if found then
     raise exception 'Volunteer already has a check-in; corrections require a manager' using errcode='23505';
   end if;
   perform public.phaseone_apply_attendance_change(
     p_event_id,p_roster_id,'mark_sign_in',v_time,'MakLom assigned staff check-in',v_actor
   );
   v_session_result:=public.phaseone_open_attendance_session(
     p_event_id,p_roster_id,v_time,v_actor
   );
 else
   select s.id into v_session_id
   from public.phaseone_attendance_sessions s
   where s.event_id=p_event_id
     and s.attendance_date=timezone('Asia/Singapore',v_slot.starts_at)::date
     and s.person_key=v_roster.attendance_person_key
     and s.checked_out_at is null
   for update;
   if v_session_id is null then
     raise exception 'There is no open check-in session for this volunteer' using errcode='22023';
   end if;
   v_session_result:=public.phaseone_close_attendance_session(
     p_event_id,p_roster_id,v_time,'MakLom assigned staff check-out',v_actor
   );
   if v_session_result is null then
     raise exception 'The open session could not be closed' using errcode='P0001';
   end if;
 end if;
 return jsonb_build_object(
   'event_id',p_event_id,'roster_id',p_roster_id,'action',p_action,
   'session',v_session_result
 );
end;
$fn$;
revoke all on function public.maklom_staff_record_attendance(uuid,uuid,text)
 from public,anon;
grant execute on function public.maklom_staff_record_attendance(uuid,uuid,text)
 to authenticated;

commit;
