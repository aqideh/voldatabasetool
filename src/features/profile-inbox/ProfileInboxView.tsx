import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Divider, Group, Modal, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfileInbox, fetchVolunteerInboxHistory, reviewProfileInbox } from './api';
import type { ProfileInboxFilters, ProfileInboxRow } from '../../lib/types';
import { safeDateTime } from '../../lib/utils';
import { VolunteerResolver } from '../volunteer-resolution/VolunteerResolver';

const PAGE_SIZE=75;
function sourceSummary(row:ProfileInboxRow){
  const p=row.payload||{};
  if(row.source_kind==='insight')return [p.category&&String(p.category),p.value&&String(p.value),p.detail&&String(p.detail)].filter(Boolean).join(' — ');
  const positives=Array.isArray(p.positive_behaviors)?p.positive_behaviors.join(', '):'';
  const concerns=Array.isArray(p.concern_behaviors)?p.concern_behaviors.join(', '):'';
  return [p.rating?`Rating ${p.rating}/5`:'',positives&&`Positive: ${positives}`,concerns&&`Concerns: ${concerns}`,p.comment&&String(p.comment)].filter(Boolean).join(' · ');
}
function statusColor(status:string){return status==='accepted'?'green':status==='dismissed'?'gray':status==='needs_match'?'orange':status==='source_withdrawn'?'red':'blue';}

export function ProfileInboxView({canWrite}:{canWrite:boolean}){
  const[search,setSearch]=useState('');const[debounced]=useDebouncedValue(search,250);
  const[status,setStatus]=useState<ProfileInboxFilters['status']>('all');const[sourceKind,setSourceKind]=useState<ProfileInboxFilters['sourceKind']>('all');const[page,setPage]=useState(0);
  const[selected,setSelected]=useState<ProfileInboxRow|null>(null);const[opened,{open,close}]=useDisclosure(false);
  const filters=useMemo<ProfileInboxFilters>(()=>({search:debounced,status,sourceKind,page,pageSize:PAGE_SIZE}),[debounced,status,sourceKind,page]);
  const rows=useQuery({queryKey:['profile-inbox',filters],queryFn:()=>fetchProfileInbox(filters),placeholderData:keepPreviousData});
  const totalPages=Math.max(1,Math.ceil((rows.data?.count||0)/PAGE_SIZE));
  return <Stack gap="md">
    <Group justify="space-between" align="flex-end"><div><Title order={2}>Insights & Reviews</Title><Text c="dimmed" size="sm">Review event-sourced observations before they become part of longitudinal Volunteer Management history.</Text></div><Badge size="lg" variant="light">{(rows.data?.count||0).toLocaleString()} records</Badge></Group>
    <Paper withBorder radius="lg" p="md"><Group grow align="flex-end" wrap="wrap">
      <TextInput label="Search" placeholder="Volunteer, email, event or observation" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);setPage(0);}}/>
      <Select label="Status" value={status} data={[{value:'pending',label:'Pending'},{value:'needs_match',label:'Needs volunteer match'},{value:'accepted',label:'Accepted'},{value:'dismissed',label:'Dismissed'},{value:'source_withdrawn',label:'Source withdrawn'},{value:'all',label:'All'}]} onChange={(v)=>{setStatus((v||'pending') as ProfileInboxFilters['status']);setPage(0);}}/>
      <Select label="Source" value={sourceKind} data={[{value:'all',label:'Insights & reviews'},{value:'insight',label:'Insights only'},{value:'review',label:'Reviews only'}]} onChange={(v)=>{setSourceKind((v||'all') as ProfileInboxFilters['sourceKind']);setPage(0);}}/>
    </Group></Paper>
    {rows.isError&&<Alert color="red">Insights & reviews could not be loaded. {rows.error instanceof Error?rows.error.message:'Please refresh and try again.'}</Alert>}
    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><ScrollArea><Table striped highlightOnHover verticalSpacing="sm" miw={1100}>
      <Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th><Table.Th>Event</Table.Th><Table.Th>Source</Table.Th><Table.Th>Observation</Table.Th><Table.Th>Received</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(rows.data?.rows||[]).map((row)=><Table.Tr key={row.id} onClick={()=>{setSelected(row);open();}} style={{cursor:'pointer'}}>
        <Table.Td><Text fw={700}>{row.volunteer_name||'Unmatched volunteer'}</Text><Text size="xs" c="dimmed">{row.volunteer_email||row.source_person_key||'—'}</Text></Table.Td>
        <Table.Td><Text>{row.event_title||'Event'}</Text><Text size="xs" c="dimmed">{row.event_venue||''}</Text></Table.Td>
        <Table.Td><Badge variant="light">{row.source_kind}</Badge></Table.Td><Table.Td maw={420}><Text lineClamp={2}>{row.reviewed_title||row.title}</Text></Table.Td>
        <Table.Td>{safeDateTime(row.created_at)}</Table.Td><Table.Td><Badge color={statusColor(row.status)} variant="light">{row.status.replaceAll('_',' ')}</Badge></Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table></ScrollArea>{!rows.isLoading&&!rows.isError&&!rows.data?.rows.length&&<Text c="dimmed" ta="center" p="xl">No records match this view.</Text>}</Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(v)=>setPage(v-1)}/></Group>
    <Modal opened={opened} onClose={close} title={selected?.volunteer_name||'Insight / review'} size="xl">{selected&&<InboxEditor row={selected} canWrite={canWrite} onSaved={()=>{close();void rows.refetch();}}/>}</Modal>
  </Stack>;
}

function InboxEditor({row,canWrite,onSaved}:{row:ProfileInboxRow;canWrite:boolean;onSaved:()=>void}){
  const qc=useQueryClient();const[title,setTitle]=useState(row.reviewed_title||row.title);const[summary,setSummary]=useState(String(row.reviewed_payload?.summary||sourceSummary(row)));const[note,setNote]=useState(row.review_note||'');const[saving,setSaving]=useState(false);const[message,setMessage]=useState<string|null>(null);
  const history=useQuery({queryKey:['profile-inbox-history',row.volunteer_id],queryFn:()=>fetchVolunteerInboxHistory(row.volunteer_id as string),enabled:Boolean(row.volunteer_id)});
  async function act(status:'accepted'|'dismissed'){setSaving(true);setMessage(null);try{await reviewProfileInbox(row,{status,title,summary,note:note.trim()||null});await qc.invalidateQueries({queryKey:['profile-inbox-history',row.volunteer_id]});onSaved();}catch(error){setMessage(error instanceof Error?error.message:'Could not review record.');}finally{setSaving(false);}}
  function resolved(){
    void Promise.all([
      qc.invalidateQueries({queryKey:['profile-inbox']}),
      qc.invalidateQueries({queryKey:['attendance']}),
      qc.invalidateQueries({queryKey:['contribution-reviews']}),
      qc.invalidateQueries({queryKey:['volunteers']}),
      qc.invalidateQueries({queryKey:['dashboard-summary']}),
    ]);
    onSaved();
  }
  const editable=row.status==='pending'||row.status==='needs_match';
  return <Stack>
    {message&&<Alert color="red">{message}</Alert>}
    {row.status==='needs_match'&&<Alert color="orange">This source record is not linked to a canonical volunteer yet. Resolve the volunteer before accepting it.</Alert>}
    {row.status==='needs_match'&&canWrite&&<VolunteerResolver
      source={{kind:'inbox',sourceKind:row.source_kind,sourceRecordId:row.source_record_id}}
      initialName={row.volunteer_name}
      initialEmail={row.volunteer_email}
      initialPhone={row.volunteer_phone}
      onResolved={resolved}
    />}
    <Paper withBorder radius="md" p="md"><Group justify="space-between"><div><Text fw={700}>{row.event_title||'Event context unavailable'}</Text><Text size="sm" c="dimmed">{row.event_reporting_at?safeDateTime(row.event_reporting_at):''}{row.event_venue?` · ${row.event_venue}`:''}</Text></div><Badge variant="light">{row.source_kind}</Badge></Group><Divider my="sm"/><Text size="xs" c="dimmed">Original source</Text><Text fw={600}>{row.title}</Text><Text size="sm" mt="xs">{sourceSummary(row)||'No additional source detail.'}</Text></Paper>
    <TextInput label="Reviewed title" value={title} onChange={(e)=>setTitle(e.currentTarget.value)} disabled={!canWrite||!editable}/>
    <Textarea label="Reviewed interpretation" description="Staff-edited longitudinal interpretation. The original event source remains unchanged." minRows={4} value={summary} onChange={(e)=>setSummary(e.currentTarget.value)} disabled={!canWrite||!editable}/>
    <Textarea label="Review note" minRows={2} value={note} onChange={(e)=>setNote(e.currentTarget.value)} disabled={!canWrite||!editable}/>
    {canWrite&&editable&&<Group justify="flex-end"><Button variant="light" color="gray" loading={saving} onClick={()=>void act('dismissed')}>Dismiss</Button><Button loading={saving} disabled={!row.volunteer_id} onClick={()=>void act('accepted')}>Accept</Button></Group>}
    {!editable&&<Alert color="gray">This record is already {row.status.replaceAll('_',' ')}{row.reviewed_at?` as of ${safeDateTime(row.reviewed_at)}`:''}.</Alert>}
    <Divider/><Title order={5}>Longitudinal history</Title>
    {!row.volunteer_id?<Text size="sm" c="dimmed">History becomes available after this source is matched to a canonical volunteer.</Text>:<Stack gap="xs">{(history.data||[]).filter((item)=>item.id!==row.id).map((item)=><Paper key={item.id} withBorder radius="md" p="sm"><Group justify="space-between"><Text fw={600} size="sm">{item.reviewed_title||item.title}</Text><Badge size="sm" color={statusColor(item.status)} variant="light">{item.status.replaceAll('_',' ')}</Badge></Group><Text size="xs" c="dimmed">{item.event_title||'Event'} · {safeDateTime(item.created_at)}</Text><Text size="sm" mt={4} lineClamp={3}>{String(item.reviewed_payload?.summary||sourceSummary(item))}</Text></Paper>)}{!history.isLoading&&!history.data?.filter((item)=>item.id!==row.id).length&&<Text size="sm" c="dimmed">No earlier insight/review history for this volunteer.</Text>}</Stack>}
  </Stack>;
}
