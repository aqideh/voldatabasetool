import { useMemo, useState } from 'react';
import { Badge, Button, Group, NumberInput, Pagination, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchAllVolunteerIntelligence, fetchImpactSummary, fetchIntelligenceSummary, fetchMonthlyParticipation, fetchProgrammeBreakdown, fetchRetentionSummary, fetchVolunteerIntelligence } from './api';
import type { IntelligenceFilters, VolunteerIntelligenceRow } from '../../lib/types';
import { minutesLabel } from '../../lib/utils';

const PAGE_SIZE=50;
function rate(value:number|null){return value==null?'—':`${Number(value).toFixed(1)}%`;}
function dateLabel(value:string|null){return value?new Date(value+'T00:00:00').toLocaleDateString('en-SG'):'—';}
function csvCell(value:unknown){let s=String(value??'');if(/^[=+\-@]/.test(s.trimStart()))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;}
function exportCsv(rows:VolunteerIntelligenceRow[]){
  const header=['Name','Email','Phone','Recruited year','Events','First event','Last event','Repeat engaged','Events last 90d','Historical credited minutes','Approved KELUARGA minutes','Accepted insights','Accepted reviews','Follow-up reviews'];
  const body=rows.map((r)=>[r.name,r.email,r.phone,r.recruited_year,r.event_count,r.first_event_date,r.last_event_date,r.repeat_engaged,r.events_last_90d,r.historical_credited_minutes,r.approved_keluarga_minutes,r.accepted_insights,r.accepted_reviews,r.accepted_follow_up_reviews].map(csvCell).join(','));
  const blob=new Blob([[header.map(csvCell).join(','),...body].join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='maklom-volunteer-intelligence.csv';a.click();URL.revokeObjectURL(url);
}

export function VolunteerIntelligenceView(){
  const[search,setSearch]=useState('');const[debounced]=useDebouncedValue(search,250);const[engagement,setEngagement]=useState<IntelligenceFilters['engagement']>('all');
  const[recruitedYear,setRecruitedYear]=useState<number|null>(null);const[sort,setSort]=useState<IntelligenceFilters['sort']>('events');const[page,setPage]=useState(0);const[exporting,setExporting]=useState(false);
  const filters=useMemo<IntelligenceFilters>(()=>({search:debounced,engagement,recruitedYear,sort,page,pageSize:PAGE_SIZE}),[debounced,engagement,recruitedYear,sort,page]);
  const summary=useQuery({queryKey:['intelligence-summary'],queryFn:fetchIntelligenceSummary});
  const retention=useQuery({queryKey:['intelligence-retention'],queryFn:fetchRetentionSummary});
  const monthly=useQuery({queryKey:['intelligence-monthly'],queryFn:fetchMonthlyParticipation});
  const programmes=useQuery({queryKey:['intelligence-programmes'],queryFn:fetchProgrammeBreakdown});
  const impact=useQuery({queryKey:['intelligence-impact'],queryFn:fetchImpactSummary});
  const volunteers=useQuery({queryKey:['volunteer-intelligence',filters],queryFn:()=>fetchVolunteerIntelligence(filters),placeholderData:keepPreviousData});
  const totalPages=Math.max(1,Math.ceil((volunteers.data?.count||0)/PAGE_SIZE));
  const s=summary.data;
  const retentionMap=new Map((retention.data||[]).map((r)=>[r.window_days,r]));
  async function doExport(){setExporting(true);try{const rows=await fetchAllVolunteerIntelligence(filters);exportCsv(rows);}finally{setExporting(false);}}
  return <Stack gap="lg">
    <Group justify="space-between" align="flex-end"><div><Title order={2}>Volunteer Intelligence</Title><Text c="dimmed" size="sm">Cross-event engagement, retention, recognised hours and reviewed Volunteer Management signals.</Text></div><Button variant="light" loading={exporting} onClick={()=>void doExport()}>Export filtered CSV</Button></Group>
    <SimpleGrid cols={{base:2,md:3,xl:6}}>
      <Metric label="Unique volunteers" value={Number(programmes.data?.total_unique_volunteers??s?.total_volunteers??0).toLocaleString()} note="deduplicated canonical volunteer identities"/>
      <Metric label="Programme-tagged" value={Number(programmes.data?.tagged_unique_volunteers||0).toLocaleString()} note="tagged to at least one programme"/>
      <Metric label="Deployed volunteers" value={Number(s?.deployed_volunteers||0).toLocaleString()} note="at least one attended event"/>
      <Metric label="Repeat engagement" value={rate(s?.repeat_engagement_rate??null)} note={`${Number(s?.repeat_volunteers||0)} volunteers with 2+ events`}/>
      <Metric label="Active in last 90d" value={Number(s?.active_last_90d||0).toLocaleString()} note="deduplicated attended events"/>
      <Metric label="Historical credited time" value={minutesLabel(Number(s?.historical_credited_minutes||0))} note="legacy MakLom credited attendance"/>
      <Metric label="Approved KELUARGA time" value={minutesLabel(Number(s?.approved_keluarga_minutes||0))} note="MakLom-approved contributions only"/>
      <Metric label="Unresolved observations" value={Number(s?.unresolved_observations||0).toLocaleString()} note="pending or needs volunteer match"/>
    </SimpleGrid>
    <SimpleGrid cols={{base:1,md:2}}>
      <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Current-year retention</Title><Badge variant="light">{retention.data?.[0]?.cohort_year||new Date().getFullYear()}</Badge></Group>
        <SimpleGrid cols={3} mt="md">{[30,60,90].map((days)=>{const r=retentionMap.get(days);return <div key={days}><Text size="xs" c="dimmed">{days}-day</Text><Text fz="xl" fw={800}>{rate(r?.retention_rate??null)}</Text><Text size="xs" c="dimmed">{r?.retained_volunteers||0} / {r?.eligible_volunteers||0} mature cohort</Text></div>;})}</SimpleGrid>
        <Text size="xs" c="dimmed" mt="md">Retention means a volunteer attended a later distinct event within the window after their first recorded event. Recent first-event cohorts are excluded until the window matures.</Text>
      </Paper>
      <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Reviewed observations</Title><Badge variant="light">{Number(s?.accepted_insights||0)+Number(s?.accepted_reviews||0)} accepted</Badge></Group>
        <SimpleGrid cols={2} mt="md"><div><Text size="xs" c="dimmed">Accepted insights</Text><Text fz="xl" fw={800}>{Number(s?.accepted_insights||0)}</Text></div><div><Text size="xs" c="dimmed">Accepted reviews</Text><Text fz="xl" fw={800}>{Number(s?.accepted_reviews||0)}</Text></div></SimpleGrid>
        <Text size="xs" c="dimmed" mt="md">Only MakLom-accepted observations appear here; event source records remain contextual and retain provenance.</Text>
      </Paper>
    </SimpleGrid>
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>Volunteers by programme</Title>
          <Text c="dimmed" size="sm">Unique volunteers tagged to each programme. A volunteer tagged to multiple programmes appears once in each relevant programme.</Text>
        </div>
        <Badge variant="light">{Number(programmes.data?.total_unique_volunteers||0).toLocaleString()} unique volunteers</Badge>
      </Group>
      <SimpleGrid cols={{base:1,sm:2,lg:4}} mt="md">
        {(programmes.data?.rows||[]).map((r)=><Paper key={r.programme} withBorder radius="md" p="md"><Text size="xs" c="dimmed">{r.programme}</Text><Text fz={28} fw={800}>{r.unique_volunteers.toLocaleString()}</Text><Text size="xs" c="dimmed">unique volunteers</Text></Paper>)}
      </SimpleGrid>
      {!programmes.isLoading&&!programmes.data?.rows.length&&<Text c="dimmed" size="sm" mt="md">No programme tags have been recorded yet.</Text>}
      <Group gap="lg" mt="md">
        <Text size="sm"><strong>{Number(programmes.data?.untagged_unique_volunteers||0).toLocaleString()}</strong> not tagged to a programme</Text>
        <Text size="sm"><strong>{Number(programmes.data?.multi_programme_volunteers||0).toLocaleString()}</strong> tagged to multiple programmes</Text>
      </Group>
    </Paper>

    <Paper withBorder radius="lg" p="lg"><Title order={4}>Monthly participation</Title><ScrollArea><Table mt="sm" miw={720}>
      <Table.Thead><Table.Tr><Table.Th>Month</Table.Th><Table.Th ta="right">Unique volunteers</Table.Th><Table.Th ta="right">Participations</Table.Th><Table.Th ta="right">2+ events in month</Table.Th><Table.Th ta="right">Historical time</Table.Th><Table.Th ta="right">Approved KELUARGA</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(monthly.data||[]).map((r)=><Table.Tr key={r.month}><Table.Td>{new Date(r.month+'T00:00:00').toLocaleDateString('en-SG',{month:'short',year:'numeric'})}</Table.Td><Table.Td ta="right">{r.unique_volunteers}</Table.Td><Table.Td ta="right">{r.event_participations}</Table.Td><Table.Td ta="right">{r.repeat_volunteers}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.historical_credited_minutes))}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.approved_keluarga_minutes))}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></ScrollArea>{!monthly.isLoading&&!monthly.data?.length&&<Text c="dimmed" size="sm" mt="md">No participation has been recorded in this environment yet.</Text>}</Paper>
    <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Recorded impact</Title><Badge variant="light">{(impact.data||[]).length} measures</Badge></Group>
      {(impact.data||[]).length?<SimpleGrid cols={{base:1,sm:2,lg:3}} mt="md">{(impact.data||[]).slice(0,9).map((r)=><Paper key={r.label+'::'+(r.unit||'')} withBorder radius="md" p="md"><Text size="xs" c="dimmed">{r.label}</Text><Text fz="xl" fw={800}>{Number(r.total).toLocaleString()} {r.unit||''}</Text><Text size="xs" c="dimmed">{r.event_rows} event metric row{r.event_rows===1?'':'s'}</Text></Paper>)}</SimpleGrid>:<Text c="dimmed" size="sm" mt="md">No event impact metrics have been recorded yet. When staff add event impact measures, matching label + unit combinations will aggregate here.</Text>}
      <Text size="xs" c="dimmed" mt="md">Impact totals are grouped only when both label and unit match; incompatible measures are never combined.</Text>
    </Paper>
    <Paper withBorder radius="lg" p="md"><Group align="flex-end" grow wrap="wrap">
      <TextInput label="Search volunteers" placeholder="Name, email or phone" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);setPage(0);}}/>
      <Select label="Engagement" value={engagement} data={[{value:'all',label:'All volunteers'},{value:'deployed',label:'Deployed'},{value:'repeat',label:'Repeat engaged'},{value:'active90',label:'Active last 90 days'},{value:'inactive',label:'No attended events'}]} onChange={(v)=>{setEngagement((v||'all') as IntelligenceFilters['engagement']);setPage(0);}}/>
      <NumberInput label="Recruited year" placeholder="All years" value={recruitedYear??''} min={1900} max={2100} onChange={(v)=>{setRecruitedYear(typeof v==='number'?v:null);setPage(0);}}/>
      <Select label="Sort" value={sort} data={[{value:'events',label:'Events high-low'},{value:'last-active',label:'Last event newest'},{value:'historical-hours',label:'Historical credited time'},{value:'approved-hours',label:'Approved KELUARGA time'},{value:'name',label:'Name A-Z'}]} onChange={(v)=>setSort((v||'events') as IntelligenceFilters['sort'])}/>
    </Group></Paper>
    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><ScrollArea><Table striped highlightOnHover verticalSpacing="sm" miw={1250}>
      <Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th><Table.Th ta="right">Events</Table.Th><Table.Th>Engagement</Table.Th><Table.Th>First event</Table.Th><Table.Th>Last event</Table.Th><Table.Th ta="right">Historical time</Table.Th><Table.Th ta="right">Approved KELUARGA</Table.Th><Table.Th ta="right">Reviewed signals</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(volunteers.data?.rows||[]).map((r)=><Table.Tr key={r.core_volunteer_id}><Table.Td><Text fw={700}>{r.name}</Text><Text size="xs" c="dimmed">{r.email||r.phone||'—'}</Text></Table.Td><Table.Td ta="right">{r.event_count}</Table.Td><Table.Td><Group gap={4}>{r.repeat_engaged&&<Badge variant="light">Repeat</Badge>}{r.active_last_90d&&<Badge color="green" variant="light">90d active</Badge>}{!r.event_count&&<Badge color="gray" variant="light">Not deployed</Badge>}</Group></Table.Td><Table.Td>{dateLabel(r.first_event_date)}</Table.Td><Table.Td>{dateLabel(r.last_event_date)}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.historical_credited_minutes))}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.approved_keluarga_minutes))}</Table.Td><Table.Td ta="right">{r.accepted_insights+r.accepted_reviews}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></ScrollArea>{!volunteers.isLoading&&!volunteers.data?.rows.length&&<Text c="dimmed" ta="center" p="xl">No volunteers match these filters.</Text>}</Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">{(volunteers.data?.count||0).toLocaleString()} volunteers · page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(v)=>setPage(v-1)}/></Group>
    <Paper withBorder radius="lg" p="lg"><Title order={5}>Counting rules</Title><Stack gap={4} mt="xs"><Text size="sm">Participation = one linked volunteer per deduplicated attended event.</Text><Text size="sm">Repeat engagement = at least two distinct attended events across the full available history.</Text><Text size="sm">Historical credited time and MakLom-approved KELUARGA contribution time are deliberately separate; they are not summed into one ambiguous hours figure.</Text></Stack></Paper>
  </Stack>;
}
function Metric({label,value,note}:{label:string;value:string;note:string}){return <Paper withBorder radius="lg" p="lg"><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text><Text fz={28} fw={800} mt={6}>{value}</Text><Text size="xs" c="dimmed">{note}</Text></Paper>;}
