-- Shared Volunteer Leads workbench: explicit recruitment actions and audit.
-- Additive to existing MakLom leads/conversion contract.
alter table public.volunteer_leads
  add column if not exists pathway text,
  add column if not exists contributor_type text,
  add column if not exists responsible_user_id uuid references auth.users(id) on delete set null,
  add column if not exists next_action text,
  add column if not exists next_action_due timestamptz,
  add column if not exists handover_state text,
  add column if not exists handover_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists handover_approved_at timestamptz;

alter table public.volunteer_leads
  add constraint volunteer_leads_pathway_valid
    check (pathway is null or pathway in ('coach','mentor','facilitator','professional_networks','contributor')),
  add constraint volunteer_leads_contributor_type_valid
    check ((pathway='contributor' and contributor_type in ('specialised_skills','project_idea'))
       or (pathway='contributor' and contributor_type is null)
       or (pathway is distinct from 'contributor' and contributor_type is null)),
  add constraint volunteer_leads_handover_state_valid
    check ((pathway in ('coach','professional_networks') and handover_state in ('pending_review','clarification','approved','sent','acknowledged','not_handed_over'))
       or (pathway in ('coach','professional_networks') and handover_state is null)
       or (pathway not in ('coach','professional_networks') and handover_state is null)
       or (pathway is null and handover_state is null)),
  add constraint volunteer_leads_next_action_length check (next_action is null or length(next_action)<=500);

-- FormSG's stable field identifier; no question-text matching for webhooks.
with mapped as (
  select l.id,
   (select f->>'answer' from jsonb_array_elements(coalesce(l.raw_payload->'responses','[]'::jsonb)) f
      where f->>'_id'='6abb1dfa4db467b6eb6a5657' limit 1) as selected_pathway,
   (select f->>'answer' from jsonb_array_elements(coalesce(l.raw_payload->'responses','[]'::jsonb)) f
      where f->>'_id' in ('6abb1f6648cec14a84ac1561','6abb32386bfbf1d55511a304')
        and nullif(f->>'answer','') is not null limit 1) as selected_contributor
  from public.volunteer_leads l where l.pathway is null
), normalized as (
  select id,
   case selected_pathway
    when 'as a Coach' then 'coach'
    when 'as a Mentor' then 'mentor'
    when 'as a Facilitator' then 'facilitator'
    when 'as a Professional Networks Member' then 'professional_networks'
    when 'as a Contributor' then 'contributor'
   end as pathway,
   case
    when selected_pathway='as a Contributor' and selected_contributor='I have specialised skills that I would like to contribute' then 'specialised_skills'
    when selected_pathway='as a Contributor' and selected_contributor='I have an idea that will impact the community' then 'project_idea'
   end as contributor_type
  from mapped
)
update public.volunteer_leads l
 set pathway=n.pathway,contributor_type=n.contributor_type,
     interest_area=coalesce(l.interest_area,n.pathway),
     handover_state=case when n.pathway in ('coach','professional_networks') then 'pending_review' else null end
from normalized n where l.id=n.id and n.pathway is not null;

create index if not exists volunteer_leads_pathway_submitted_idx
 on public.volunteer_leads(pathway,submitted_at desc);
create index if not exists volunteer_leads_responsible_idx
 on public.volunteer_leads(responsible_user_id) where responsible_user_id is not null;

-- Extend the existing role CHECK as well as the permission function.
alter table public.maklom_staff_access
  drop constraint maklom_staff_access_role_check;
alter table public.maklom_staff_access
  add constraint maklom_staff_access_role_check check
  (role in ('superadmin','platform_admin','volunteer_manager','recruitment_staff',
            'data_steward','operations_staff','reporting_viewer'));

-- Recruitment staff see all streams but have no other MakLom operational powers.
create or replace function public.maklom_can(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $fn$
  select exists (
    select 1 from public.maklom_staff_access a
    where a.user_id = auth.uid() and a.active and (
      a.role = 'superadmin'
      or (a.role = 'platform_admin' and p_permission = any(array[
        'staff.manage','analytics.read','volunteers.read','volunteers.write','leads.read','leads.write',
        'data.read','data.write','ops.read','ops.write','audit.read']))
      or (a.role = 'volunteer_manager' and p_permission = any(array[
        'analytics.read','volunteers.read','volunteers.write','leads.read','leads.write',
        'data.read','data.write','ops.read','ops.write']))
      or (a.role = 'recruitment_staff' and p_permission in ('leads.read','leads.write'))
      or (a.role = 'data_steward' and p_permission = any(array[
        'analytics.read','volunteers.read','volunteers.write','data.read','data.write']))
      or (a.role = 'operations_staff' and p_permission = 'analytics.read')
      or (a.role = 'reporting_viewer' and p_permission = 'analytics.read')
    )
  );
$fn$;

create or replace function public.maklom_set_staff_access(p_email text,p_role text,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_target uuid;v_before public.maklom_staff_access%rowtype;
begin
  if not public.maklom_can('staff.manage') then
    raise exception 'Staff access management permission required' using errcode='42501';
  end if;
  if p_role not in ('platform_admin','volunteer_manager','recruitment_staff','data_steward','operations_staff','reporting_viewer')
     or p_role is null or p_active is null then
    raise exception 'Invalid MakLom role or status' using errcode='22023';
  end if;
  if p_email is null or lower(btrim(p_email)) !~ '^[a-z0-9._%+-]+@mendaki[.]org[.]sg$' then
    raise exception 'A registered MENDAKI staff email address is required' using errcode='22023';
  end if;
  select id into v_target from auth.users where lower(email)=lower(btrim(p_email));
  if v_target is null then
    raise exception 'This email does not have an account yet. Ask the colleague to complete sign-in first.' using errcode='22023';
  end if;
  if exists(select 1 from public.maklom_staff_access where user_id=auth.uid() and active and role='platform_admin')
    and (p_role='platform_admin' or exists(select 1 from public.maklom_staff_access
      where user_id=v_target and role in ('superadmin','platform_admin'))) then
    raise exception 'Only Superadmin can manage Platform Admin access' using errcode='42501';
  end if;
  if v_target=auth.uid() then
    raise exception 'Own MakLom access cannot be changed here' using errcode='42501';
  end if;
  select * into v_before from public.maklom_staff_access where user_id=v_target for update;
  if v_before.role='superadmin' then
    raise exception 'Superadmin cannot be reassigned' using errcode='42501';
  end if;
  insert into public.maklom_staff_access(user_id,role,active,granted_by,updated_at)
  values(v_target,p_role,p_active,auth.uid(),now())
  on conflict(user_id) do update
    set role=excluded.role,active=excluded.active,granted_by=excluded.granted_by,updated_at=now();
  if v_before.user_id is null or v_before.role is distinct from p_role or v_before.active is distinct from p_active then
    insert into public.maklom_staff_access_audit
    (actor_user_id,subject_user_id,previous_role,new_role,previous_active,new_active)
    values(auth.uid(),v_target,v_before.role,p_role,v_before.active,p_active);
  end if;
  return jsonb_build_object('user_id',v_target,'role',p_role,'active',p_active);
end;
$fn$;

create table public.volunteer_lead_activities (
  id bigint generated always as identity primary key,
  lead_id text not null references public.volunteer_leads(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in
    ('note','assign','next_action','contact_attempt','contacted','status_update','handover_approve',
     'handover_clarification','handover_decline','handover_sent','handover_acknowledge')),
  note text check(note is null or length(note)<=4000),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index volunteer_lead_activities_lead_time_idx
  on public.volunteer_lead_activities(lead_id,occurred_at desc,id desc);
alter table public.volunteer_lead_activities enable row level security;
revoke all on public.volunteer_lead_activities from public,anon,authenticated;
grant select on public.volunteer_lead_activities to authenticated;
create policy volunteer_lead_activities_staff_read
 on public.volunteer_lead_activities for select to authenticated
 using (public.maklom_can('leads.read'));

-- No direct INSERT/UPDATE/DELETE rights are granted for the activity ledger.
create or replace function public.maklom_list_lead_staff()
returns table(user_id uuid,email text)
language plpgsql stable security definer set search_path=''
as $fn$
begin
 if not public.maklom_can('leads.read') then
   raise exception 'Recruitment access required' using errcode='42501';
 end if;
 return query select a.user_id,u.email::text
 from public.maklom_staff_access a join auth.users u on u.id=a.user_id
 where a.active and a.role in ('superadmin','platform_admin','volunteer_manager','recruitment_staff')
 order by lower(u.email);
end;
$fn$;
revoke all on function public.maklom_list_lead_staff() from public,anon;
grant execute on function public.maklom_list_lead_staff() to authenticated;

create or replace function public.maklom_lead_take_action(
 p_lead_id text,p_expected_version bigint,p_action text,p_note text default null,
 p_assignee uuid default null,p_next_action text default null,p_due timestamptz default null,
 p_status text default null
) returns public.volunteer_leads
language plpgsql security definer set search_path=''
as $fn$
declare before_row public.volunteer_leads%rowtype;
        after_row public.volunteer_leads%rowtype;
        v_note text:=nullif(btrim(coalesce(p_note,'')),'');
        v_action text:=nullif(btrim(coalesce(p_next_action,'')),'');
begin
 if auth.uid() is null or not public.maklom_can('leads.write') then
   raise exception 'Recruitment write access required' using errcode='42501';
 end if;
 select * into before_row from public.volunteer_leads where id=p_lead_id for update;
 if not found then raise exception 'Lead not found' using errcode='P0002'; end if;
 if before_row.row_version is distinct from p_expected_version then
   raise exception 'Lead changed; reload before trying again' using errcode='40001';
 end if;
 if before_row.status='converted' and p_action not in ('note','next_action') then
   raise exception 'Converted lead cannot be reopened here' using errcode='22023';
 end if;
 if p_action not in ('note','assign','next_action','contact_attempt','contacted','status_update',
                   'handover_approve','handover_clarification','handover_decline','handover_sent','handover_acknowledge') then
   raise exception 'Unsupported recruitment action' using errcode='22023';
 end if;
 if length(coalesce(p_note,''))>4000 or length(coalesce(p_next_action,''))>500 then
   raise exception 'Action detail exceeds allowed length' using errcode='22023';
 end if;
 if p_action in ('note','contact_attempt','contacted','handover_clarification','handover_decline','handover_sent','handover_acknowledge')
    and v_note is null then
   raise exception 'Describe this action before saving' using errcode='22023';
 end if;
 if p_action='assign' and p_assignee is not null
   and not exists(select 1 from public.maklom_staff_access a where a.user_id=p_assignee and a.active
     and a.role in ('superadmin','platform_admin','volunteer_manager','recruitment_staff')) then
   raise exception 'Choose an active recruitment staff member' using errcode='22023';
 end if;
 if p_action='next_action' and v_action is null and p_due is not null then
   raise exception 'Due date requires a next action' using errcode='22023';
 end if;
 if p_action='status_update' and (p_status is null or p_status not in
     ('new','reviewing','contacted','accepted','not_selected','withdrawn')) then
   raise exception 'Invalid lead status; conversion uses a separate controlled action' using errcode='22023';
 end if;
 if p_action like 'handover_%' and before_row.pathway not in ('coach','professional_networks') then
   raise exception 'Only Coach and Professional Networks leads can be handed over' using errcode='22023';
 end if;
 if p_action='handover_approve' and before_row.handover_state not in ('pending_review','clarification') then
   raise exception 'Lead is not pending VM handover review' using errcode='22023';
 end if;
 if p_action='handover_sent' and before_row.handover_state<>'approved' then
   raise exception 'VM approval is required before recording handover delivery' using errcode='22023';
 end if;
 if p_action='handover_acknowledge' and before_row.handover_state<>'sent' then
   raise exception 'Handover must be sent before it can be acknowledged' using errcode='22023';
 end if;
 if p_action='handover_clarification' and before_row.handover_state not in ('pending_review','approved','clarification') then
   raise exception 'Handover is not available for clarification' using errcode='22023';
 end if;
 if p_action='handover_decline' and before_row.handover_state not in ('pending_review','clarification','approved') then
   raise exception 'Handover cannot be declined at this stage' using errcode='22023';
 end if;
 update public.volunteer_leads set
   responsible_user_id=case when p_action='assign' then p_assignee else responsible_user_id end,
   next_action=case when p_action='next_action' then v_action else next_action end,
   next_action_due=case when p_action='next_action' then p_due else next_action_due end,
   status=case when p_action='status_update' then p_status
     when p_action='contacted' and status in ('new','reviewing') then 'contacted'
     else status end,
   handover_state=case p_action
     when 'handover_approve' then 'approved'
     when 'handover_sent' then 'sent'
     when 'handover_acknowledge' then 'acknowledged'
     when 'handover_clarification' then 'clarification'
     when 'handover_decline' then 'not_handed_over'
     else handover_state end,
   handover_approved_by=case when p_action='handover_approve' then auth.uid() else handover_approved_by end,
   handover_approved_at=case when p_action='handover_approve' then now() else handover_approved_at end
 where id=p_lead_id returning * into after_row;
 insert into public.volunteer_lead_activities
    (lead_id,actor_user_id,action,note,before_state,after_state)
 values (p_lead_id,auth.uid(),p_action,v_note,
   jsonb_build_object('status',before_row.status,'owner',before_row.responsible_user_id,
     'next_action',before_row.next_action,'next_action_due',before_row.next_action_due,
     'handover_state',before_row.handover_state),
   jsonb_build_object('status',after_row.status,'owner',after_row.responsible_user_id,
     'next_action',after_row.next_action,'next_action_due',after_row.next_action_due,
     'handover_state',after_row.handover_state));
 return after_row;
end;
$fn$;
revoke all on function public.maklom_lead_take_action(text,bigint,text,text,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.maklom_lead_take_action(text,bigint,text,text,uuid,text,timestamptz,text) to authenticated;
