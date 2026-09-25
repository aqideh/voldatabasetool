import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Group, Modal, NumberInput, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchContributionAudit, fetchContributionReviews, reviewContribution } from './api';
import type { ContributionFilters, ContributionReviewRow, ContributionStatus } from '../../lib/types';
import { minutesLabel, safeDateTime } from '../../lib/utils';

const PAGE_SIZE=75;

export function ContributionReviewView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();
  const[search,setSearch]=useState('');const[debounced]=useDebouncedValue(search,250);
  const[status,setStatus]=useState<ContributionFilters['status']>('pending');const[page,setPage]=useState(0);
  const[selected,setSelected]=useState<ContributionReviewRow|null>(null);const[opened,{open,close}]=useDisclosure(false);
  const filters=useMemo<ContributionFilters>(()=>({search:debounced,status,page,pageSize:PAGE_SIZE}),[debounced,status,page]);
  const rows=useQuery({queryKey:['contribution-reviews',filters],queryFn:()=>fetchContributionReviews(filters),placeholderData:keepPreviousData});
  const totalPages=Math.max(1,Math.ceil((rows.data?.count||0)/PAGE_SIZE));

  function openRow(row:ContributionReviewRow){setSelected(row);open();}
  async function refresh(){await Promise.all([
    qc.invalidateQueries({queryKey:['contribution-reviews']}),
    qc.invalidateQueries({queryKey:['dashboard-summary']}),
  ]);}

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Contribution Review</Title>
        <Text c="dimmed" size="sm">Review KELUARGA operational attendance before it becomes approved volunteer hours.</Text>
      </div>
      <Badge size="lg" variant="light">{(rows.data?.count||0).toLocaleString()} records</Badge>
    </Group>

    <Paper withBorder radius="lg" p="md">
      <Group grow align="flex-end" wrap="wrap">
        <TextInput label="Search" placeholder="Volunteer, KEL ID, email or event" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);setPage(0);}}/>
        <Select label="Status" value={status} data={[
          {value:'pending',label:'Pending review'},
          {value:'needs_review',label:'Needs re-review'},
          {value:'approved',label:'Approved'},
          {value:'rejected',label:'Rejected'},
          {value:'all',label:'All records'},
        ]} onChange={(v)=>{setStatus((v||'pending') as ContributionFilters['status']);setPage(0);}}/>
      </Group>
    </Paper>

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={1000}>
          <Table.Thead><Table.Tr>
            <Table.Th>Volunteer</Table.Th><Table.Th>Event</Table.Th><Table.Th>Occurred</Table.Th>
            <Table.Th>Operational</Table.Th><Table.Th>Approved</Table.Th><Table.Th>Status</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{(rows.data?.rows||[]).map((row)=><Table.Tr key={row.id} onClick={()=>openRow(row)} style={{cursor:'pointer'}}>
            <Table.Td><Text fw={700}>{row.volunteer_name||'Unknown volunteer'}</Text><Text size="xs" c="dimmed">{row.volunteer_code||row.volunteer_email||row.volunteer_phone||'-'}</Text></Table.Td>
            <Table.Td>{row.event_title||'Untitled event'}</Table.Td>
            <Table.Td>{safeDateTime(row.occurred_at)}</Table.Td>
            <Table.Td>{minutesLabel(row.operational_minutes)}</Table.Td>
            <Table.Td>{row.approved_minutes==null?'—':minutesLabel(row.approved_minutes)}</Table.Td>
            <Table.Td><Badge color={row.status==='approved'?'green':row.status==='rejected'?'red':row.status==='needs_review'?'orange':'blue'} variant="light">{row.status.replace('_',' ')}</Badge></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!rows.isLoading&&!rows.data?.rows.length&&<Text c="dimmed" ta="center" p="xl">No contribution records match this view.</Text>}
    </Paper>

    <Group justify="space-between"><Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(v)=>setPage(v-1)}/></Group>

    <Modal opened={opened} onClose={close} title={selected?.volunteer_name||'Contribution review'} size="lg">
      {selected&&<ContributionEditor row={selected} canWrite={canWrite} onSaved={()=>{close();void refresh();}}/>}
    </Modal>
  </Stack>;
}

function ContributionEditor({row,canWrite,onSaved}:{row:ContributionReviewRow;canWrite:boolean;onSaved:()=>void}){
  const[approvedMinutes,setApprovedMinutes]=useState<number|null>(row.approved_minutes??row.operational_minutes);
  const[note,setNote]=useState(row.approval_note||'');const[saving,setSaving]=useState(false);const[message,setMessage]=useState<string|null>(null);
  const audit=useQuery({queryKey:['contribution-audit',row.id],queryFn:()=>fetchContributionAudit(row.id)});

  async function act(status:ContributionStatus){
    setSaving(true);setMessage(null);
    try{
      if(status==='approved'&&(approvedMinutes==null||approvedMinutes<0))throw new Error('Approved minutes are required.');
      await reviewContribution(row,{status,approvedMinutes:status==='approved'?approvedMinutes:null,note:note.trim()||null});
      onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update contribution.');}
    finally{setSaving(false);}
  }

  return <Stack>
    {message&&<Alert color="red">{message}</Alert>}
    <Paper withBorder radius="md" p="md">
      <Text fw={700}>{row.event_title||'Untitled event'}</Text>
      <Text size="sm" c="dimmed">{safeDateTime(row.occurred_at)}</Text>
      <Group mt="md">
        <div><Text size="xs" c="dimmed">Operational duration</Text><Text fw={700}>{minutesLabel(row.operational_minutes)}</Text></div>
        <div><Text size="xs" c="dimmed">Current status</Text><Text fw={700}>{row.status.replace('_',' ')}</Text></div>
      </Group>
    </Paper>

    <NumberInput label="Approved minutes" min={0} value={approvedMinutes??''} onChange={(v)=>setApprovedMinutes(typeof v==='number'?v:null)} disabled={!canWrite}/>
    <Textarea label="Review note" minRows={3} value={note} onChange={(e)=>setNote(e.currentTarget.value)} disabled={!canWrite} placeholder="Reason for adjustment, rejection, or other review note"/>

    {canWrite&&<Group justify="flex-end">
      <Button variant="light" color="red" loading={saving} onClick={()=>void act('rejected')}>Reject</Button>
      <Button variant="light" color="orange" loading={saving} onClick={()=>void act('needs_review')}>Needs review</Button>
      <Button loading={saving} onClick={()=>void act('approved')}>Approve</Button>
    </Group>}

    <div>
      <Title order={5}>Audit history</Title>
      <Stack gap="xs" mt="sm">
        {(audit.data||[]).map((item)=><Paper key={item.id} withBorder radius="md" p="sm">
          <Group justify="space-between"><Text size="sm" fw={600}>{item.old_status||'created'} → {item.new_status}</Text><Text size="xs" c="dimmed">{safeDateTime(item.changed_at)}</Text></Group>
          <Text size="xs" c="dimmed">Approved minutes: {item.old_approved_minutes??'—'} → {item.new_approved_minutes??'—'}</Text>
        </Paper>)}
        {!audit.isLoading&&!audit.data?.length&&<Text size="sm" c="dimmed">No audit entries yet.</Text>}
      </Stack>
    </div>
  </Stack>;
}
