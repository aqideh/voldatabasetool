import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Group, Modal, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfileChangeReviews, reviewProfileChange } from './api';
import type { ProfileChangeFilters, ProfileChangeReviewRow } from '../../lib/types';
import { safeDateTime } from '../../lib/utils';

const PAGE_SIZE=75;

function fieldLabel(field:string){
  if(field==='mobile')return 'Mobile number';
  return field.replaceAll('_',' ');
}

function displayValue(value:string|null){
  return value?.trim()||'—';
}

export function ProfileChangeReviewView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();
  const[search,setSearch]=useState('');const[debounced]=useDebouncedValue(search,250);
  const[status,setStatus]=useState<ProfileChangeFilters['status']>('pending');const[page,setPage]=useState(0);
  const[selected,setSelected]=useState<ProfileChangeReviewRow|null>(null);const[opened,{open,close}]=useDisclosure(false);
  const filters=useMemo<ProfileChangeFilters>(()=>({search:debounced,status,page,pageSize:PAGE_SIZE}),[debounced,status,page]);
  const rows=useQuery({queryKey:['profile-change-reviews',filters],queryFn:()=>fetchProfileChangeReviews(filters),placeholderData:keepPreviousData});
  const totalPages=Math.max(1,Math.ceil((rows.data?.count||0)/PAGE_SIZE));

  function openRow(row:ProfileChangeReviewRow){setSelected(row);open();}
  async function refresh(){await Promise.all([
    qc.invalidateQueries({queryKey:['profile-change-reviews']}),
    qc.invalidateQueries({queryKey:['volunteers']}),
    qc.invalidateQueries({queryKey:['volunteer-filter-options']}),
    qc.invalidateQueries({queryKey:['dashboard-summary']}),
  ]);}

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Profile Change Review</Title>
        <Text c="dimmed" size="sm">Review KELUARGA self-service changes before applying them to MakLom&apos;s longitudinal volunteer record.</Text>
      </div>
      <Badge size="lg" variant="light">{(rows.data?.count||0).toLocaleString()} records</Badge>
    </Group>

    <Paper withBorder radius="lg" p="md">
      <Group grow align="flex-end" wrap="wrap">
        <TextInput label="Search" placeholder="Volunteer, KEL ID, email, old value or new value" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);setPage(0);}}/>
        <Select label="Status" value={status} data={[
          {value:'pending',label:'Pending review'},
          {value:'approved',label:'Approved'},
          {value:'rejected',label:'Rejected'},
          {value:'superseded',label:'Superseded'},
          {value:'all',label:'All records'},
        ]} onChange={(v)=>{setStatus((v||'pending') as ProfileChangeFilters['status']);setPage(0);}}/>
      </Group>
    </Paper>

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={1100}>
          <Table.Thead><Table.Tr>
            <Table.Th>Volunteer</Table.Th><Table.Th>Field</Table.Th><Table.Th>Previous</Table.Th>
            <Table.Th>Proposed</Table.Th><Table.Th>Submitted</Table.Th><Table.Th>Status</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{(rows.data?.rows||[]).map((row)=><Table.Tr key={row.id} onClick={()=>openRow(row)} style={{cursor:'pointer'}}>
            <Table.Td><Text fw={700}>{row.volunteer_name||'Unknown volunteer'}</Text><Text size="xs" c="dimmed">{row.volunteer_code||row.volunteer_email||'-'}</Text></Table.Td>
            <Table.Td>{fieldLabel(row.field_name)}</Table.Td>
            <Table.Td>{displayValue(row.old_value)}</Table.Td>
            <Table.Td><Text fw={600}>{displayValue(row.new_value)}</Text></Table.Td>
            <Table.Td>{safeDateTime(row.source_changed_at)}</Table.Td>
            <Table.Td><Badge color={row.status==='approved'?'green':row.status==='rejected'?'red':row.status==='superseded'?'gray':'blue'} variant="light">{row.status}</Badge></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!rows.isLoading&&!rows.data?.rows.length&&<Text c="dimmed" ta="center" p="xl">No profile changes match this view.</Text>}
    </Paper>

    <Group justify="space-between"><Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(v)=>setPage(v-1)}/></Group>

    <Modal opened={opened} onClose={close} title={selected?.volunteer_name||'Profile change review'} size="lg">
      {selected&&<ProfileChangeEditor row={selected} canWrite={canWrite} onSaved={()=>{close();void refresh();}}/>}
    </Modal>
  </Stack>;
}

function ProfileChangeEditor({row,canWrite,onSaved}:{row:ProfileChangeReviewRow;canWrite:boolean;onSaved:()=>void}){
  const[note,setNote]=useState(row.review_note||'');
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState<string|null>(null);
  const isPending=row.status==='pending';

  async function act(decision:'approved'|'rejected'){
    setSaving(true);setMessage(null);
    try{
      await reviewProfileChange(row,{decision,note:note.trim()||null});
      onSaved();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not review profile change.');
    }finally{setSaving(false);}
  }

  return <Stack>
    {message&&<Alert color="red">{message}</Alert>}
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed">Field</Text><Text fw={700}>{fieldLabel(row.field_name)}</Text>
      <Group mt="md" grow align="flex-start">
        <div><Text size="xs" c="dimmed">Previous KELUARGA value</Text><Text>{displayValue(row.old_value)}</Text></div>
        <div><Text size="xs" c="dimmed">Proposed value</Text><Text fw={700}>{displayValue(row.new_value)}</Text></div>
      </Group>
      <div style={{marginTop:16}}><Text size="xs" c="dimmed">Current MakLom value</Text><Text>{displayValue(row.current_maklom_value)}</Text></div>
      <Text size="xs" c="dimmed" mt="md">Submitted {safeDateTime(row.source_changed_at)}</Text>
    </Paper>

    <Textarea label="Review note" minRows={3} value={note} onChange={(e)=>setNote(e.currentTarget.value)} disabled={!canWrite||!isPending} placeholder="Optional rationale or follow-up note"/>

    {canWrite&&isPending&&<Group justify="flex-end">
      <Button variant="light" color="red" loading={saving} onClick={()=>void act('rejected')}>Reject</Button>
      <Button loading={saving} onClick={()=>void act('approved')}>Approve &amp; apply</Button>
    </Group>}

    {!isPending&&<Alert color="gray">This request is already {row.status}. {row.reviewed_at?'Reviewed '+safeDateTime(row.reviewed_at)+'.':''}</Alert>}
  </Stack>;
}
