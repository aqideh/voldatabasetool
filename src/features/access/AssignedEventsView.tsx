import {useState} from 'react';
import {Badge,Button,Group,Paper,Stack,Table,Text,Title} from '@mantine/core';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '../../lib/supabase';
type Event={event_id:string;title:string;reporting_at:string;venue:string|null;roster_count:number};
type Person={roster_id:string;volunteer_name:string;checked_in_at:string|null;checked_out_at:string|null};
export function AssignedEventsView(){
 const [selected,setSelected]=useState<string|null>(null);
 const events=useQuery({queryKey:['assigned-maklom-events'],queryFn:async()=>{
  const {data,error}=await supabase.rpc('maklom_my_assigned_events');
  if(error)throw error;
  return (data||[]) as Event[];
 }});
 const roster=useQuery({queryKey:['assigned-maklom-roster',selected],enabled:!!selected,queryFn:async()=>{
  const {data,error}=await supabase.rpc('maklom_my_event_roster',{p_event_id:selected});
  if(error)throw error;
  return (data||[]) as Person[];
 }});
 return <Stack gap="md">
  <div><Title order={2}>My assigned events</Title><Text c="dimmed" size="sm">Only events assigned to your MakLom Operations Staff account are shown. This workspace is read-only; attendance corrections require an authorised manager.</Text></div>
  {events.error&&<Text c="red">{(events.error as Error).message}</Text>}
  {events.isLoading&&<Text>Loading assignments…</Text>}
  {!events.isLoading&&!events.data?.length&&<Paper withBorder p="lg"><Text>No events assigned. Ask your MakLom Superadmin to assign an event.</Text></Paper>}
  {(events.data||[]).map(item=><Paper key={item.event_id} withBorder p="md"><Group justify="space-between" align="center">
    <Stack gap={2}><Text fw={700}>{item.title}</Text><Text size="sm" c="dimmed">{new Date(item.reporting_at).toLocaleDateString('en-SG')} · {item.venue||'Venue to be confirmed'} · {item.roster_count} roster records</Text></Stack>
    <Button variant={selected===item.event_id?'filled':'light'} onClick={()=>setSelected(selected===item.event_id?null:item.event_id)}>{selected===item.event_id?'Close roster':'View roster'}</Button>
   </Group></Paper>)}
  {selected&&<Paper withBorder p="md"><Title order={4} mb="sm">Assigned event roster</Title>
    {roster.error&&<Text c="red">{(roster.error as Error).message}</Text>}
    {roster.isLoading?<Text>Loading roster…</Text>:<Table striped><Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th><Table.Th>Attendance</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
    {(roster.data||[]).map(p=><Table.Tr key={p.roster_id}><Table.Td>{p.volunteer_name}</Table.Td><Table.Td><Badge color={p.checked_out_at?'green':p.checked_in_at?'blue':'gray'}>{p.checked_out_at?'Checked out':p.checked_in_at?'Checked in':'Not checked in'}</Badge></Table.Td></Table.Tr>)}
    </Table.Tbody></Table>}
  </Paper>}
 </Stack>;
}
