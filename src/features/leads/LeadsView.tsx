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
  updateVolunteerLead,
} from './api';
import type { LeadFilters, VolunteerLead, VolunteerLeadStatus } from '../../lib/types';

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VolunteerLead | null>(null);
  const [editStatus, setEditStatus] = useState<VolunteerLeadStatus>('new');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [opened, { open, close }] = useDisclosure(false);

  const filters = useMemo<LeadFilters>(() => ({
    search: debouncedSearch,
    status,
    page,
    pageSize: PAGE_SIZE,
  }), [debouncedSearch, status, page]);

  const leads = useQuery({
    queryKey: ['volunteer-leads', filters],
    queryFn: () => fetchVolunteerLeads(filters),
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil((leads.data?.count || 0) / PAGE_SIZE));

  function chooseLead(lead: VolunteerLead) {
    setSelected(lead);
    setEditStatus(lead.status);
    setNotes(lead.staff_notes || '');
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

  async function saveLead() {
    if (!selected || !canWrite) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateVolunteerLead(selected.id, selected.row_version, {
        status: editStatus,
        staff_notes: notes.trim() || null,
      });
      setSelected(updated);
      setEditStatus(updated.status);
      setNotes(updated.staff_notes || '');
      setMessage({ kind: 'success', text: 'Lead updated.' });
      await refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not update lead.' });
    } finally {
      setSaving(false);
    }
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
          ? `Lead linked to existing volunteer ${result.volunteer_id}.`
          : result.status === 'already_converted'
            ? `Lead was already converted to ${result.volunteer_id}.`
            : `Volunteer ${result.volunteer_id} created.`,
      });
      await refresh();
      setSelected({
        ...selected,
        status: 'converted',
        converted_volunteer_id: result.volunteer_id,
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
                <Table.Th>Interest</Table.Th>
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
                    <Text size="xs" c="dimmed">{lead.source === 'formsg' ? 'FormSG' : 'Manual'} · {lead.id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{lead.email || '-'}</Text>
                    <Text size="xs" c="dimmed">{lead.phone || '-'}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm" lineClamp={2}>{lead.interest_area || '-'}</Text></Table.Td>
                  <Table.Td><Badge variant="light">{statusOptions.find((item) => item.value === lead.status)?.label || lead.status}</Badge></Table.Td>
                  <Table.Td>{lead.submitted_at ? new Date(lead.submitted_at).toLocaleDateString('en-SG') : '-'}</Table.Td>
                  <Table.Td>{lead.converted_volunteer_id || '-'}</Table.Td>
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

      <Modal opened={opened} onClose={close} title={selected?.full_name || 'Volunteer lead'} size="lg">
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

            <Select
              label="Lead status"
              data={editableStatusOptions}
              value={editStatus}
              onChange={(value) => setEditStatus((value || 'new') as VolunteerLeadStatus)}
              disabled={!canWrite || selected.status === 'converted'}
            />
            <Textarea
              label="Staff notes"
              minRows={4}
              autosize
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              disabled={!canWrite || selected.status === 'converted'}
            />

            {selected.converted_volunteer_id && (
              <Alert color="green" variant="light">
                Converted to volunteer {selected.converted_volunteer_id}.
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
                <Button loading={saving} onClick={() => void saveLead()}>
                  Save lead
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
