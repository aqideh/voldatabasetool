begin;

grant select on public.phaseone_attendance to authenticated;
grant select on public.phaseone_attendance_effective to authenticated;

drop policy if exists "MakLom members can read KELUARGA attendance state"
  on public.phaseone_attendance;

create policy "MakLom members can read KELUARGA attendance state"
on public.phaseone_attendance
for select
to authenticated
using (
  exists (
    select 1
    from public.app_members member
    where member.user_id = (select auth.uid())
      and member.active
  )
);

commit;
