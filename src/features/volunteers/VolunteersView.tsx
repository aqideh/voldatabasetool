import { useMemo, useState } from 'react';
import {
  Badge,
  Group,
  Loader,
  NumberInput,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchVolunteerFilterOptions, fetchVolunteers } from './api';
import { VolunteerDrawer } from './VolunteerDrawer';
import type { VolunteerFilters, VolunteerRow } from '../../lib/types';

const PAGE_SIZE = 50;

interface Props {
  canWrite: boolean;
}

export function VolunteersView({ canWrite }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [tag, setTag] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [sort, setSort] = useState<VolunteerFilters['sort']>('name-asc');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VolunteerRow | null>(null);

  const filters = useMemo<VolunteerFilters>(() => ({
    search: debouncedSearch,
    tag,
    recruitedYear: year,
    sort,
    page,
    pageSize: PAGE_SIZE,
  }), [debouncedSearch, tag, year, sort, page]);

  const options = useQuery({
    queryKey: ['volunteer-filter-options'],
    queryFn: fetchVolunteerFilterOptions,
    staleTime: 5 * 60_000,
  });

  const volunteers = useQuery({
    queryKey: ['volunteers', filters],
    queryFn: () => fetchVolunteers(filters),
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil((volunteers.data?.count || 0) / PAGE_SIZE));

  function resetPage() {
    if (page !== 0) setPage(0);
  }

  async function handleSaved(updated: VolunteerRow) {
    setSelected(updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['volunteers'] }),
      queryClient.invalidateQueries({ queryKey: ['volunteer-filter-options'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ]);
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Central Database</Title>
          <Text c="dimmed" size="sm">
            Server-paginated volunteer search. Only the current result page is sent to the browser.
          </Text>
        </div>
        <Badge size="lg" variant="light">{(volunteers.data?.count || 0).toLocaleString()} matches</Badge>
      </Group>

      <Paper withBorder radius="lg" p="md">
        <Group align="flex-end" grow wrap="wrap">
          <TextInput
            label="Search"
            placeholder="KEL ID, name, email, phone or notes"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              resetPage();
            }}
          />
          <Select
            label="Tag"
            placeholder="All tags"
            clearable
            searchable
            data={options.data?.tags || []}
            value={tag}
            onChange={(value) => {
              setTag(value);
              resetPage();
            }}
          />
          <NumberInput
            label="Recruited year"
            placeholder="All years"
            value={year ?? ''}
            min={1900}
            max={2100}
            onChange={(value) => {
              setYear(typeof value === 'number' ? value : null);
              resetPage();
            }}
          />
          <Select
            label="Sort"
            value={sort}
            data={[
              { value: 'name-asc', label: 'Name A-Z' },
              { value: 'name-desc', label: 'Name Z-A' },
              { value: 'newest', label: 'Recently updated' },
              { value: 'oldest', label: 'Least recently updated' },
            ]}
            onChange={(value) => {
              setSort((value || 'name-asc') as VolunteerFilters['sort']);
              resetPage();
            }}
          />
        </Group>
      </Paper>

      <Paper withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <ScrollArea>
          <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md" miw={900}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Contact</Table.Th>
                <Table.Th>Recruited</Table.Th>
                <Table.Th>Tags</Table.Th>
                <Table.Th>Programmes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(volunteers.data?.rows || []).map((row) => (
                <Table.Tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Text fw={700}>{row.name}</Text>
                    <Text size="xs" c="dimmed">{row.volunteer_code}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{row.email || '-'}</Text>
                    <Text size="xs" c="dimmed">{row.phone || '-'}</Text>
                  </Table.Td>
                  <Table.Td>{row.recruited_year || '-'}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="wrap">
                      {(row.tags || []).slice(0, 4).map((item) => (
                        <Badge key={item} variant="light" size="sm">{item}</Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {(row.programmes_registered || []).join(', ') || '-'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        {volunteers.isLoading && (
          <Group justify="center" p="xl"><Loader size="sm" /></Group>
        )}
        {!volunteers.isLoading && !volunteers.data?.rows.length && (
          <Text c="dimmed" ta="center" p="xl">No volunteers match these filters.</Text>
        )}
      </Paper>

      <Group justify="space-between">
        <Text size="sm" c="dimmed">Page {page + 1} of {totalPages}</Text>
        <Pagination total={totalPages} value={page + 1} onChange={(value) => setPage(value - 1)} />
      </Group>

      <VolunteerDrawer
        volunteer={selected}
        canWrite={canWrite}
        onClose={() => setSelected(null)}
        onSaved={(row) => void handleSaved(row)}
      />
    </Stack>
  );
}
