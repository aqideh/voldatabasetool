import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Pagination, Paper, ScrollArea,
  Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteAttendance, fetchAttendance, fetchAttendanceEventNames, updateAttendance } from './api';
import type { AttendanceFilters, AttendanceRow } from '../../lib/types';
import { minutesLabel, safeDateTime } from '../../lib/utils';

const PAGE_SIZE = 75;

export function AttendanceView({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const [eventName, setEventName] = useState<string | null>(null);
  const [attended, setAttended] = useState<AttendanceFilters['attended']>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AttendanceRow | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const filters = useMemo<AttendanceFilters>(() => ({ search: debounced, eventName, attended, page, pageSize: PAGE_SIZE }), [debounced,eventName,attended,page]);

  const events = useQuery({ queryKey: ['attendance-event-names'], queryFn: fetchAttendanceEventNames });
  const rows = useQuery({ queryKey: ['attendance', filters], queryFn: () => fetchAttendance(filters), placeholderData: keepPreviousData });
  const totalPages = Math.max(1, Math.ceil((rows.data?.count || 0) / PAGE_SIZE));

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      qc.invalidateQueries({ queryKey: ['attendance-event-names'] }),
    ]);
  }

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div><Title order={2}>Attendance</Title><Text c="dimmed" size="sm">Operational attendance records and credited volunteering time.</Text></div>
      <Badge size="lg" variant="light">{(rows.data?.count || 0).toLocaleString()} rows</Badge>
    </Group>
    <Paper withBorder radius="lg" p="md">
      <Group grow align="flex-end" wrap="wrap">
        <TextInput label="Search" placeholder="Volunteer, email, phone or event" value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(0); }} />
        <Select label="Event" searchable clearable data={events.data || []} value={eventName} onChange={(value) => { setEventName(value); setPage(0); }} />
        <Select label="Attendance" value={attended} data={[
          {value:'all',label:'All rows'},{value:'yes',label:'Attended'},{value:'no',label:'Not attended'},
        ]} onChange={(value) => { setAttended((value || 'all') as AttendanceFilters['attended']); setPage(0); }} />
      </Group>
    </Paper>
    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={1000}>
          <Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th><Table.Th>Event</Table.Th><Table.Th>Date</Table.Th><Table.Th>Shift</Table.Th><Table.Th>Status</Table.Th><Table.Th>Time</Table.Th><Table.Th>Credited</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(rows.data?.rows || []).map((row) => <Table.Tr key={row.id} onClick={() => { setSelected(row); open(); }} style={{cursor:'pointer'}}>
            <Table.Td><Text fw={700}>{row.name}</Text><Text size="xs" c="dimmed">{row.email || row.contact || '-'}</Text></Table.Td>
            <Table.Td>{row.event_name}</Table.Td><Table.Td>{row.event_date}</Table.Td><Table.Td>{row.shift_label || '-'}</Table.Td>
            <Table.Td><Badge color={row.attended ? 'green' : 'gray'} variant="light">{row.attended ? 'Attended' : 'Not attended'}</Badge></Table.Td>
            <Table.Td><Text size="sm">{safeDateTime(row.sign_in_at)}</Text><Text size="xs" c="dimmed">to {safeDateTime(row.sign_out_at)}</Text></Table.Td>
            <Table.Td>{minutesLabel(row.staff_credited_duration_minutes ?? row.calculated_duration_minutes ?? row.duration_minutes)}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!rows.isLoading && !rows.data?.rows.length && <Text c="dimmed" ta="center" p="xl">No attendance rows match these filters.</Text>}
    </Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(value)=>setPage(value-1)} /></Group>
    <Modal opened={opened} onClose={close} title={selected?.name || 'Attendance'} size="lg">
      {selected && <AttendanceEditor row={selected} canWrite={canWrite} canDelete={canDelete} onSaved={(updated) => { setSelected(updated); void refresh(); }} onDeleted={() => { setSelected(null); close(); void refresh(); }} />}
    </Modal>
  </Stack>;
}

function localInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const p: Record<string,string> = {}; parts.forEach((x)=>{p[x.type]=x.value;});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function toIso(value: string) { return value ? new Date(`${value}:00+08:00`).toISOString() : null; }

function AttendanceEditor({ row, canWrite, canDelete, onSaved, onDeleted }: { row: AttendanceRow; canWrite:boolean; canDelete:boolean; onSaved:(r:AttendanceRow)=>void; onDeleted:()=>void }) {
  const [message,setMessage]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  async function save(form: HTMLFormElement) {
    setSaving(true); setMessage(null);
    const data=new FormData(form);
    try {
      const updated=await updateAttendance(row,{
        attended:data.get('attended')==='on',
        event_name:String(data.get('event_name')||'').trim(),
        event_date:String(data.get('event_date')||''),
        shift_label:String(data.get('shift_label')||'').trim()||null,
        sign_in_at:toIso(String(data.get('sign_in_at')||'')),
        sign_out_at:toIso(String(data.get('sign_out_at')||'')),
        staff_credited_duration_minutes:data.get('credited_minutes')===''?null:Number(data.get('credited_minutes')),
        staff_credit_note:String(data.get('staff_credit_note')||'').trim()||null,
      });
      onSaved(updated); setMessage('Attendance updated.');
    } catch(error){setMessage(error instanceof Error?error.message:'Could not update attendance.');}
    finally{setSaving(false);}
  }
  return <Stack>
    {message&&<Alert variant="light">{message}</Alert>}
    <form onSubmit={(e)=>{e.preventDefault();void save(e.currentTarget);}}>
      <Checkbox name="attended" label="Attended" defaultChecked={row.attended} disabled={!canWrite} />
      <SimpleGrid cols={{base:1,md:2}} mt="sm">
        <TextInput name="event_name" label="Event" defaultValue={row.event_name} disabled={!canWrite}/>
        <TextInput name="event_date" type="date" label="Event date" defaultValue={row.event_date} disabled={!canWrite}/>
        <TextInput name="shift_label" label="Shift" defaultValue={row.shift_label||''} disabled={!canWrite}/>
        <NumberInput name="credited_minutes" label="Staff credited minutes" defaultValue={row.staff_credited_duration_minutes ?? ''} min={0} disabled={!canWrite}/>
        <TextInput name="sign_in_at" type="datetime-local" label="Sign in" defaultValue={localInput(row.sign_in_at)} disabled={!canWrite}/>
        <TextInput name="sign_out_at" type="datetime-local" label="Sign out" defaultValue={localInput(row.sign_out_at)} disabled={!canWrite}/>
      </SimpleGrid>
      <Textarea name="staff_credit_note" label="Staff credit note" mt="sm" defaultValue={row.staff_credit_note||''} disabled={!canWrite}/>
      {canWrite&&<Group justify="flex-end" mt="md"><Button type="submit" loading={saving}>Save attendance</Button></Group>}
    </form>
    {canDelete&&<Group justify="flex-end"><Button color="red" variant="light" onClick={()=>{if(confirm('Delete this attendance row?'))void deleteAttendance(row).then(onDeleted)}}>Delete row</Button></Group>}
  </Stack>;
}
