drop policy if exists "MakLom members can read KELUARGA programme shifts" on public.phaseone_event_timeslots;

create policy "MakLom members can read KELUARGA programme shifts"
on public.phaseone_event_timeslots
for select
to authenticated
using (
  exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active
  )
);
