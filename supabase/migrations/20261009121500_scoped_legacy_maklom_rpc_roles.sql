-- The legacy member table is intentionally not populated for new roles.
-- Only reviewed procedures use this permission-bound membership projection.
begin;
create or replace function public.maklom_scoped_member(p_permission text)
returns table(user_id uuid, role text, active boolean)
language sql stable security definer set search_path = ''
as $fn$
  select m.user_id, m.role, m.active
  from public.app_members m
  where m.user_id = (select auth.uid())
  union all
  select a.user_id, 'editor'::text, true
  from public.maklom_staff_access a
  where a.user_id = (select auth.uid())
    and a.active
    and a.role <> 'superadmin'
    and public.maklom_can(p_permission)
$fn$;
revoke all on function public.maklom_scoped_member(text) from public, anon;
grant execute on function public.maklom_scoped_member(text) to authenticated;

do $reviewed_rpcs$
declare
  item record;
  function_definition text;
  amended_definition text;
begin
  for item in
    select * from (values
      ('public','maklom_search_volunteers','volunteers.read'),
      ('public','maklom_volunteer_search_options','volunteers.read'),
      ('public','maklom_profile_reconciliation_match_keys','data.read'),
      ('public','stage_maklom_profile_reconciliation','data.write'),
      ('public','review_maklom_profile_reconciliation_match','data.write'),
      ('public','review_maklom_profile_reconciliation_change','data.write'),
      ('public','review_volunteer_profile_change','data.write'),
      ('public','maklom_convert_volunteer_lead','leads.write'),
      ('public','maklom_correct_keluarga_attendance','ops.write'),
      ('public','maklom_bulk_approve_contributions','ops.write'),
      ('public','maklom_commit_historical_attendance_batch','ops.write'),
      ('public','maklom_resolve_roster_volunteer','ops.write'),
      ('maklom_domain','event_audit_impl','audit.read')
    ) as a(schema_name,function_name,permission)
  loop
    select pg_get_functiondef(p.oid) into function_definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname=item.schema_name and p.proname=item.function_name
      and p.prokind='f';

    if function_definition is null then
      raise exception 'Missing required RPC %.%', item.schema_name,item.function_name;
    end if;
    amended_definition := regexp_replace(
      function_definition,
      'from[[:space:]]+public[.]app_members',
      'from public.maklom_scoped_member(' || quote_literal(item.permission) || ')',
      'gi'
    );
    if amended_definition=function_definition then
      raise exception 'Legacy membership guard absent in %.%',item.schema_name,item.function_name;
    end if;
    execute amended_definition;
  end loop;
end;
$reviewed_rpcs$;
commit;
