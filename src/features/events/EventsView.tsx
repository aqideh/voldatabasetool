import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack,
  Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createEvent, createMetric, createShift, deleteEvent, deleteMetric, deleteShift, fetchEventsBundle, updateEvent } from './api';
import type { EventRow } from '../../lib/types';

interface Props { canWrite: boolean; canDelete: boolean; }

export function EventsView({ canWrite, canDelete }: Props) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['events-bundle'], queryFn: fetchEventsBundle });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = query.data?.events.find((event) => event.id === selectedId) || null;
  const shifts = useMemo(() => query.data?.shifts.filter((shift) => shift.event_id === selectedId) || [], [query.data, selectedId]);
  const metrics = useMemo(() => query.data?.metrics.filter((metric) => metric.event_id === selectedId) || [], [query.data, selectedId]);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['events-bundle'] }),
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ]);
  }

  async function addEvent(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const start = String(data.get('start') || '');
    const end = String(data.get('end') || start);
    if (!name || !start || !end || end < start) {
      setMessage('Enter a valid event name and date range.');
      return;
    }
    setCreating(true);
    try {
      await createEvent({
        name,
        start_date: start,
        end_date: end,
        programme: String(data.get('programme') || '').trim() || null,
        venue: String(data.get('venue') || '').trim() || null,
        notes: String(data.get('notes') || '').trim() || null,
        status: 'active',
      });
      form.reset();
      setMessage(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create event.');
    } finally { setCreating(false); }
  }

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Events & Shifts</Title>
        <Text c="dimmed" size="sm">Structured events, deployment shifts and event impact metrics.</Text>
      </div>
      <Badge size="lg" variant="light">{query.data?.events.length || 0} events</Badge>
    </Group>

    {message && <Alert color="red" variant="light">{message}</Alert>}

    {canWrite && <Paper withBorder radius="lg" p="md">
      <form onSubmit={(event) => { event.preventDefault(); void addEvent(event.currentTarget); }}>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <TextInput name="name" label="Event name" required />
            <TextInput name="start" label="Start date" type="date" required />
            <TextInput name="end" label="End date" type="date" />
            <TextInput name="programme" label="Programme / category" />
            <TextInput name="venue" label="Venue" />
            <TextInput name="notes" label="Notes" />
          </SimpleGrid>
          <Group justify="flex-end"><Button type="submit" loading={creating}>Create event</Button></Group>
        </Stack>
      </form>
    </Paper>}

    <Paper withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Event</Table.Th><Table.Th>Dates</Table.Th><Table.Th>Programme</Table.Th><Table.Th>Venue</Table.Th><Table.Th>Shifts</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(query.data?.events || []).map((event) => <Table.Tr key={event.id} onClick={() => { setSelectedId(event.id); open(); }} style={{ cursor: 'pointer' }}>
            <Table.Td><Text fw={700}>{event.name}</Text><Text size="xs" c="dimmed">{event.status}</Text></Table.Td>
            <Table.Td>{event.start_date}{event.end_date !== event.start_date ? ` – ${event.end_date}` : ''}</Table.Td>
            <Table.Td>{event.programme || '-'}</Table.Td>
            <Table.Td>{event.venue || '-'}</Table.Td>
            <Table.Td>{query.data?.shifts.filter((shift) => shift.event_id === event.id).length || 0}</Table.Td>
          </Table.Tr>)}
        </Table.Tbody>
      </Table>
      {!query.isLoading && !query.data?.events.length && <Text c="dimmed" ta="center" p="xl">No events found.</Text>}
    </Paper>

    <Modal opened={opened} onClose={close} title={selected?.name || 'Event'} size="xl">
      {selected && <EventEditor
        event={selected}
        shifts={shifts}
        metrics={metrics}
        canWrite={canWrite}
        canDelete={canDelete}
        onRefresh={refresh}
        onDeleted={() => { setSelectedId(null); close(); void refresh(); }}
      />}
    </Modal>
  </Stack>;
}

function EventEditor({ event, shifts, metrics, canWrite, canDelete, onRefresh, onDeleted }: any) {
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(form: HTMLFormElement) {
    setSaving(true); setStatus(null);
    const data = new FormData(form);
    try {
      await updateEvent(event, {
        name: String(data.get('name') || '').trim(),
        start_date: String(data.get('start_date') || ''),
        end_date: String(data.get('end_date') || ''),
        programme: String(data.get('programme') || '').trim() || null,
        venue: String(data.get('venue') || '').trim() || null,
        notes: String(data.get('notes') || '').trim() || null,
        status: String(data.get('status') || 'active') as EventRow['status'],
      });
      setStatus('Saved.');
      await onRefresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save event.'); }
    finally { setSaving(false); }
  }

  return <Stack>
    {status && <Alert variant="light">{status}</Alert>}
    <form onSubmit={(e) => { e.preventDefault(); void save(e.currentTarget); }}>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <TextInput name="name" label="Name" defaultValue={event.name} disabled={!canWrite} />
        <Select name="status" label="Status" defaultValue={event.status} data={['active','archived']} disabled={!canWrite} />
        <TextInput name="start_date" label="Start date" type="date" defaultValue={event.start_date} disabled={!canWrite} />
        <TextInput name="end_date" label="End date" type="date" defaultValue={event.end_date} disabled={!canWrite} />
        <TextInput name="programme" label="Programme / category" defaultValue={event.programme || ''} disabled={!canWrite} />
        <TextInput name="venue" label="Venue" defaultValue={event.venue || ''} disabled={!canWrite} />
      </SimpleGrid>
      <Textarea name="notes" label="Notes" mt="sm" defaultValue={event.notes || ''} disabled={!canWrite} />
      {canWrite && <Group justify="flex-end" mt="md"><Button type="submit" loading={saving}>Save event</Button></Group>}
    </form>

    <Paper withBorder p="md">
      <Title order={4}>Shifts</Title>
      <Stack gap="xs" mt="sm">
        {shifts.map((shift: any) => <Group key={shift.id} justify="space-between">
          <div><Text fw={600}>{shift.name}</Text><Text size="xs" c="dimmed">{shift.shift_date} {shift.start_time ? `· ${String(shift.start_time).slice(0,5)}–${String(shift.end_time || '').slice(0,5)}` : ''}</Text></div>
          {canDelete && <Button size="xs" color="red" variant="subtle" onClick={() => void deleteShift(shift).then(onRefresh)}>Delete</Button>}
        </Group>)}
        {!shifts.length && <Text c="dimmed" size="sm">No shifts.</Text>}
        {canWrite && <form onSubmit={(e) => {
          e.preventDefault(); const data = new FormData(e.currentTarget);
          void createShift(event.id, {
            name: String(data.get('name') || '').trim(),
            shift_date: String(data.get('date') || ''),
            start_time: String(data.get('start') || '') || null,
            end_time: String(data.get('end') || '') || null,
            notes: null,
          }).then(() => { e.currentTarget.reset(); return onRefresh(); });
        }}>
          <SimpleGrid cols={{ base: 1, md: 4 }}>
            <TextInput name="name" label="Shift name" required />
            <TextInput name="date" label="Date" type="date" required />
            <TextInput name="start" label="Start" type="time" />
            <TextInput name="end" label="End" type="time" />
          </SimpleGrid>
          <Group justify="flex-end" mt="sm"><Button size="xs" type="submit">Add shift</Button></Group>
        </form>}
      </Stack>
    </Paper>

    <Paper withBorder p="md">
      <Title order={4}>Impact metrics</Title>
      <Stack gap="xs" mt="sm">
        {metrics.map((metric: any) => <Group key={metric.id} justify="space-between">
          <Text>{metric.label}: <b>{metric.value}</b> {metric.unit || ''}</Text>
          {canDelete && <Button size="xs" color="red" variant="subtle" onClick={() => void deleteMetric(metric).then(onRefresh)}>Delete</Button>}
        </Group>)}
        {canWrite && <form onSubmit={(e) => {
          e.preventDefault(); const data = new FormData(e.currentTarget);
          void createMetric(event.id, String(data.get('label') || '').trim(), Number(data.get('value') || 0), String(data.get('unit') || '').trim() || null)
            .then(() => { e.currentTarget.reset(); return onRefresh(); });
        }}>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <TextInput name="label" label="Metric" required />
            <NumberInput name="value" label="Value" min={0} required />
            <TextInput name="unit" label="Unit" />
          </SimpleGrid>
          <Group justify="flex-end" mt="sm"><Button size="xs" type="submit">Add metric</Button></Group>
        </form>}
      </Stack>
    </Paper>

    {canDelete && <Group justify="flex-end"><Button color="red" variant="light" onClick={() => {
      if (confirm(`Delete ${event.name}? Related shifts and metrics will be removed.`)) void deleteEvent(event).then(onDeleted);
    }}>Delete event</Button></Group>}
  </Stack>;
}
