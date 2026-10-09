-- Separate Keluarga staff administration from MakLom membership.
-- Existing legacy MakLom administrator remains untouched.
begin;
do $separate_keluarga$
declare
  original_definition text;
  amended_definition text;
  start_offset integer;
  end_offset integer;
begin
  select pg_get_functiondef(p.oid) into original_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='core' and p.proname='set_staff_access_level'
    and p.prokind='f';

  if original_definition is null then
    raise exception 'Expected Keluarga staff role function missing';
  end if;
  start_offset := position('  if p_role = ''admin'' then' in original_definition);
  end_offset := position('  return p_role::text;' in original_definition);
  if start_offset=0 or end_offset<=start_offset
    or position('public.app_members' in original_definition)=0 then
    raise exception 'Keluarga access model changed; review before decoupling';
  end if;
  amended_definition :=
    substr(original_definition,1,start_offset-1) ||
    substr(original_definition,end_offset);
  execute amended_definition;
end;
$separate_keluarga$;
commit;
