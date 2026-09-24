import { Badge, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from './api';
import { minutesLabel } from '../../lib/utils';

export function DashboardView() {
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });
  const cards: Array<[string, string]> = [
    ['Volunteers', Number(summary.data?.volunteers || 0).toLocaleString()],
    ['Open leads', Number(summary.data?.leads || 0).toLocaleString()],
    ['Active events', Number(summary.data?.events || 0).toLocaleString()],
    ['Shifts', Number(summary.data?.shifts || 0).toLocaleString()],
    ['Attendance rows', Number(summary.data?.attendanceRows || 0).toLocaleString()],
    ['Attended', Number(summary.data?.attendedRows || 0).toLocaleString()],
    ['Credited time', minutesLabel(summary.data?.creditedMinutes || 0)],
    ['Duplicate cases', Number(summary.data?.openDuplicateCases || 0).toLocaleString()],
  ];
  return <Stack gap="lg">
    <div>
      <Title order={2}>Overview</Title>
      <Text c="dimmed" size="sm">Live operational counts from the shared volunteer platform.</Text>
    </div>
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
      {cards.map(([label, value]) => <Paper key={label} withBorder radius="lg" p="lg">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
        <Text fz={30} fw={800} mt={6}>{summary.isLoading ? '...' : value}</Text>
      </Paper>)}
    </SimpleGrid>
    <Paper withBorder radius="lg" p="lg">
      <Badge variant="light">Shared database</Badge>
      <Text mt="sm" fw={700}>MakLom is the higher-security operational layer.</Text>
      <Text c="dimmed" size="sm">Prospective leads arrive from FormSG, staff review and convert them deliberately, and operational attendance remains auditable in Supabase.</Text>
    </Paper>
  </Stack>;
}
