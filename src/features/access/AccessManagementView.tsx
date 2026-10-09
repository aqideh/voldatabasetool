import {useState} from 'react';
import {Badge,Button,Group,Paper,Select,Stack,Switch,Table,Text,TextInput,Title} from '@mantine/core';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '../../lib/supabase';
import type {MaklomRole} from '../../lib/maklom-access';

type Staff={user_id:string;email:string;role:MaklomRole;active:boolean;updated_at:string};
const roleOptions=[
 {value:'platform_admin',label:'Platform Admin'},
 {value:'volunteer_manager',label:'Volunteer Manager'},
 {value:'data_steward',label:'Data Steward'},
 {value:'operations_staff',label:'Operations Staff'},
 {value:'reporting_viewer',label:'Reporting Viewer'}
];
export function AccessManagementView({isSuperadmin}:{isSuperadmin:boolean}){
 const qc=useQueryClient();
 const availableRoles=isSuperadmin?roleOptions:roleOptions.filter(r=>r.value!=='platform_admin');
 const [email,setEmail]=useState('');
 const [role,setRole]=useState<string>('volunteer_manager');
 const [active,setActive]=useState(true);
 const [error,setError]=useState('');
 const roster=useQuery({queryKey:['maklom-staff-access'],queryFn:async()=>{
   const {data,error}=await supabase.rpc('maklom_list_staff_access');
   if(error)throw error;
   return (data||[]) as Staff[];
 }});
 const change=useMutation({mutationFn:async(v:{email:string;role:string;active:boolean})=>{
   const {error}=await supabase.rpc('maklom_set_staff_access',{p_email:v.email,p_role:v.role,p_active:v.active});
   if(error)throw error;
 },onSuccess:()=>{setError('');setEmail('');void qc.invalidateQueries({queryKey:['maklom-staff-access']});},onError:(err:Error)=>setError(err.message)});
 function apply(v:{email:string;role:string;active:boolean}){
   const verb=v.active?'grant or update':'suspend';
   if(!window.confirm('Confirm '+verb+' MakLom access for '+v.email+' as '+v.role+'?'))return;
   change.mutate(v);
 }
 return <Stack gap="md">
   <div><Title order={2}>Access Management</Title><Text c="dimmed" size="sm">MakLom permissions are independent of Keluarga roles. Superadmin controls platform privileges. Platform Admin can manage subordinate roles.</Text></div>
   <Paper withBorder p="lg" radius="lg"><Stack>
     <Title order={4}>Grant access to an existing MENDAKI account</Title>
     <TextInput label="Staff email" placeholder="colleague@mendaki.org.sg" value={email} onChange={e=>setEmail(e.currentTarget.value)} />
     <Select label="MakLom role" data={availableRoles} value={role} onChange={value=>setRole(value||'volunteer_manager')}/>
     <Switch label="Active access" checked={active} onChange={e=>setActive(e.currentTarget.checked)}/>
     <Button loading={change.isPending} disabled={!email.trim()} onClick={()=>apply({email:email.trim(),role,active})}>Review and grant access</Button>
   </Stack></Paper>
   {isSuperadmin&&<EventAssignments staff={(roster.data||[]).filter(person=>person.active&&person.role==='operations_staff')}/>}
   {error&&<Text c="red" size="sm">{error}</Text>}
   {roster.error&&<Text c="red">{(roster.error as Error).message}</Text>}
   <Paper withBorder p="md" radius="lg"><Title order={4} mb="sm">Staff accounts</Title>
     {roster.isLoading?<Text>Loading staff…</Text>:
     <Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Account</Table.Th><Table.Th>Role</Table.Th><Table.Th>Status</Table.Th><Table.Th>Action</Table.Th></Table.Tr></Table.Thead>
       <Table.Tbody>{(roster.data||[]).map(person=><StaffRow key={person.user_id} person={person} disabled={change.isPending} isSuperadmin={isSuperadmin} onSave={apply}/>)}</Table.Tbody>
     </Table>}
   </Paper>
 </Stack>;
}
function StaffRow({person,disabled,isSuperadmin,onSave}:{person:Staff;disabled:boolean;isSuperadmin:boolean;onSave:(v:{email:string;role:string;active:boolean})=>void}){
 const [role,setRole]=useState(person.role);
 const [active,setActive]=useState(person.active);
 const locked=person.role==='superadmin'||(!isSuperadmin&&person.role==='platform_admin');
 return <Table.Tr><Table.Td><Text size="sm">{person.email}</Text></Table.Td>
   <Table.Td>{locked?<Badge>Superadmin</Badge>:<Select size="xs" w={200} data={isSuperadmin?roleOptions:roleOptions.filter(r=>r.value!=='platform_admin')} value={role} onChange={v=>setRole(v as MaklomRole)}/>}</Table.Td>
   <Table.Td>{locked?<Badge color="green">Active</Badge>:<Switch checked={active} onChange={e=>setActive(e.currentTarget.checked)}/>}</Table.Td>
   <Table.Td><Group><Button size="xs" variant="light" disabled={locked||disabled||(role===person.role&&active===person.active)} onClick={()=>onSave({email:person.email,role,active})}>Save</Button></Group></Table.Td>
 </Table.Tr>;
}

type AssignedEvent={id:string;title:string;reporting_at:string};
type Assignment={event_id:string;user_id:string};
function EventAssignments({staff}:{staff:Staff[]}){
 const qc=useQueryClient();
 const [selectedStaff,setSelectedStaff]=useState<string|null>(null);
 const [selectedEvent,setSelectedEvent]=useState<string|null>(null);
 const events=useQuery({queryKey:['maklom-assignable-events'],queryFn:async()=>{
  const {data,error}=await supabase.rpc('maklom_assignable_events');
  if(error)throw error;return (data||[]) as AssignedEvent[];
 }});
 const assignments=useQuery({queryKey:['maklom-event-staff-assignments'],queryFn:async()=>{
  const {data,error}=await supabase.from('maklom_event_staff_assignments').select('event_id,user_id');
  if(error)throw error;return (data||[]) as Assignment[];
 }});
 const mutation=useMutation({mutationFn:async({userId,eventId,assign}:{userId:string;eventId:string;assign:boolean})=>{
  const {error}=await supabase.rpc('maklom_assign_event_staff',{p_user_id:userId,p_event_id:eventId,p_assign:assign});
  if(error)throw error;
 },onSuccess:()=>{void qc.invalidateQueries({queryKey:['maklom-event-staff-assignments']});}});
 return <Paper withBorder p="lg" radius="lg"><Stack>
  <Title order={4}>Operations Staff event assignments</Title>
  <Text c="dimmed" size="sm">Grant access to individual events only. Revoking an assignment immediately removes the staff member's ability to retrieve that roster.</Text>
  <Select label="Operations Staff" searchable data={staff.map(s=>({value:s.user_id,label:s.email}))} value={selectedStaff} onChange={setSelectedStaff} placeholder="Choose staff member"/>
  <Select label="Event" searchable data={(events.data||[]).map(e=>({value:e.id,label:e.title+' · '+new Date(e.reporting_at).toLocaleDateString('en-SG')}))} value={selectedEvent} onChange={setSelectedEvent} placeholder="Choose event"/>
  <Button disabled={!selectedStaff||!selectedEvent||mutation.isPending} loading={mutation.isPending} onClick={()=>{
   if(selectedStaff&&selectedEvent&&window.confirm('Assign this event to selected Operations Staff?'))mutation.mutate({userId:selectedStaff,eventId:selectedEvent,assign:true});
  }}>Assign event</Button>
  {mutation.error&&<Text c="red">{(mutation.error as Error).message}</Text>}
  {assignments.error&&<Text c="red">{(assignments.error as Error).message}</Text>}
  {staff.length===0&&<Text size="sm">Grant the Operations Staff role to a colleague before assigning an event.</Text>}
  {selectedStaff&&(assignments.data||[]).filter(a=>a.user_id===selectedStaff).map(a=><Group key={a.event_id} justify="space-between">
   <Text size="sm">{events.data?.find(e=>e.id===a.event_id)?.title||a.event_id}</Text>
   <Button size="xs" color="red" variant="subtle" disabled={mutation.isPending} onClick={()=>{
    if(window.confirm('Revoke this event assignment?'))mutation.mutate({userId:selectedStaff,eventId:a.event_id,assign:false});
   }}>Revoke</Button>
  </Group>)}
 </Stack></Paper>;
}
