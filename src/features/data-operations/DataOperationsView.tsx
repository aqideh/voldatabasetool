import { useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commitHistoricalAttendance, exportMaklomWorkbook, fetchDuplicateCases, fetchFormImportBatches,
  fetchHistoricalAttendanceBatches, importEventReportCsv, previewHistoricalAttendance, updateDuplicateDecision,
} from './api';
import type { HistoricalAttendancePreviewRow } from '../../lib/types';
import { minutesLabel } from '../../lib/utils';

export function DataOperationsView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();const[tab,setTab]=useState('imports');const[message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);
  const[busy,setBusy]=useState(false);const[historicalFile,setHistoricalFile]=useState<File|null>(null);const[preview,setPreview]=useState<HistoricalAttendancePreviewRow[]>([]);
  const duplicates=useQuery({queryKey:['duplicates'],queryFn:fetchDuplicateCases});
  const batches=useQuery({queryKey:['form-import-batches'],queryFn:fetchFormImportBatches});
  const historicalBatches=useQuery({queryKey:['historical-attendance-batches'],queryFn:fetchHistoricalAttendanceBatches});

  async function importReport(file:File|null){if(!file||!canWrite)return;setBusy(true);setMessage(null);try{
    const result=await importEventReportCsv(file);setMessage({kind:'success',text:`Imported ${result.events} event(s), ${result.shifts} shift(s), ${result.volunteers} new volunteer(s) and ${result.attendance} attendance row(s). ${result.skipped} row(s) skipped.`});
    await Promise.all([qc.invalidateQueries({queryKey:['events-bundle']}),qc.invalidateQueries({queryKey:['attendance']}),qc.invalidateQueries({queryKey:['volunteers']}),qc.invalidateQueries({queryKey:['dashboard-summary']})]);
  }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not import event report.'});}finally{setBusy(false);}}

  async function previewHistorical(file:File|null){if(!file||!canWrite)return;setBusy(true);setMessage(null);try{
    const rows=await previewHistoricalAttendance(file);setHistoricalFile(file);setPreview(rows);
  }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not preview historical attendance.'});}finally{setBusy(false);}}

  async function confirmHistorical(){if(!historicalFile||!preview.length||!canWrite)return;setBusy(true);setMessage(null);try{
    const result=await commitHistoricalAttendance(historicalFile,preview);
    setMessage({kind:'success',text:`Historical import committed: ${result.imported} attendance row(s), ${result.created} new volunteer(s), ${result.review} row(s) need review, ${result.duplicate} duplicate(s) skipped.`});
    setHistoricalFile(null);setPreview([]);
    await Promise.all([
      qc.invalidateQueries({queryKey:['historical-attendance-batches']}),qc.invalidateQueries({queryKey:['attendance']}),
      qc.invalidateQueries({queryKey:['volunteers']}),qc.invalidateQueries({queryKey:['dashboard-summary']}),
    ]);
  }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not commit historical attendance.'});}finally{setBusy(false);}}

  const counts=preview.reduce((acc,row)=>{acc[row.matchStatus]=(acc[row.matchStatus]||0)+1;return acc;},{} as Record<string,number>);

  return <Stack gap="md">
    <div><Title order={2}>Data Operations</Title><Text c="dimmed" size="sm">Imports, duplicate review, history and controlled exports.</Text></div>
    <SegmentedControl value={tab} onChange={setTab} data={[{label:'Imports',value:'imports'},{label:'Historical Attendance',value:'historical'},{label:'Duplicates',value:'duplicates'},{label:'Export',value:'export'}]}/>
    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}

    {tab==='imports'&&<Stack>
      <Paper withBorder radius="lg" p="lg"><Title order={4}>Keluarga event report</Title><Text c="dimmed" size="sm" mb="md">Import the Event Operations CSV. Existing events, shifts, volunteers and attendance are matched before new records are created.</Text>
        {canWrite?<FileButton accept=".csv,text/csv" onChange={(file)=>void importReport(file)}>{(props)=><Button {...props} loading={busy}>Import event report CSV</Button>}</FileButton>:<Text size="sm">Read-only access.</Text>}
      </Paper>
      <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><Group justify="space-between" p="md"><Title order={4}>Form Attendance import history</Title><Badge variant="light">{batches.data?.length||0}</Badge></Group>
        <Table><Table.Thead><Table.Tr><Table.Th>Created</Table.Th><Table.Th>Files</Table.Th><Table.Th>Responses</Table.Th><Table.Th>Warnings</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(batches.data||[]).map((row)=><Table.Tr key={row.id}><Table.Td>{new Date(row.created_at).toLocaleString('en-SG')}</Table.Td><Table.Td>{[row.sign_in_filename,row.sign_out_filename].filter(Boolean).join(' + ')||'-'}</Table.Td><Table.Td>{row.sign_in_count+row.sign_out_count}</Table.Td><Table.Td>{row.warning_count}</Table.Td><Table.Td>{row.status}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Paper>
    </Stack>}

    {tab==='historical'&&<Stack>
      <Paper withBorder radius="lg" p="lg">
        <Title order={4}>Historical attendance import</Title>
        <Text c="dimmed" size="sm" mb="md">For volunteer records that pre-date KELUARGA. Upload Excel/CSV, preview identity matching, then confirm. Expected fields can use common names such as Name, Email, Phone, Event, Date, Hours/Minutes, Role and Attended.</Text>
        {canWrite?<FileButton accept=".xlsx,.xls,.csv,text/csv" onChange={(file)=>void previewHistorical(file)}>{(props)=><Button {...props} loading={busy}>Choose historical attendance file</Button>}</FileButton>:<Text size="sm">Read-only access.</Text>}
      </Paper>
      {preview.length>0&&<Paper withBorder radius="lg" p="lg">
        <Group justify="space-between"><div><Title order={4}>Preview: {historicalFile?.name}</Title><Text size="sm" c="dimmed">{preview.length} source row(s)</Text></div><Button loading={busy} onClick={()=>void confirmHistorical()}>Confirm import</Button></Group>
        <Group gap="xs" mt="md">{Object.entries(counts).map(([status,count])=><Badge key={status} variant="light">{status}: {count}</Badge>)}</Group>
        <ScrollArea mt="md"><Table miw={1000} striped><Table.Thead><Table.Tr><Table.Th>Row</Table.Th><Table.Th>Volunteer</Table.Th><Table.Th>Event</Table.Th><Table.Th>Date</Table.Th><Table.Th>Hours</Table.Th><Table.Th>Status</Table.Th><Table.Th>Reason</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{preview.slice(0,200).map((row)=><Table.Tr key={row.sourceRowNumber}><Table.Td>{row.sourceRowNumber}</Table.Td><Table.Td><Text fw={600}>{row.fullName||'-'}</Text><Text size="xs" c="dimmed">{row.email||row.phone||row.sourceVolunteerIdentifier||'No stable identifier'}</Text></Table.Td><Table.Td>{row.eventName||'-'}</Table.Td><Table.Td>{row.eventDate||'-'}</Table.Td><Table.Td>{minutesLabel(row.reportedMinutes)}</Table.Td><Table.Td><Badge variant="light">{row.matchStatus}</Badge></Table.Td><Table.Td><Text size="sm">{row.matchReason||'-'}</Text></Table.Td></Table.Tr>)}</Table.Tbody>
        </Table></ScrollArea>
        {preview.length>200&&<Text size="xs" c="dimmed" mt="sm">Showing first 200 rows of the preview.</Text>}
      </Paper>}
      <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><Group justify="space-between" p="md"><Title order={4}>Historical import history</Title><Badge variant="light">{historicalBatches.data?.length||0}</Badge></Group>
        <Table><Table.Thead><Table.Tr><Table.Th>Created</Table.Th><Table.Th>File</Table.Th><Table.Th>Rows</Table.Th><Table.Th>Imported</Table.Th><Table.Th>New volunteers</Table.Th><Table.Th>Review</Table.Th><Table.Th>Hours</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(historicalBatches.data||[]).map((row)=><Table.Tr key={row.id}><Table.Td>{new Date(row.created_at).toLocaleString('en-SG')}</Table.Td><Table.Td>{row.source_filename}</Table.Td><Table.Td>{row.row_count}</Table.Td><Table.Td>{row.imported_count}</Table.Td><Table.Td>{row.created_volunteer_count}</Table.Td><Table.Td>{row.review_count}</Table.Td><Table.Td>{minutesLabel(row.total_minutes)}</Table.Td><Table.Td>{row.status}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Paper>
    </Stack>}

    {tab==='duplicates'&&<Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><Table><Table.Thead><Table.Tr><Table.Th>Level</Table.Th><Table.Th>Existing volunteer</Table.Th><Table.Th>Incoming</Table.Th><Table.Th>Reason</Table.Th><Table.Th>Decision</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(duplicates.data||[]).map((row)=><Table.Tr key={row.id}><Table.Td><Badge color={row.level==='medium'?'orange':'gray'}>{row.level}</Badge></Table.Td><Table.Td>{row.existing_volunteer_id?'Existing database record':'-'}</Table.Td><Table.Td><Text size="sm" maw={320} lineClamp={3}>{JSON.stringify(row.incoming)}</Text></Table.Td><Table.Td>{row.reason||'-'}</Table.Td><Table.Td>{canWrite?<Group gap="xs">{(['merge','add','dismiss'] as const).map((decision)=><Button key={decision} size="compact-xs" variant={row.decision===decision?'filled':'light'} onClick={()=>void updateDuplicateDecision(row,decision).then(()=>qc.invalidateQueries({queryKey:['duplicates']}))}>{decision}</Button>)}</Group>:row.decision}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></Paper>}

    {tab==='export'&&<Paper withBorder radius="lg" p="lg"><Title order={4}>Controlled workbook export</Title><Text c="dimmed" size="sm" mb="md">Exports volunteers, attendance, events, shifts and volunteer leads into one Excel workbook. Treat the file as personal data.</Text><Button onClick={()=>void exportMaklomWorkbook()}>Export MakLom workbook</Button></Paper>}
  </Stack>;
}