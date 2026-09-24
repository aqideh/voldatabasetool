import { useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, Paper, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { exportMaklomWorkbook, fetchDuplicateCases, fetchFormImportBatches, importEventReportCsv, updateDuplicateDecision } from './api';

export function DataOperationsView({ canWrite }: { canWrite: boolean }) {
  const qc=useQueryClient();
  const [tab,setTab]=useState('imports');
  const [message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const duplicates=useQuery({queryKey:['duplicates'],queryFn:fetchDuplicateCases});
  const batches=useQuery({queryKey:['form-import-batches'],queryFn:fetchFormImportBatches});

  async function importReport(file:File|null){
    if(!file||!canWrite)return;setBusy(true);setMessage(null);
    try{const result=await importEventReportCsv(file);setMessage({kind:'success',text:`Imported ${result.events} event(s), ${result.shifts} shift(s), ${result.volunteers} new volunteer(s) and ${result.attendance} attendance row(s). ${result.skipped} existing/invalid row(s) were skipped.`});
      await Promise.all([qc.invalidateQueries({queryKey:['events-bundle']}),qc.invalidateQueries({queryKey:['attendance']}),qc.invalidateQueries({queryKey:['volunteers']}),qc.invalidateQueries({queryKey:['dashboard-summary']})]);
    }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not import event report.'});}finally{setBusy(false);}
  }

  return <Stack gap="md">
    <div><Title order={2}>Data Operations</Title><Text c="dimmed" size="sm">Imports, duplicate review, history and controlled exports.</Text></div>
    <SegmentedControl value={tab} onChange={setTab} data={[{label:'Imports',value:'imports'},{label:'Duplicates',value:'duplicates'},{label:'Export',value:'export'}]} />
    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}
    {tab==='imports'&&<Stack>
      <Paper withBorder radius="lg" p="lg">
        <Title order={4}>Keluarga event report</Title>
        <Text c="dimmed" size="sm" mb="md">Import the Event Operations CSV. Existing events, shifts, volunteers and attendance are matched before new records are created.</Text>
        {canWrite?<FileButton accept=".csv,text/csv" onChange={(file)=>void importReport(file)}>{(props)=><Button {...props} loading={busy}>Import event report CSV</Button>}</FileButton>:<Text size="sm">Read-only access.</Text>}
      </Paper>
      <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
        <Group justify="space-between" p="md"><Title order={4}>Form Attendance import history</Title><Badge variant="light">{batches.data?.length||0}</Badge></Group>
        <Table><Table.Thead><Table.Tr><Table.Th>Created</Table.Th><Table.Th>Files</Table.Th><Table.Th>Responses</Table.Th><Table.Th>Warnings</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(batches.data||[]).map((row)=><Table.Tr key={row.id}><Table.Td>{new Date(row.created_at).toLocaleString('en-SG')}</Table.Td><Table.Td>{[row.sign_in_filename,row.sign_out_filename].filter(Boolean).join(' + ')||'-'}</Table.Td><Table.Td>{row.sign_in_count+row.sign_out_count}</Table.Td><Table.Td>{row.warning_count}</Table.Td><Table.Td>{row.status}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        {!batches.data?.length&&<Text c="dimmed" p="lg">No Form Attendance imports have been committed yet.</Text>}
      </Paper>
    </Stack>}
    {tab==='duplicates'&&<Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <Table><Table.Thead><Table.Tr><Table.Th>Level</Table.Th><Table.Th>Existing volunteer</Table.Th><Table.Th>Incoming</Table.Th><Table.Th>Reason</Table.Th><Table.Th>Decision</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(duplicates.data||[]).map((row)=><Table.Tr key={row.id}><Table.Td><Badge color={row.level==='medium'?'orange':'gray'}>{row.level}</Badge></Table.Td><Table.Td>{row.existing_volunteer_id ? 'Existing database record' : '-'}</Table.Td><Table.Td><Text size="sm" maw={320} lineClamp={3}>{JSON.stringify(row.incoming)}</Text></Table.Td><Table.Td>{row.reason||'-'}</Table.Td><Table.Td>{canWrite?<Group gap="xs">{(['merge','add','dismiss'] as const).map((decision)=><Button key={decision} size="compact-xs" variant={row.decision===decision?'filled':'light'} onClick={()=>void updateDuplicateDecision(row,decision).then(()=>qc.invalidateQueries({queryKey:['duplicates']}))}>{decision}</Button>)}</Group>:row.decision}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
      {!duplicates.data?.length&&<Text c="dimmed" p="lg">No suspected duplicate cases.</Text>}
    </Paper>}
    {tab==='export'&&<Paper withBorder radius="lg" p="lg">
      <Title order={4}>Controlled workbook export</Title>
      <Text c="dimmed" size="sm" mb="md">Exports volunteers, attendance, events, shifts and volunteer leads into one Excel workbook. Treat the file as personal data.</Text>
      <Button onClick={()=>void exportMaklomWorkbook()}>Export MakLom workbook</Button>
    </Paper>}
  </Stack>;
}
