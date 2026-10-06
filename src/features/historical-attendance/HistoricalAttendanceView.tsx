import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, FileButton, Group, Modal, NumberInput, Pagination, Paper,
  ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { HistoricalAttendanceImportRow } from '../../lib/types';
import { safeDateTime } from '../../lib/utils';
import {
  approveAllSafeHistoricalRows,
  commitHistoricalBatch,
  fetchHistoricalAttendance,
  fetchHistoricalContext,
  stageHistoricalWorkbook,
  updateHistoricalRow,
} from './api';

const PAGE_SIZE=50;

function statusColor(status:string) {
  if(status==='matched')return 'green';
  if(status==='duplicate')return 'gray';
  if(status==='invalid')return 'red';
  return 'orange';
}

function decisionColor(decision:string) {
  if(decision==='approved')return 'green';
  if(decision==='rejected')return 'red';
  return 'gray';
}

export function HistoricalAttendanceView({canWrite}:{canWrite:boolean}) {
  const qc=useQueryClient();
  const [batchId,setBatchId]=useState<string|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<string>('all');
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<HistoricalAttendanceImportRow|null>(null);
  const [opened,{open,close}]=useDisclosure(false);

  const data=useQuery({
    queryKey:['historical-attendance',batchId],
    queryFn:()=>fetchHistoricalAttendance(batchId),
  });
  const context=useQuery({queryKey:['historical-attendance-context'],queryFn:fetchHistoricalContext});

  const activeBatchId=batchId||data.data?.selected||null;
  const activeBatch=data.data?.batches.find((b)=>b.id===activeBatchId);
  const rows=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (data.data?.rows||[]).filter((row)=>{
      const filterMatch=filter==='all'||row.match_status===filter||row.decision===filter;
      const searchMatch=!q||[
        row.full_name,row.email,row.phone,row.event_name,row.event_date,row.match_reason,
        row.review_flags.join(' '),
      ].join(' ').toLowerCase().includes(q);
      return filterMatch&&searchMatch;
    });
  },[data.data,filter,search]);

  const pageCount=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const visible=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const safePending=(data.data?.rows||[]).filter((row)=>row.match_status==='matched'&&row.decision==='pending').length;
  const approved=(data.data?.rows||[]).filter((row)=>row.decision==='approved').length;
  const pendingReview=(data.data?.rows||[]).filter((row)=>row.decision==='pending'&&row.match_status!=='matched').length;

  async function refresh(){
    await Promise.all([
      qc.invalidateQueries({queryKey:['historical-attendance']}),
      qc.invalidateQueries({queryKey:['attendance']}),
      qc.invalidateQueries({queryKey:['dashboard-summary']}),
      qc.invalidateQueries({queryKey:['volunteer-intelligence']}),
    ]);
  }

  async function stage(){
    if(!file||!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      const result=await stageHistoricalWorkbook(file);
      setBatchId(result.batchId);setPage(1);
      setMessage({
        kind:'success',
        text:result.duplicateFile
          ? 'This exact workbook was staged previously. The existing review batch has been opened.'
          : 'Staged '+result.preview.rows.length+' sign-in rows. '+result.preview.summary.matched+' matched safely, '+result.preview.summary.review+' need review, '+result.preview.summary.duplicate+' duplicates were rejected, and '+result.preview.summary.withFeedback+' include feedback evidence.',
      });
      setFile(null);
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Workbook staging failed.'});
    }finally{setBusy(false);}
  }

  async function approveSafe(){
    if(!activeBatchId||!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      await approveAllSafeHistoricalRows(activeBatchId);
      setMessage({kind:'success',text:'All currently safe rows were approved. Rows already rejected or still requiring review were left unchanged.'});
      await refresh();
    }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Bulk approval failed.'});}
    finally{setBusy(false);}
  }

  async function commit(){
    if(!activeBatchId||!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      const result=await commitHistoricalBatch(activeBatchId);
      setMessage({
        kind:'success',
        text:'Committed '+result.inserted+' attendance rows. '+result.duplicates+' duplicate(s) were linked instead of re-created. '+result.pending+' row(s) remain pending review.',
      });
      await refresh();
    }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Attendance commit failed.'});}
    finally{setBusy(false);}
  }

  return <Stack gap="md">
    <div>
      <Title order={2}>Historical Attendance</Title>
      <Text c="dimmed" size="sm">
        Stage historical XLSX form exports, reconcile them against existing MakLom volunteers and events, review uncertain rows, then commit approved attendance with source provenance.
      </Text>
    </div>

    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}

    <Paper withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>Stage workbook</Text>
            <Text size="sm" c="dimmed">
              Uploading only creates review rows. It never creates volunteers and does not change attendance until you commit approved rows.
            </Text>
          </div>
          <Badge variant="light">XLSX</Badge>
        </Group>
        <Group align="center">
          <FileButton accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={setFile}>
            {(props)=><Button {...props} variant="default">Choose workbook</Button>}
          </FileButton>
          <Text size="sm" c="dimmed">{file?.name||'No workbook selected'}</Text>
          {canWrite&&<Button ml="auto" loading={busy} disabled={!file} onClick={()=>void stage()}>Stage for review</Button>}
        </Group>
      </Stack>
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <SimpleGrid cols={{base:1,md:4}}>
        <Select
          label="Import batch"
          searchable
          clearable={false}
          data={(data.data?.batches||[]).map((batch)=>({
            value:batch.id,
            label:batch.source_filename+' · '+batch.status+' · '+new Date(batch.created_at).toLocaleDateString('en-SG'),
          }))}
          value={activeBatchId}
          onChange={(value)=>{setBatchId(value);setPage(1);}}
          placeholder="No staged imports"
        />
        <TextInput
          label="Search rows"
          placeholder="Volunteer, event, email or review flag"
          value={search}
          onChange={(event)=>{setSearch(event.currentTarget.value);setPage(1);}}
        />
        <Select
          label="Review state"
          value={filter}
          onChange={(value)=>{setFilter(value||'all');setPage(1);}}
          data={[
            {value:'all',label:'All rows'},{value:'matched',label:'Safely matched'},
            {value:'needs_review',label:'Needs review'},{value:'duplicate',label:'Duplicate'},
            {value:'invalid',label:'Invalid'},{value:'approved',label:'Approved'},
            {value:'rejected',label:'Rejected'},{value:'pending',label:'Pending decision'},
          ]}
        />
        <Stack gap={4} justify="flex-end">
          <Text size="xs" c="dimmed">Batch status</Text>
          <Group gap="xs">
            <Badge variant="light">{activeBatch?.status||'—'}</Badge>
            <Text size="sm">{activeBatch?.row_count??0} rows</Text>
          </Group>
        </Stack>
      </SimpleGrid>
    </Paper>

    {activeBatch&&<SimpleGrid cols={{base:2,md:4}}>
      <Paper withBorder radius="md" p="md"><Text size="xs" c="dimmed">Safe & pending</Text><Text fw={800} fz="xl">{safePending}</Text></Paper>
      <Paper withBorder radius="md" p="md"><Text size="xs" c="dimmed">Needs review</Text><Text fw={800} fz="xl">{pendingReview}</Text></Paper>
      <Paper withBorder radius="md" p="md"><Text size="xs" c="dimmed">Approved</Text><Text fw={800} fz="xl">{approved}</Text></Paper>
      <Paper withBorder radius="md" p="md"><Text size="xs" c="dimmed">Already committed</Text><Text fw={800} fz="xl">{activeBatch.imported_count}</Text></Paper>
    </SimpleGrid>}

    {activeBatch&&canWrite&&<Paper withBorder radius="lg" p="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Bulk approval only affects rows that are already safely matched. Manual rejections and unresolved rows are not changed.
        </Text>
        <Group>
          <Button variant="light" disabled={!safePending} loading={busy} onClick={()=>void approveSafe()}>Approve all safe rows</Button>
          <Button disabled={!approved} loading={busy} onClick={()=>void commit()}>Commit approved attendance</Button>
        </Group>
      </Group>
    </Paper>}

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={1200}>
          <Table.Thead><Table.Tr>
            <Table.Th>Source</Table.Th><Table.Th>Volunteer</Table.Th><Table.Th>Source event</Table.Th>
            <Table.Th>Date / time</Table.Th><Table.Th>Match</Table.Th><Table.Th>Decision</Table.Th><Table.Th>Feedback</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{visible.map((row)=><Table.Tr
            key={row.id}
            onClick={()=>{setSelected(row);open();}}
            style={{cursor:'pointer'}}
          >
            <Table.Td><Text size="sm">Row {row.source_row_number}</Text><Text size="xs" c="dimmed">{row.source_volunteer_identifier||'No response ID'}</Text></Table.Td>
            <Table.Td><Text fw={700} size="sm">{row.full_name}</Text><Text size="xs" c="dimmed">{row.email||row.phone||'No identifier'}</Text></Table.Td>
            <Table.Td><Text size="sm">{row.event_name}</Text><Text size="xs" c="dimmed">{row.matched_event_id?'Canonical event linked':'No canonical event'}</Text></Table.Td>
            <Table.Td><Text size="sm">{row.event_date}</Text><Text size="xs" c="dimmed">{safeDateTime(row.source_sign_in_at)}</Text></Table.Td>
            <Table.Td>
              <Badge color={statusColor(row.match_status)} variant="light">{row.match_status.replaceAll('_',' ')}</Badge>
              {row.review_flags.length>0&&<Text size="xs" c="dimmed" mt={4}>{row.review_flags.slice(0,2).map((x)=>x.replaceAll('_',' ')).join(' · ')}{row.review_flags.length>2?' …':''}</Text>}
            </Table.Td>
            <Table.Td><Badge color={decisionColor(row.decision)} variant="light">{row.decision}</Badge></Table.Td>
            <Table.Td><Badge variant="light" color={Object.keys(row.feedback_payload||{}).length?'blue':'gray'}>{Object.keys(row.feedback_payload||{}).length?'Attached':'None'}</Badge></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!data.isLoading&&!visible.length&&<Text c="dimmed" ta="center" p="xl">No historical attendance rows match these filters.</Text>}
      {data.isError&&<Alert color="red" m="md">Historical attendance could not be loaded.</Alert>}
    </Paper>

    {rows.length>0&&<Group justify="space-between">
      <Text size="sm" c="dimmed">{rows.length} matching rows</Text>
      <Pagination total={pageCount} value={Math.min(page,pageCount)} onChange={setPage}/>
    </Group>}

    <Modal opened={opened} onClose={close} title={selected?'Review source row '+selected.source_row_number:'Review attendance'} size="xl">
      {selected&&context.data&&<HistoricalRowEditor
        key={selected.id+':'+selected.row_version}
        row={selected}
        volunteers={context.data.volunteers}
        events={context.data.events}
        shifts={context.data.shifts}
        canWrite={canWrite}
        onSaved={async(updated:HistoricalAttendanceImportRow)=>{setSelected(updated);await refresh();}}
      />}
    </Modal>
  </Stack>;
}

function HistoricalRowEditor({row,volunteers,events,shifts,canWrite,onSaved}:any) {
  const [volunteerId,setVolunteerId]=useState<string|null>(row.matched_volunteer_id);
  const [eventId,setEventId]=useState<string|null>(row.matched_event_id);
  const [shiftId,setShiftId]=useState<string|null>(row.matched_shift_id);
  const [minutes,setMinutes]=useState<number|string>(row.reported_minutes||0);
  const [note,setNote]=useState(row.decision_note||'');
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  const eventShifts=shifts.filter((shift:any)=>shift.event_id===eventId&&shift.shift_date===row.event_date);
  const selectedVolunteer=volunteers.find((volunteer:any)=>volunteer.id===volunteerId);
  const selectedEvent=events.find((event:any)=>event.id===eventId);

  async function save(decision?:'approved'|'rejected'|'pending'){
    setSaving(true);setMessage(null);
    try{
      const safe=Boolean(selectedVolunteer&&selectedEvent);
      const nextDecision=decision??row.decision;
      if(nextDecision==='approved'&&!safe)throw new Error('Select an existing MakLom volunteer and a canonical event before approving this row.');
      const updated=await updateHistoricalRow(row,{
        matched_volunteer_id:selectedVolunteer?.id??null,
        matched_core_volunteer_id:selectedVolunteer?.core_volunteer_id??null,
        matched_event_id:selectedEvent?.id??null,
        matched_shift_id:shiftId||null,
        reported_minutes:Math.max(0,Number(minutes)||0),
        match_status:nextDecision==='approved'?'matched':safe&&row.match_status!=='duplicate'&&row.match_status!=='invalid'?'matched':row.match_status,
        decision:nextDecision,
        decision_note:note.trim()||null,
        reviewed_at:nextDecision!=='pending'?new Date().toISOString():row.reviewed_at,
        match_reason:safe
          ? 'Staff-confirmed mapping to '+selectedVolunteer.name+' · '+selectedEvent.name
          : row.match_reason,
      });
      setMessage(nextDecision==='approved'?'Row approved.':nextDecision==='rejected'?'Row rejected.':'Mapping saved.');
      await onSaved(updated);
    }catch(error){setMessage(error instanceof Error?error.message:'Review update failed.');}
    finally{setSaving(false);}
  }

  return <Stack gap="md">
    {message&&<Alert>{message}</Alert>}
    <SimpleGrid cols={{base:1,md:2}}>
      <Paper withBorder radius="md" p="md">
        <Text fw={700}>Source evidence</Text>
        <Text size="sm" mt="xs"><b>Name:</b> {row.full_name}</Text>
        <Text size="sm"><b>Email:</b> {row.email||'—'}</Text>
        <Text size="sm"><b>Mobile:</b> {row.phone||'—'}</Text>
        <Text size="sm"><b>Event:</b> {row.event_name}</Text>
        <Text size="sm"><b>Canonical date:</b> {row.event_date}</Text>
        <Text size="sm"><b>Sign-in:</b> {safeDateTime(row.source_sign_in_at)}</Text>
        <Text size="sm"><b>Shirt evidence:</b> {row.shirt_quantity||0}{row.shirt_size?' · '+row.shirt_size:''}</Text>
      </Paper>
      <Paper withBorder radius="md" p="md">
        <Text fw={700}>Review flags</Text>
        <Group gap="xs" mt="xs">{row.review_flags.length
          ?row.review_flags.map((flag:string)=><Badge key={flag} color="orange" variant="light">{flag.replaceAll('_',' ')}</Badge>)
          :<Badge color="green">None</Badge>}</Group>
        <Text size="sm" c="dimmed" mt="md">{row.match_reason||'No automated match explanation.'}</Text>
      </Paper>
    </SimpleGrid>

    <Select
      label="Existing MakLom volunteer"
      searchable clearable disabled={!canWrite}
      value={volunteerId} onChange={setVolunteerId}
      data={volunteers.map((volunteer:any)=>({
        value:volunteer.id,label:volunteer.name+' · '+(volunteer.email||volunteer.phone||volunteer.id),
      }))}
      description="This importer cannot create volunteers. Unmatched people stay in review."
    />
    <Select
      label="Canonical event"
      searchable clearable disabled={!canWrite}
      value={eventId} onChange={(value)=>{setEventId(value);setShiftId(null);}}
      data={events.map((event:any)=>({
        value:event.id,label:event.name+' · '+event.start_date+(event.end_date!==event.start_date?'–'+event.end_date:''),
      }))}
    />
    <Select
      label="Canonical shift"
      searchable clearable disabled={!canWrite||!eventId}
      value={shiftId} onChange={setShiftId}
      data={eventShifts.map((shift:any)=>({
        value:shift.id,label:shift.name+' · '+shift.shift_date+' '+(shift.start_time||''),
      }))}
      description={eventShifts.length>1?'Choose the specific shift before approval when the event has multiple sessions.':'Optional when the event has no distinct shift.'}
    />
    <NumberInput
      label="Reviewed credited minutes"
      description="Defaults to zero. Do not infer hours from the feedback submission time."
      min={0} value={minutes} onChange={setMinutes} disabled={!canWrite}
    />
    <Textarea label="Review note" value={note} onChange={(event)=>setNote(event.currentTarget.value)} disabled={!canWrite}/>

    {Object.keys(row.feedback_payload||{}).length>0&&<Paper withBorder radius="md" p="md">
      <Text fw={700}>Attached feedback evidence</Text>
      <Text size="xs" c="dimmed" mt="xs">Submitted {safeDateTime(row.source_feedback_at)}</Text>
      <ScrollArea h={180} mt="sm">
        <Table verticalSpacing="xs">
          <Table.Tbody>{Object.entries(row.feedback_payload).filter(([,value])=>String(value??'').trim()).map(([key,value])=><Table.Tr key={key}>
            <Table.Td><Text size="xs" fw={600}>{key}</Text></Table.Td>
            <Table.Td><Text size="xs">{String(value)}</Text></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>}

    {canWrite&&<Group justify="flex-end">
      <Button variant="default" loading={saving} onClick={()=>void save('pending')}>Save mapping</Button>
      <Button color="red" variant="light" loading={saving} onClick={()=>void save('rejected')}>Reject row</Button>
      <Button loading={saving} disabled={!selectedVolunteer||!selectedEvent} onClick={()=>void save('approved')}>Confirm & approve</Button>
    </Group>}
  </Stack>;
}
