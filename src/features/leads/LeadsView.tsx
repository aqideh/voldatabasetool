import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  convertVolunteerLead,
  fetchVolunteerLeads,
  importFormSgLeads,
  fetchLeadActivities,
  fetchLeadStaff,
  takeLeadAction,
  type LeadAction,
} from './api';
import type { LeadFilters, VolunteerLead, VolunteerLeadStatus } from '../../lib/types';

const PAGE_SIZE = 50;

type LeadResponse = {
  key: string;
  question: string;
  answer: string;
  fieldType: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayFormValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const values = value.map(displayFormValue).filter((item): item is string => Boolean(item));
    return values.length ? values.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function extractLeadResponses(rawPayload: Record<string, unknown>): LeadResponse[] {
  const responses = rawPayload.responses;
  if (Array.isArray(responses)) {
    return responses.flatMap((entry, index) => {
      const field = asRecord(entry);
      if (!field) return [];
      const answer =
        displayFormValue(field.answer) ||
        displayFormValue(field.answerArray) ||
        displayFormValue(field.value);
      if (!answer) return [];
      return [{
        key: displayFormValue(field._id) || `response-${index}`,
        question: displayFormValue(field.question) || `Question ${index + 1}`,
        answer,
        fieldType: displayFormValue(field.fieldType),
      }];
    });
  }

  const metadataKeys = new Set([
    'schemaVersion',
    'formId',
    'submissionId',
    'created',
    'verifiedContentPresent',
    'importSource',
  ]);
  return Object.entries(rawPayload).flatMap(([question, value], index) => {
    if (metadataKeys.has(question)) return [];
    const answer = displayFormValue(value);
    if (!answer) return [];
    return [{
      key: `legacy-${index}-${question}`,
      question,
      answer,
      fieldType: null,
    }];
  });
}

const statusOptions: Array<{ value: VolunteerLeadStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'converted', label: 'Converted' },
  { value: 'not_selected', label: 'Not selected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const editableStatusOptions = statusOptions.filter((item) => item.value !== 'converted');

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ''])),
  );
}

interface Props {
  canWrite: boolean;
}

export function LeadsView({ canWrite }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [status, setStatus] = useState<VolunteerLeadStatus | null>(null);
  const [stream,setStream] = useState<string|null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VolunteerLead | null>(null);
  const [editStatus, setEditStatus] = useState<VolunteerLeadStatus>('new');
  const [action, setAction] = useState<LeadAction>('note');
  const [assignee, setAssignee] = useState<string|null>(null);
  const [nextTask, setNextTask] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [opened, { open, close }] = useDisclosure(false);

  const filters = useMemo<LeadFilters>(() => ({
    search: debouncedSearch,
    status,
    pathway:stream,
    page,
    pageSize: PAGE_SIZE,
  }), [debouncedSearch, status, stream, page]);

  const leads = useQuery({
    queryKey: ['volunteer-leads', filters],
    queryFn: () => fetchVolunteerLeads(filters),
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil((leads.data?.count || 0) / PAGE_SIZE));

  function chooseLead(lead: VolunteerLead) {
    setSelected(lead);
    setEditStatus(lead.status);
    setNotes('');
    setAction('note');
    setAssignee(lead.responsible_user_id);
    setNextTask(lead.next_action || '');
    setDue(lead.next_action_due ? lead.next_action_due.slice(0,16) : '');
    setMessage(null);
    open();
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['volunteer-leads'] }),
      queryClient.invalidateQueries({ queryKey: ['volunteers'] }),
      queryClient.invalidateQueries({ queryKey: ['volunteer-filter-options'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ]);
  }

  const staff=useQuery({queryKey:['lead-staff'],queryFn:fetchLeadStaff,enabled:opened});
  const history=useQuery({queryKey:['lead-activities',selected?.id],queryFn:()=>fetchLeadActivities(selected!.id),enabled:opened&&!!selected});

  async function saveLead() {
    if(!selected||!canWrite)return;
    setSaving(true);setMessage(null);
    try {
      const updated=await takeLeadAction({leadId:selected.id,version:selected.row_version,action,
        note:notes.trim(),assignee, nextAction:nextTask.trim(),due:due?new Date(due+'+08:00').toISOString():null,status:editStatus});
      setSelected(updated);setEditStatus(updated.status);setNotes('');
      setMessage({kind:'success',text:'Recruitment action saved and attributed to your staff account.'});
      await refresh();
      await queryClient.invalidateQueries({queryKey:['lead-activities',selected.id]});
    }catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Unable to record recruitment action.'});}
    finally{setSaving(false);}
  }

  async function convertLead() {
    if (!selected || !canWrite) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await convertVolunteerLead(selected.id);
      setMessage({
        kind: 'success',
        text: result.status === 'linked_existing'
          ? `Lead linked to existing volunteer ${result.volunteer_code}.`
          : result.status === 'already_converted'
            ? `Lead was already converted to ${result.volunteer_code}.`
            : `Volunteer ${result.volunteer_code} created.`,
      });
      await refresh();
      setSelected({
        ...selected,
        status: 'converted',
        converted_volunteer_id: result.profile_id,
        converted_at: new Date().toISOString(),
      });
      setEditStatus('converted');
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not convert lead.' });
    } finally {
      setSaving(false);
    }
  }

  async function importCsv(file: File | null) {
    if (!file || !canWrite) return;
    setImporting(true);
    setMessage(null);
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error('The CSV does not contain any data rows.');
      const count = await importFormSgLeads(rows);
      setMessage({ kind: 'success', text: `Processed ${count} FormSG rows. Existing response IDs were left unchanged.` });
      setPage(0);
      await refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not import FormSG CSV.' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Volunteer Leads</Title>
          <Text c="dimmed" size="sm">
            Prospective volunteers from FormSG. Leads stay separate from the volunteer database until staff convert them.
          </Text>
        </div>
        <Group>
          <Badge size="lg" variant="light">{(leads.data?.count || 0).toLocaleString()} matches</Badge>
          {canWrite && (
            <FileButton onChange={(file) => void importCsv(file)} accept=".csv,text/csv">
              {(props) => <Button {...props} loading={importing} variant="default">Import FormSG CSV</Button>}
            </FileButton>
          )}
        </Group>
      </Group>

      {message && (
        <Alert color={message.kind === 'error' ? 'red' : 'green'} variant="light">
          {message.text}
        </Alert>
      )}

      <Paper withBorder radius="lg" p="md">
        <Group align="flex-end" grow>
          <Select label="Stream" clearable placeholder="All streams" value={stream} onChange={(value)=>{setStream(value);setPage(0);}}
            data={[{value:'coach',label:'Coach'},{value:'mentor',label:'Mentor'},{value:'facilitator',label:'Facilitator'},{value:'professional_networks',label:'Professional Networks'},{value:'contributor',label:'Contributor'}]}/>
          <TextInput
            label="Search"
            placeholder="Name, email, phone, interest or notes"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(0);
            }}
          />
          <Select
            label="Status"
            placeholder="All statuses"
            clearable
            data={statusOptions}
            value={status}
            onChange={(value) => {
              setStatus(value as VolunteerLeadStatus | null);
              setPage(0);
            }}
          />
        </Group>
      </Paper>

      <Paper withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <ScrollArea>
          <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md" miw={950}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lead</Table.Th>
                <Table.Th>Contact</Table.Th>
                <Table.Th>Stream</Table.Th><Table.Th>Next action</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Submitted</Table.Th>
                <Table.Th>Volunteer</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(leads.data?.rows || []).map((lead) => (
                <Table.Tr key={lead.id} onClick={() => chooseLead(lead)} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Text fw={700}>{lead.full_name}</Text>
                    <Text size="xs" c="dimmed">{lead.source === 'formsg' ? 'FormSG' : 'Manual'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{lead.email || '-'}</Text>
                    <Text size="xs" c="dimmed">{lead.phone || '-'}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{lead.pathway ? lead.pathway.replaceAll('_',' ') : 'Needs categorisation'}{lead.contributor_type ? ' · '+lead.contributor_type.replaceAll('_',' ') : ''}</Text></Table.Td><Table.Td><Text size="sm" lineClamp={2}>{lead.next_action||'-'}</Text></Table.Td>
                  <Table.Td><Badge variant="light">{statusOptions.find((item) => item.value === lead.status)?.label || lead.status}</Badge></Table.Td>
                  <Table.Td>{lead.submitted_at ? new Date(lead.submitted_at).toLocaleDateString('en-SG') : '-'}</Table.Td>
                  <Table.Td>{lead.converted_volunteer_id ? <Badge color="green" variant="light">Converted</Badge> : '-'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        {leads.isLoading && <Group justify="center" p="xl"><Loader size="sm" /></Group>}
        {!leads.isLoading && !leads.data?.rows.length && (
          <Text c="dimmed" ta="center" p="xl">No volunteer leads match these filters.</Text>
        )}
      </Paper>

      <Group justify="space-between">
        <Text size="sm" c="dimmed">Page {page + 1} of {totalPages}</Text>
        <Pagination total={totalPages} value={page + 1} onChange={(value) => setPage(value - 1)} />
      </Group>

      <Modal opened={opened} onClose={close} title={selected?.full_name || 'Volunteer lead'} size="xl">
        {selected && (
          <Stack>
            {message && (
              <Alert color={message.kind === 'error' ? 'red' : 'green'} variant="light">
                {message.text}
              </Alert>
            )}
            <Group>
              <Badge>{selected.source === 'formsg' ? 'FormSG' : 'Manual'}</Badge>
              {selected.source_submission_id && <Text size="xs" c="dimmed">Response {selected.source_submission_id}</Text>}
            </Group>
            <Text size="sm"><b>Email:</b> {selected.email || '-'}</Text>
            <Text size="sm"><b>Phone:</b> {selected.phone || '-'}</Text>
            <Text size="sm"><b>Interest:</b> {selected.interest_area || '-'}</Text>
            {selected.motivation && <Text size="sm"><b>Motivation:</b> {selected.motivation}</Text>}
            {selected.skills_experience && <Text size="sm"><b>Skills / experience:</b> {selected.skills_experience}</Text>}
            {selected.availability_notes && <Text size="sm"><b>Availability:</b> {selected.availability_notes}</Text>}
            {selected.referral_source && <Text size="sm"><b>Referral source:</b> {selected.referral_source}</Text>}

            {extractLeadResponses(selected.raw_payload || {}).length > 0 && (
              <Stack gap="xs">
                <div>
                  <Text fw={700} size="sm">FormSG responses</Text>
                  <Text size="xs" c="dimmed">
                    These are the questions and answers received for this submission. FormSG logic branches only send fields that were active for the respondent.
                  </Text>
                </div>
                <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
                  <ScrollArea.Autosize mah={420}>
                    <Table verticalSpacing="sm" horizontalSpacing="md" miw={640}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Question</Table.Th>
                          <Table.Th>Response</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {extractLeadResponses(selected.raw_payload || {}).map((response) => (
                          <Table.Tr key={response.key}>
                            <Table.Td style={{ width: '44%', verticalAlign: 'top' }}>
                              <Text size="sm" fw={600}>{response.question}</Text>
                              {response.fieldType && <Text size="xs" c="dimmed">{response.fieldType}</Text>}
                            </Table.Td>
                            <Table.Td style={{ verticalAlign: 'top' }}>
                              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{response.answer}</Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea.Autosize>
                </Paper>
              </Stack>
            )}


            <Paper withBorder p="md" radius="md">
              <Stack gap="sm">
                <Title order={5}>Recruitment case</Title>
                <Group gap="xs">
                  <Badge variant="light">{selected.pathway?.replaceAll('_',' ')||'Needs categorisation'}</Badge>
                  {selected.contributor_type&&<Badge variant="outline">{selected.contributor_type.replaceAll('_',' ')}</Badge>}
                  {selected.handover_state&&<Badge color="blue" variant="light">Handover: {selected.handover_state.replaceAll('_',' ')}</Badge>}
                </Group>
                <Text size="sm">Responsible: {staff.data?.find(x=>x.user_id===selected.responsible_user_id)?.email||'Unassigned'}</Text>
                <Text size="sm">Next action: {selected.next_action||'Not scheduled'}{selected.next_action_due?' · '+new Date(selected.next_action_due).toLocaleString('en-SG'):''}</Text>
                <Select label="Record action" value={action} onChange={v=>setAction((v||'note') as LeadAction)} disabled={!canWrite}
                  data={[
                    {value:'note',label:'Add activity note'},
                    {value:'contact_attempt',label:'Contact attempted'},
                    {value:'contacted',label:'Contact completed'},
                    {value:'assign',label:'Assign responsibility'},
                    {value:'next_action',label:'Set next action'},
                    {value:'status_update',label:'Update recruitment status'},
                    ...(selected.pathway==='coach'||selected.pathway==='professional_networks'?[
                      {value:'handover_approve',label:'VM approve handover'},
                      {value:'handover_clarification',label:'Request handover clarification'},
                      {value:'handover_decline',label:'Do not hand over'},
                      {value:'handover_sent',label:'Record handover sent'},
                      {value:'handover_acknowledge',label:'Record departmental acknowledgement'},
                    ]:[])
                  ]}/>
                {action==='assign'&&<Select clearable searchable label="Responsible colleague (optional)" placeholder="Unassigned"
                  data={(staff.data||[]).map(x=>({value:x.user_id,label:x.email}))} value={assignee} onChange={setAssignee}/>}
                {action==='next_action'&&<><TextInput label="Next action" value={nextTask} onChange={e=>setNextTask(e.currentTarget.value)}/>
                  <TextInput label="Due date and time (SGT)" type="datetime-local" value={due} onChange={e=>setDue(e.currentTarget.value)}/></>}
                {action==='status_update'&&<Select label="Status" data={editableStatusOptions}
                  value={editStatus} onChange={v=>setEditStatus((v||'new') as VolunteerLeadStatus)}/>}
                <Textarea label="Action details / evidence" description="For handover delivery, record the channel and recipient. Do not record sensitive screening information here."
                  autosize minRows={2} value={notes} onChange={e=>setNotes(e.currentTarget.value)} disabled={!canWrite}/>
                {canWrite&&<Button loading={saving} onClick={()=>void saveLead()}>Record action</Button>}
              </Stack>
            </Paper>
            <Stack gap="xs">
              <Title order={5}>Activity history</Title>
              {history.isLoading&&<Loader size="sm"/>}
              {history.error&&<Text c="red" size="sm">{(history.error as Error).message}</Text>}
              {(history.data||[]).map(item=><Paper key={item.id} p="sm" withBorder radius="md">
                <Text size="sm" fw={600}>{item.action.replaceAll('_',' ')}</Text>
                <Text size="xs" c="dimmed">{staff.data?.find(x=>x.user_id===item.actor_user_id)?.email||'Staff account '+item.actor_user_id} · {new Date(item.occurred_at).toLocaleString('en-SG')}</Text>
                {item.note&&<Text size="sm">{item.note}</Text>}
              </Paper>)}
              {!history.isLoading&&!history.data?.length&&<Text size="sm" c="dimmed">No recorded recruitment actions yet. Older updates may exist only in the database audit log.</Text>}
            </Stack>
            {selected.converted_volunteer_id && (
              <Alert color="green" variant="light">
                Converted to the volunteer database.
              </Alert>
            )}

            {canWrite && selected.status !== 'converted' && (
              <Group justify="space-between">
                <Button
                  color="green"
                  variant="light"
                  disabled={selected.status !== 'accepted'}
                  loading={saving}
                  onClick={() => void convertLead()}
                >
                  Convert to volunteer
                </Button>

              </Group>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
