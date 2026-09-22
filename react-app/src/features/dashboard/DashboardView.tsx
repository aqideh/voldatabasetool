import { Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from './api';

export function DashboardView() {
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });
  const cards: Array<[string, number | undefined]> = [
    ['Volunteers', summary.data?.volunteers],
    ['Attendance rows', summary.data?.attendanceRows],
    ['Events', summary.data?.events],
    ['Shifts', summary.data?.shifts],
  ];

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Overview</Title>
        <Text c="dimmed" size="sm">
          Live counts from Supabase. Rich charts will move onto database-backed aggregates in later slices.
        </Text>
      </div>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        {cards.map(([label, value]) => (
          <Paper key={label} withBorder radius="lg" p="lg">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
            <Text fz={32} fw={800} mt={6}>
              {summary.isLoading ? '...' : Number(value || 0).toLocaleString()}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
