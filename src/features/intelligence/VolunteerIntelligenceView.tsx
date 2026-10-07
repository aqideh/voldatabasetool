import { useMemo, useState } from 'react';
import { Badge, Button, Group, NumberInput, Pagination, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { buildIntelligenceReport, fetchIntelligenceDataset } from './api';
import type { IntelligenceDateRange, IntelligenceFilters, VolunteerIntelligenceRow } from '../../lib/types';
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
  const[datePreset,setDatePreset]=useState<'all'|'year'|'90d'|'custom'>('all');
  const[fromDate,setFromDate]=useState('');const[toDate,setToDate]=useState('');
  const dataset=useQuery({queryKey:['intelligence-dataset'],queryFn:fetchIntelligenceDataset,staleTime:60_000});
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  const currentYear=today.slice(0,4);
  const range=useMemo<IntelligenceDateRange>(()=>{
    if(datePreset==='all')return{from:null,to:null};
    if(datePreset==='year')return{from:`${currentYear}-01-01`,to:today};
    if(datePreset==='90d'){
      const d=new Date(`${today}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-89);
      return{from:d.toISOString().slice(0,10),to:today};
    }
    return{from:fromDate||null,to:toDate||null};
  },[datePreset,fromDate,toDate,currentYear,today]);
  const report=useMemo(()=>dataset.data?buildIntelligenceReport(dataset.data,range):null,[dataset.data,range]);
  const filters=useMemo<IntelligenceFilters>(()=>({search:debounced,engagement,recruitedYear,sort,page,pageSize:PAGE_SIZE}),[debounced,engagement,recruitedYear,sort,page]);
  const filteredRows=useMemo(()=>{
    let rows=[...(report?.volunteers||[])];
    const needle=debounced.trim().toLowerCase();
    if(needle)rows=rows.filter((row)=>[row.name,row.email,row.phone].some((value)=>String(value||'').toLowerCase().includes(needle)));
    if(engagement==='deployed')rows=rows.filter((row)=>row.event_count>0);
    else if(engagement==='repeat')rows=rows.filter((row)=>row.repeat_engaged);
    else if(engagement==='active90')rows=rows.filter((row)=>row.active_last_90d);
    else if(engagement==='inactive')rows=rows.filter((row)=>row.event_count===0);
    if(recruitedYear)rows=rows.filter((row)=>row.recruited_year===recruitedYear);
    if(sort==='events')rows.sort((a,b)=>b.event_count-a.event_count||a.name.localeCompare(b.name));
    else if(sort==='historical-hours')rows.sort((a,b)=>b.historical_credited_minutes-a.historical_credited_minutes||a.name.localeCompare(b.name));
    else if(sort==='approved-hours')rows.sort((a,b)=>b.approved_keluarga_minutes-a.approved_keluarga_minutes||a.name.localeCompare(b.name));
    else if(sort==='last-active')rows.sort((a,b)=>(b.last_event_date||'').localeCompare(a.last_event_date||'')||a.name.localeCompare(b.name));
    else rows.sort((a,b)=>a.name.localeCompare(b.name));
    return rows;
  },[report,debounced,engagement,recruitedYear,sort]);
  const totalPages=Math.max(1,Math.ceil(filteredRows.length/PAGE_SIZE));
  const pageRows=filteredRows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const s=report?.summary;
  const retentionMap=new Map((report?.retention||[]).map((r)=>[r.window_days,r]));
  const rangeLabel=range.from||range.to?`${range.from?dateLabel(range.from):'Start of all time'} → ${range.to?dateLabel(range.to):'End of all time'}`:'Start of all time → End of all time';
  const activeVolunteers=(report?.volunteers||[]).filter((row)=>row.event_count>0);
  const activeProgrammeCounts=useMemo(()=>{
    const counts=new Map<string,{programme:string;unique_volunteers:number}>();
    let tagged=0;let multiple=0;
    for(const row of activeVolunteers){
      const unique=new Map<string,string>();
      for(const raw of row.programmes_registered||[]){const label=String(raw||'').trim();if(!label)continue;const key=label.toLowerCase();if(!unique.has(key))unique.set(key,label);}
      if(unique.size>0)tagged+=1;if(unique.size>1)multiple+=1;
      for(const[key,label]of unique){const current=counts.get(key);counts.set(key,{programme:current?.programme||label,unique_volunteers:(current?.unique_volunteers||0)+1});}
    }
    return{total:activeVolunteers.length,tagged,untagged:activeVolunteers.length-tagged,multiple,rows:[...counts.values()].sort((a,b)=>b.unique_volunteers-a.unique_volunteers||a.programme.localeCompare(b.programme))};
  },[activeVolunteers]);
  async function doExport(){setExporting(true);try{exportCsv(filteredRows);}finally{setExporting(false);}}
  function choosePreset(value:string|null){
    const preset=(value||'all') as 'all'|'year'|'90d'|'custom';
    setDatePreset(preset);setPage(0);
  }
  if(dataset.isError)return <Paper withBorder radius="lg" p="lg"><Title order={3}>Volunteer Intelligence unavailable</Title><Text c="red" mt="xs">The reporting data could not be loaded. Refresh the page and try again.</Text></Paper>;
  return <Stack gap="lg">
    <Group justify="space-between" align="flex-end"><div><Title order={2}>Volunteer Intelligence</Title><Text c="dimmed" size="sm">Cross-event engagement, retention, recognised hours and reviewed Volunteer Management signals.</Text></div><Button variant="light" loading={exporting} disabled={dataset.isLoading} onClick={()=>void doExport()}>Export filtered CSV</Button></Group>
    <Paper withBorder radius="lg" p="md">
      <Group align="flex-end" wrap="wrap">
        <Select label="Date range" value={datePreset} w={210} data={[{value:'all',label:'All time'},{value:'year',label:'This year'},{value:'90d',label:'Last 90 days'},{value:'custom',label:'Custom range'}]} onChange={choosePreset}/>
        <TextInput label="From" type="date" value={datePreset==='custom'?fromDate:(range.from||'')} disabled={datePreset!=='custom'} placeholder="Start of all time" onChange={(e)=>{setFromDate(e.currentTarget.value);setPage(0);}}/>
        <TextInput label="To" type="date" value={datePreset==='custom'?toDate:(range.to||'')} disabled={datePreset!=='custom'} placeholder="End of all time" onChange={(e)=>{setToDate(e.currentTarget.value);setPage(0);}}/>
        <Button variant="subtle" onClick={()=>{setDatePreset('all');setFromDate('');setToDate('');setPage(0);}}>All time</Button>
      </Group>
      <Group gap="xs" mt="sm"><Badge variant="light">{rangeLabel}</Badge>{report?.bounds.min_date&&report?.bounds.max_date?<Text size="xs" c="dimmed">Available attendance history: {dateLabel(report.bounds.min_date)} to {dateLabel(report.bounds.max_date)}</Text>:null}</Group>
      {range.from&&range.to&&range.from>range.to?<Text c="red" size="sm" mt="sm">The From date must be before the To date.</Text>:null}
    </Paper>
    <SimpleGrid cols={{base:2,md:3,xl:6}}>
      <Metric label="Unique volunteers" value={Number(s?.deployed_volunteers||0).toLocaleString()} note="attended at least one event in selected range"/>
      <Metric label="Programme-tagged" value={Number(activeProgrammeCounts.tagged).toLocaleString()} note="active volunteers tagged to at least one programme"/>
      <Metric label="Deployed volunteers" value={Number(s?.deployed_volunteers||0).toLocaleString()} note="at least one attended event in selected range"/>
      <Metric label="Repeat engagement" value={rate(s?.repeat_engagement_rate??null)} note={`${Number(s?.repeat_volunteers||0)} volunteers with 2+ events in range`}/>
      <Metric label="Active in last 90d" value={Number(s?.active_last_90d||0).toLocaleString()} note="within selected range, ending at range end"/>
      <Metric label="Historical credited time" value={minutesLabel(Number(s?.historical_credited_minutes||0))} note="legacy MakLom credited attendance in range"/>
      <Metric label="Approved KELUARGA time" value={minutesLabel(Number(s?.approved_keluarga_minutes||0))} note="MakLom-approved contributions in range"/>
      <Metric label="Unresolved observations" value={Number(s?.unresolved_observations||0).toLocaleString()} note="pending or needs volunteer match in range"/>
    </SimpleGrid>
    <SimpleGrid cols={{base:1,md:2}}>
      <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Retention</Title><Badge variant="light">{rangeLabel}</Badge></Group>
        <SimpleGrid cols={3} mt="md">{[30,60,90].map((days)=>{const r=retentionMap.get(days);return <div key={days}><Text size="xs" c="dimmed">{days}-day</Text><Text fz="xl" fw={800}>{rate(r?.retention_rate??null)}</Text><Text size="xs" c="dimmed">{r?.retained_volunteers||0} / {r?.eligible_volunteers||0} mature cohort</Text></div>;})}</SimpleGrid>
        <Text size="xs" c="dimmed" mt="md">Cohort = volunteers whose first recorded event falls inside the selected range. Recent first-event cohorts are excluded until each retention window matures.</Text>
      </Paper>
      <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Reviewed observations</Title><Badge variant="light">{Number(s?.accepted_insights||0)+Number(s?.accepted_reviews||0)} accepted</Badge></Group>
        <SimpleGrid cols={2} mt="md"><div><Text size="xs" c="dimmed">Accepted insights</Text><Text fz="xl" fw={800}>{Number(s?.accepted_insights||0)}</Text></div><div><Text size="xs" c="dimmed">Accepted reviews</Text><Text fz="xl" fw={800}>{Number(s?.accepted_reviews||0)}</Text></div></SimpleGrid>
        <Text size="xs" c="dimmed" mt="md">Counts use the observation review date, or creation date where no review timestamp exists, within the selected range.</Text>
      </Paper>
    </SimpleGrid>
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-start">
        <div><Title order={4}>Volunteers by programme</Title><Text c="dimmed" size="sm">Unique volunteers who attended in the selected range, grouped by their current programme tags.</Text></div>
        <Badge variant="light">{activeProgrammeCounts.total.toLocaleString()} active volunteers</Badge>
      </Group>
      <SimpleGrid cols={{base:1,sm:2,lg:4}} mt="md">
        {activeProgrammeCounts.rows.map((r)=><Paper key={r.programme} withBorder radius="md" p="md"><Text size="xs" c="dimmed">{r.programme}</Text><Text fz={28} fw={800}>{r.unique_volunteers.toLocaleString()}</Text><Text size="xs" c="dimmed">unique volunteers</Text></Paper>)}
      </SimpleGrid>
      {!dataset.isLoading&&!activeProgrammeCounts.rows.length&&<Text c="dimmed" size="sm" mt="md">No programme-tagged participation in this date range.</Text>}
      <Group gap="lg" mt="md"><Text size="sm"><strong>{activeProgrammeCounts.untagged.toLocaleString()}</strong> active volunteers not tagged to a programme</Text><Text size="sm"><strong>{activeProgrammeCounts.multiple.toLocaleString()}</strong> active volunteers tagged to multiple programmes</Text></Group>
    </Paper>
    <Paper withBorder radius="lg" p="lg"><Title order={4}>Monthly participation</Title><ScrollArea><Table mt="sm" miw={720}>
      <Table.Thead><Table.Tr><Table.Th>Month</Table.Th><Table.Th ta="right">Unique volunteers</Table.Th><Table.Th ta="right">Participations</Table.Th><Table.Th ta="right">2+ events in month</Table.Th><Table.Th ta="right">Historical time</Table.Th><Table.Th ta="right">Approved KELUARGA</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{(report?.monthly||[]).map((r)=><Table.Tr key={r.month}><Table.Td>{new Date(r.month+'T00:00:00').toLocaleDateString('en-SG',{month:'short',year:'numeric'})}</Table.Td><Table.Td ta="right">{r.unique_volunteers}</Table.Td><Table.Td ta="right">{r.event_participations}</Table.Td><Table.Td ta="right">{r.repeat_volunteers}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.historical_credited_minutes))}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.approved_keluarga_minutes))}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></ScrollArea>{!dataset.isLoading&&!report?.monthly.length&&<Text c="dimmed" size="sm" mt="md">No participation has been recorded in this date range.</Text>}</Paper>
    <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Title order={4}>Recorded impact</Title><Badge variant="light">{(report?.impact||[]).length} measures</Badge></Group>
      {(report?.impact||[]).length?<SimpleGrid cols={{base:1,sm:2,lg:3}} mt="md">{(report?.impact||[]).slice(0,9).map((r)=><Paper key={r.label+'::'+(r.unit||'')} withBorder radius="md" p="md"><Text size="xs" c="dimmed">{r.label}</Text><Text fz="xl" fw={800}>{Number(r.total).toLocaleString()} {r.unit||''}</Text><Text size="xs" c="dimmed">{r.event_rows} event metric row{r.event_rows===1?'':'s'}</Text></Paper>)}</SimpleGrid>:<Text c="dimmed" size="sm" mt="md">No event impact metrics have been recorded in this date range.</Text>}
      <Text size="xs" c="dimmed" mt="md">Impact totals are grouped only when both label and unit match; incompatible measures are never combined.</Text>
    </Paper>
    <Paper withBorder radius="lg" p="md"><Group align="flex-end" grow wrap="wrap">
      <TextInput label="Search volunteers" placeholder="Name, email or phone" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);setPage(0);}}/>
      <Select label="Engagement" value={engagement} data={[{value:'all',label:'All volunteers'},{value:'deployed',label:'Deployed in range'},{value:'repeat',label:'Repeat engaged in range'},{value:'active90',label:'Active in last 90 days of range'},{value:'inactive',label:'No attended events in range'}]} onChange={(v)=>{setEngagement((v||'all') as IntelligenceFilters['engagement']);setPage(0);}}/>
      <NumberInput label="Recruited year" placeholder="All years" value={recruitedYear??''} min={1900} max={2100} onChange={(v)=>{setRecruitedYear(typeof v==='number'?v:null);setPage(0);}}/>
      <Select label="Sort" value={sort} data={[{value:'events',label:'Events high-low'},{value:'last-active',label:'Last event newest'},{value:'historical-hours',label:'Historical credited time'},{value:'approved-hours',label:'Approved KELUARGA time'},{value:'name',label:'Name A-Z'}]} onChange={(v)=>setSort((v||'events') as IntelligenceFilters['sort'])}/>
    </Group></Paper>
    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}><ScrollArea><Table striped highlightOnHover verticalSpacing="sm" miw={1250}>
      <Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th><Table.Th ta="right">Events</Table.Th><Table.Th>Engagement</Table.Th><Table.Th>First event</Table.Th><Table.Th>Last event</Table.Th><Table.Th ta="right">Historical time</Table.Th><Table.Th ta="right">Approved KELUARGA</Table.Th><Table.Th ta="right">Reviewed signals</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{pageRows.map((r)=><Table.Tr key={r.core_volunteer_id}><Table.Td><Text fw={700}>{r.name}</Text><Text size="xs" c="dimmed">{r.email||r.phone||'—'}</Text></Table.Td><Table.Td ta="right">{r.event_count}</Table.Td><Table.Td><Group gap={4}>{r.repeat_engaged&&<Badge variant="light">Repeat</Badge>}{r.active_last_90d&&<Badge color="green" variant="light">90d active</Badge>}{!r.event_count&&<Badge color="gray" variant="light">Not deployed in range</Badge>}</Group></Table.Td><Table.Td>{dateLabel(r.first_event_date)}</Table.Td><Table.Td>{dateLabel(r.last_event_date)}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.historical_credited_minutes))}</Table.Td><Table.Td ta="right">{minutesLabel(Number(r.approved_keluarga_minutes))}</Table.Td><Table.Td ta="right">{r.accepted_insights+r.accepted_reviews}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></ScrollArea>{!dataset.isLoading&&!pageRows.length&&<Text c="dimmed" ta="center" p="xl">No volunteers match these filters.</Text>}</Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">{filteredRows.length.toLocaleString()} volunteers · page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={Math.min(page+1,totalPages)} onChange={(v)=>setPage(v-1)}/></Group>
    <Paper withBorder radius="lg" p="lg"><Title order={5}>Counting rules</Title><Stack gap={4} mt="xs"><Text size="sm">Participation = one linked volunteer per deduplicated attended event inside the selected date range.</Text><Text size="sm">Blank From means Start of all time; blank To means End of all time.</Text><Text size="sm">Repeat engagement = at least two distinct attended events inside the selected range.</Text><Text size="sm">Historical credited time and MakLom-approved KELUARGA contribution time remain separate and are filtered by event/contribution date.</Text></Stack></Paper>
  </Stack>;
}
function Metric({label,value,note}:{label:string;value:string;note:string}){return <Paper withBorder radius="lg" p="lg"><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text><Text fz={28} fw={800} mt={6}>{value}</Text><Text size="xs" c="dimmed">{note}</Text></Paper>;}
