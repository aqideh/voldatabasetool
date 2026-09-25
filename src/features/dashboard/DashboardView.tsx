import { Badge, Group, Paper, Progress, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from './api';
import { minutesLabel } from '../../lib/utils';

function rateLabel(value:number|null){return value==null?'—':`${value.toFixed(1)}%`;}

export function DashboardView(){
  const summary=useQuery({queryKey:['dashboard-summary'],queryFn:fetchDashboardSummary});
  const s=summary.data;
  const cards:Array<[string,string,string]>=[
    ['Total volunteers',Number(s?.volunteers||0).toLocaleString(),'canonical MakLom profiles'],
    ['Active events',Number(s?.events||0).toLocaleString(),'current MakLom events'],
    ['Attendance rows',Number(s?.attendanceRows||0).toLocaleString(),'all deployment rows'],
    ['Attended',Number(s?.attendedRows||0).toLocaleString(),'attendance marked yes'],
    ['Credited time',minutesLabel(s?.creditedMinutes||0),'staff/calculated duration'],
    ['Open leads',Number(s?.leads||0).toLocaleString(),'prospective volunteers'],
    ['Duplicate cases',Number(s?.openDuplicateCases||0).toLocaleString(),'awaiting review'],
    ['Shifts',Number(s?.shifts||0).toLocaleString(),'historical/current MakLom shifts'],
  ];
  return <Stack gap="lg">
    <div><Title order={2}>Overview</Title><Text c="dimmed" size="sm">Restored volunteer analytics dashboard using the shared MakLom database.</Text></div>
    <SimpleGrid cols={{base:2,md:4}} spacing="md">
      {cards.map(([label,value,note])=><Paper key={label} withBorder radius="lg" p="lg">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
        <Text fz={30} fw={800} mt={6}>{summary.isLoading?'...':value}</Text>
        <Text size="xs" c="dimmed">{note}</Text>
      </Paper>)}
    </SimpleGrid>
    <SimpleGrid cols={{base:1,md:2}} spacing="md">
      <Paper withBorder radius="lg" p="lg">
        <Title order={4}>Recruited by year</Title>
        <Stack mt="md" gap="xs">{(s?.recruitedByYear||[]).map((row)=>{
          const max=Math.max(...(s?.recruitedByYear||[]).map((item)=>item.count),1);
          return <div key={row.year}><Group justify="space-between"><Text size="sm">{row.year}</Text><Text size="sm" fw={700}>{row.count}</Text></Group><Progress value={(row.count/max)*100}/></div>;
        })}</Stack>
      </Paper>
      <Paper withBorder radius="lg" p="lg">
        <Title order={4}>Deployed by year</Title>
        <Stack mt="md" gap="xs">{(s?.deployedByYear||[]).map((row)=>{
          const max=Math.max(...(s?.deployedByYear||[]).map((item)=>item.count),1);
          return <div key={row.year}><Group justify="space-between"><Text size="sm">{row.year}</Text><Text size="sm" fw={700}>{row.count}</Text></Group><Progress value={(row.count/max)*100}/></div>;
        })}</Stack>
      </Paper>
    </SimpleGrid>
    <SimpleGrid cols={{base:1,md:2}} spacing="md">
      <Paper withBorder radius="lg" p="lg">
        <Title order={4}>Programmes registered</Title>
        <Table mt="sm"><Table.Thead><Table.Tr><Table.Th>Programme</Table.Th><Table.Th ta="right">Volunteers</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(s?.programmeCounts||[]).map((row)=><Table.Tr key={row.programme}><Table.Td>{row.programme}</Table.Td><Table.Td ta="right">{row.count}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between"><Title order={4}>Event participation & retention</Title><Badge variant="light">{s?.retention.year||new Date().getFullYear()}</Badge></Group>
        <SimpleGrid cols={2} mt="md">
          <div><Text size="xs" c="dimmed">No-show rate</Text><Text fz="xl" fw={800}>{rateLabel(s?.retention.noShowRate??null)}</Text></div>
          <div><Text size="xs" c="dimmed">30d retention</Text><Text fz="xl" fw={800}>{rateLabel(s?.retention.retention30??null)}</Text></div>
          <div><Text size="xs" c="dimmed">60d retention</Text><Text fz="xl" fw={800}>{rateLabel(s?.retention.retention60??null)}</Text></div>
          <div><Text size="xs" c="dimmed">90d retention</Text><Text fz="xl" fw={800}>{rateLabel(s?.retention.retention90??null)}</Text></div>
          <div><Text size="xs" c="dimmed">90d drop-off</Text><Text fz="xl" fw={800}>{rateLabel(s?.retention.dropOff90??null)}</Text></div>
        </SimpleGrid>
        <Text c="dimmed" size="xs" mt="md">Retention follows attended volunteers from their first recorded event to a later distinct event. Recent cohorts are excluded until the follow-up window matures.</Text>
      </Paper>
    </SimpleGrid>
  </Stack>;
}