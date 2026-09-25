import { useMemo, useState } from 'react';
import {
  Badge, Group, Loader, NumberInput, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchVolunteerFilterOptions, fetchVolunteers } from './api';
import { VolunteerDrawer } from './VolunteerDrawer';
import type { VolunteerFilters, VolunteerRow } from '../../lib/types';
import { minutesLabel } from '../../lib/utils';

const PAGE_SIZE=50;

export function VolunteersView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();
  const[search,setSearch]=useState('');const[debouncedSearch]=useDebouncedValue(search,250);
  const[tag,setTag]=useState<string|null>(null);const[year,setYear]=useState<number|null>(null);
  const[gender,setGender]=useState<string|null>(null);const[shirtSize,setShirtSize]=useState<string|null>(null);
  const[activity,setActivity]=useState<VolunteerFilters['activity']>('all');
  const[sort,setSort]=useState<VolunteerFilters['sort']>('name-asc');
  const[page,setPage]=useState(0);const[selected,setSelected]=useState<VolunteerRow|null>(null);
  const filters=useMemo<VolunteerFilters>(()=>({search:debouncedSearch,tag,recruitedYear:year,gender,shirtSize,activity,sort,page,pageSize:PAGE_SIZE}),[debouncedSearch,tag,year,gender,shirtSize,activity,sort,page]);
  const options=useQuery({queryKey:['volunteer-filter-options'],queryFn:fetchVolunteerFilterOptions,staleTime:5*60_000});
  const volunteers=useQuery({queryKey:['volunteers',filters],queryFn:()=>fetchVolunteers(filters),placeholderData:keepPreviousData});
  const totalPages=Math.max(1,Math.ceil((volunteers.data?.count||0)/PAGE_SIZE));
  function resetPage(){if(page!==0)setPage(0);}
  async function handleSaved(updated:VolunteerRow){setSelected(updated);await Promise.all([
    qc.invalidateQueries({queryKey:['volunteers']}),qc.invalidateQueries({queryKey:['volunteer-filter-options']}),qc.invalidateQueries({queryKey:['dashboard-summary']})
  ]);}

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div><Title order={2}>Central Database</Title><Text c="dimmed" size="sm">Search the full volunteer database with the filters and activity signals from the previous MakLom dashboard.</Text></div>
      <Badge size="lg" variant="light">{(volunteers.data?.count||0).toLocaleString()} matches</Badge>
    </Group>
    <Paper withBorder radius="lg" p="md">
      <Group align="flex-end" grow wrap="wrap">
        <TextInput label="Search" placeholder="KEL ID, name, phone, email, address, programme, notes or tags" value={search} onChange={(e)=>{setSearch(e.currentTarget.value);resetPage();}}/>
        <Select label="Tag" placeholder="All tags" clearable searchable data={options.data?.tags||[]} value={tag} onChange={(v)=>{setTag(v);resetPage();}}/>
        <Select label="Gender" placeholder="All genders" clearable data={options.data?.genders||[]} value={gender} onChange={(v)=>{setGender(v);resetPage();}}/>
        <Select label="T-shirt" placeholder="All sizes" clearable data={options.data?.shirtSizes||[]} value={shirtSize} onChange={(v)=>{setShirtSize(v);resetPage();}}/>
        <Select label="Activity" value={activity} data={[{value:'all',label:'All volunteers'},{value:'active',label:'Has attendance'},{value:'inactive',label:'No attendance'}]} onChange={(v)=>{setActivity((v||'all') as VolunteerFilters['activity']);resetPage();}}/>
        <NumberInput label="Recruited year" placeholder="All years" value={year??''} min={1900} max={2100} onChange={(v)=>{setYear(typeof v==='number'?v:null);resetPage();}}/>
        <Select label="Sort" value={sort} data={[
          {value:'name-asc',label:'Name A-Z'},{value:'name-desc',label:'Name Z-A'},{value:'tag',label:'Tag then name'},
          {value:'hours',label:'Total hours high-low'},{value:'last-active',label:'Last active newest'},
          {value:'newest',label:'Recently updated'},{value:'oldest',label:'Least recently updated'}
        ]} onChange={(v)=>{setSort((v||'name-asc') as VolunteerFilters['sort']);resetPage();}}/>
      </Group>
    </Paper>

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md" miw={1200}>
          <Table.Thead><Table.Tr>
            <Table.Th>Name</Table.Th><Table.Th>Contact</Table.Th><Table.Th>Gender</Table.Th><Table.Th>Recruited</Table.Th>
            <Table.Th>Tags</Table.Th><Table.Th>Programmes</Table.Th><Table.Th>Hours</Table.Th><Table.Th>Last active</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {(volunteers.data?.rows||[]).map((row)=><Table.Tr key={row.id} onClick={()=>setSelected(row)} style={{cursor:'pointer'}}>
              <Table.Td><Text fw={700}>{row.name}</Text><Text size="xs" c="dimmed">{row.volunteer_code}</Text></Table.Td>
              <Table.Td><Text size="sm">{row.email||'-'}</Text><Text size="xs" c="dimmed">{row.phone||'-'}</Text></Table.Td>
              <Table.Td>{row.gender||'-'}</Table.Td><Table.Td>{row.recruited_year||'-'}</Table.Td>
              <Table.Td><Group gap={4} wrap="wrap">{(row.tags||[]).slice(0,4).map((item)=><Badge key={item} variant="light" size="sm">{item}</Badge>)}</Group></Table.Td>
              <Table.Td><Text size="sm" lineClamp={2}>{(row.programmes_registered||[]).join(', ')||'-'}</Text></Table.Td>
              <Table.Td>{minutesLabel(row.total_credited_minutes||0)}</Table.Td>
              <Table.Td>{row.last_active?new Date(row.last_active+'T00:00:00').toLocaleDateString('en-SG'):'-'}</Table.Td>
            </Table.Tr>)}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {volunteers.isLoading&&<Group justify="center" p="xl"><Loader size="sm"/></Group>}
      {!volunteers.isLoading&&!volunteers.data?.rows.length&&<Text c="dimmed" ta="center" p="xl">No volunteers match these filters.</Text>}
    </Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text><Pagination total={totalPages} value={page+1} onChange={(v)=>setPage(v-1)}/></Group>
    <VolunteerDrawer volunteer={selected} canWrite={canWrite} onClose={()=>setSelected(null)} onSaved={(row)=>void handleSaved(row)}/>
  </Stack>;
}