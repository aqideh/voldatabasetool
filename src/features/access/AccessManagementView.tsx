import {useState} from 'react';
import {Badge,Button,Group,Paper,Select,Stack,Switch,Table,Text,TextInput,Title} from '@mantine/core';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '../../lib/supabase';
import type {MaklomRole} from '../../lib/maklom-access';

type Staff={user_id:string;email:string;role:MaklomRole;active:boolean;updated_at:string};
const roleOptions=[
 {value:'administrator',label:'MakLom Administrator'},
 {value:'data_steward',label:'Data Steward'},
 {value:'operations_officer',label:'Operations Officer'},
 {value:'reporting_analyst',label:'Reporting Analyst'},
 {value:'viewer',label:'Viewer'}
];
export function AccessManagementView(){
 const qc=useQueryClient();
 const [email,setEmail]=useState('');
 const [role,setRole]=useState<string>('operations_officer');
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
   <div><Title order={2}>Access Management</Title><Text c="dimmed" size="sm">MakLom permissions are independent of Keluarga roles. Only Superadmin can change them.</Text></div>
   <Paper withBorder p="lg" radius="lg"><Stack>
     <Title order={4}>Grant access to an existing MENDAKI account</Title>
     <TextInput label="Staff email" placeholder="colleague@mendaki.org.sg" value={email} onChange={e=>setEmail(e.currentTarget.value)} />
     <Select label="MakLom role" data={roleOptions} value={role} onChange={value=>setRole(value||'operations_officer')}/>
     <Switch label="Active access" checked={active} onChange={e=>setActive(e.currentTarget.checked)}/>
     <Button loading={change.isPending} disabled={!email.trim()} onClick={()=>apply({email:email.trim(),role,active})}>Review and grant access</Button>
   </Stack></Paper>
   {error&&<Text c="red" size="sm">{error}</Text>}
   {roster.error&&<Text c="red">{(roster.error as Error).message}</Text>}
   <Paper withBorder p="md" radius="lg"><Title order={4} mb="sm">Staff accounts</Title>
     {roster.isLoading?<Text>Loading staff…</Text>:
     <Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Account</Table.Th><Table.Th>Role</Table.Th><Table.Th>Status</Table.Th><Table.Th>Action</Table.Th></Table.Tr></Table.Thead>
       <Table.Tbody>{(roster.data||[]).map(person=><StaffRow key={person.user_id} person={person} disabled={change.isPending} onSave={apply}/>)}</Table.Tbody>
     </Table>}
   </Paper>
 </Stack>;
}
function StaffRow({person,disabled,onSave}:{person:Staff;disabled:boolean;onSave:(v:{email:string;role:string;active:boolean})=>void}){
 const [role,setRole]=useState(person.role);
 const [active,setActive]=useState(person.active);
 const locked=person.role==='superadmin';
 return <Table.Tr><Table.Td><Text size="sm">{person.email}</Text></Table.Td>
   <Table.Td>{locked?<Badge>Superadmin</Badge>:<Select size="xs" w={200} data={roleOptions} value={role} onChange={v=>setRole(v as MaklomRole)}/>}</Table.Td>
   <Table.Td>{locked?<Badge color="green">Active</Badge>:<Switch checked={active} onChange={e=>setActive(e.currentTarget.checked)}/>}</Table.Td>
   <Table.Td><Group><Button size="xs" variant="light" disabled={locked||disabled||(role===person.role&&active===person.active)} onClick={()=>onSave({email:person.email,role,active})}>Save</Button></Group></Table.Td>
 </Table.Tr>;
}
