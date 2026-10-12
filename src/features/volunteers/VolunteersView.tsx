import { useMemo, useState } from 'react';
import {
  Badge, Button, Checkbox, Group, Loader, Menu, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdvancedVolunteerQueryBuilder } from './AdvancedVolunteerQueryBuilder';
import { fetchVolunteerExportRows, fetchVolunteerFilterOptions, fetchVolunteers } from './api';
import { VolunteerDrawer } from './VolunteerDrawer';
import { createEmptyVolunteerQuery } from './search-types';
import type { VolunteerQueryNode, VolunteerSearchFilters, VolunteerSearchSort } from './search-types';
import type { VolunteerSearchRow } from './search-row';
import type { VolunteerRow } from '../../lib/types';
import { minutesLabel } from '../../lib/utils';

const PAGE_SIZE=50;
const columns=[
  {id:'contact',label:'Contact'},{id:'area',label:'Area'},{id:'grc',label:'GRC / SMC'},
  {id:'gender',label:'Gender'},{id:'dob',label:'Date of birth'},{id:'age',label:'Age'},
  {id:'postal',label:'Postal code'},{id:'qualification',label:'Qualification'},
  {id:'skills',label:'Skills'},{id:'availability',label:'Availability'},
  {id:'recruited',label:'Recruited'},{id:'tags',label:'Tags'},
  {id:'programmes',label:'Programmes'},{id:'attended',label:'Attended'},
  {id:'registered',label:'Registered'},{id:'hours',label:'Hours'},
  {id:'active',label:'Last active'},{id:'mobile_review',label:'Mobile review'},
] as const;
type ColumnId=typeof columns[number]['id'];
const defaultColumns:ColumnId[]=['contact','area','dob','age','programmes','attended','hours','active'];
function cell(row:VolunteerSearchRow,column:ColumnId){
  switch(column){
    case 'contact':return <><Text size="sm">{row.email||'-'}</Text><Text size="xs" c="dimmed">{row.phone||'-'}</Text></>;
    case 'area':return row.neighbourhood||row.planning_area||'-';
    case 'grc':return row.electoral_division||'-';
    case 'gender':return row.gender||'-';
    case 'dob':return row.date_of_birth?new Date(row.date_of_birth+'T00:00:00').toLocaleDateString('en-SG'):'-';
    case 'age':return <><Text size="sm">{row.age??'-'}</Text>{row.age_source==='staff_recorded'?<Text size="xs" c="dimmed">Staff recorded</Text>:null}</>;
    case 'postal':return row.postal_code||'-';
    case 'qualification':return row.highest_qualification||'-';
    case 'skills':return <Text size="sm" lineClamp={2}>{(row.skills||[]).join(', ')||'-'}</Text>;
    case 'availability':return <Text size="sm" lineClamp={2}>{(row.availability_slots||[]).join(', ')||row.preferred_commitment||'-'}</Text>;
    case 'recruited':return row.recruited_year||'-';
    case 'tags':return <Group gap={4}>{(row.tags||[]).slice(0,3).map((tag)=><Badge key={tag} variant="light" size="xs">{tag}</Badge>)}</Group>;
    case 'programmes':return <Text size="sm" lineClamp={2}>{(row.programmes_registered||[]).join(', ')||'-'}</Text>;
    case 'attended':return row.attended_event_count||0;
    case 'registered':return row.registered_event_count||0;
    case 'hours':return minutesLabel(row.total_credited_minutes||0);
    case 'active':return row.last_active?new Date(row.last_active+'T00:00:00').toLocaleDateString('en-SG'):'-';
    case 'mobile_review':return row.mobile_needs_review?<Badge color="orange" variant="light">Review</Badge>:'-';
  }
}

function csvCell(value:unknown){const text=value==null?'':String(value);return `"${text.replaceAll('"','""')}"`;}
function countConditions(node:VolunteerQueryNode):number{
  return node.type==='condition'?1:node.children.reduce((sum,child)=>sum+countConditions(child),0);
}

export function VolunteersView({canWrite,canDelete}:{canWrite:boolean;canDelete:boolean}){
  const qc=useQueryClient();
  const[search,setSearch]=useState('');
  const[debouncedSearch]=useDebouncedValue(search,250);
  const[query,setQuery]=useState(createEmptyVolunteerQuery);
  const[sort,setSort]=useState<VolunteerSearchSort>('name-asc');
  const[page,setPage]=useState(0);
  const[selected,setSelected]=useState<VolunteerRow|null>(null);
  const[exporting,setExporting]=useState(false);
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[visibleColumns,setVisibleColumns]=useState<ColumnId[]>(defaultColumns);
  const activeFilterCount=countConditions(query);

  const filters=useMemo<VolunteerSearchFilters>(()=>({
    search:debouncedSearch,query,sort,page,pageSize:PAGE_SIZE,
  }),[debouncedSearch,query,sort,page]);

  const options=useQuery({
    queryKey:['volunteer-filter-options-v2'],
    queryFn:fetchVolunteerFilterOptions,
    staleTime:5*60_000,
  });
  const volunteers=useQuery({
    queryKey:['volunteers-v2',filters],
    queryFn:()=>fetchVolunteers(filters),
    placeholderData:keepPreviousData,
  });
  const totalPages=Math.max(1,Math.ceil((volunteers.data?.count||0)/PAGE_SIZE));
  const resultRows=(volunteers.data?.rows||[]) as VolunteerSearchRow[];

  function resetPage(){if(page!==0)setPage(0);}
  function clearFilters(){
    setQuery(createEmptyVolunteerQuery());
    setSearch('');
    setSort('name-asc');
    setPage(0);
  }
  async function exportCsv(){
    setExporting(true);
    try{
      const rows=await fetchVolunteerExportRows({...filters,page:0});
      const header=['KEL ID','Name','Email','Phone','Neighbourhood','Planning area','GRC / SMC','Gender','Date of birth','Age','Age source','Postal code','Qualification','Institution','Field of study','Skills','Interests','Availability','Preferred commitment','Mobile discrepancy','Recruited year','Tags','Programmes','Events attended','Events registered','Total hours','First participation','Last active'];
      const lines=[header,...rows.map((row)=>[
        row.volunteer_code,row.name,row.email,row.phone,row.neighbourhood,row.planning_area,row.electoral_division,row.gender,row.date_of_birth,row.age,row.age_source==='date_of_birth'?'Calculated from date of birth':row.age_source==='staff_recorded'?'Staff recorded':'',row.postal_code,row.highest_qualification,row.institution,row.field_of_study,(row.skills||[]).join('; '),(row.profile_interests||[]).join('; '),(row.availability_slots||[]).join('; '),row.preferred_commitment,row.mobile_needs_review?'Needs review':'',row.recruited_year,
        (row.tags||[]).join('; '),(row.programmes_registered||[]).join('; '),row.attended_event_count||0,row.registered_event_count||0,
        ((row.total_credited_minutes||0)/60).toFixed(2),row.first_event_date,row.last_active,
      ])].map((row)=>row.map(csvCell).join(','));
      const blob=new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download='maklom-volunteers-filtered.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    }finally{setExporting(false);}
  }
  async function handleSaved(updated:VolunteerRow){
    setSelected(updated);
    await Promise.all([
      qc.invalidateQueries({queryKey:['volunteers-v2']}),
      qc.invalidateQueries({queryKey:['volunteer-filter-options-v2']}),
      qc.invalidateQueries({queryKey:['dashboard-summary']}),
    ]);
  }
  async function handleDeleted(){
    setSelected(null);
    await Promise.all([
      qc.invalidateQueries({queryKey:['volunteers-v2']}),
      qc.invalidateQueries({queryKey:['volunteer-filter-options-v2']}),
      qc.invalidateQueries({queryKey:['dashboard-summary']}),
      qc.invalidateQueries({queryKey:['volunteer-intelligence']}),
    ]);
  }

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Central Database</Title>
        <Text c="dimmed" size="sm">Search volunteer profiles, participation and data-quality fields across the canonical MakLom database.</Text>
      </div>
      <Group gap="sm">
        <Button variant="default" loading={exporting} onClick={()=>void exportCsv()}>Export filtered CSV</Button>
        <Badge size="lg" variant="light">{(volunteers.data?.count||0).toLocaleString()} matches</Badge>
      </Group>
    </Group>

    <Paper withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group align="flex-end" wrap="wrap">
          <TextInput
            label="Search volunteers"
            placeholder="KEL ID, name, email, phone, area, programme, event, notes or tags"
            value={search}
            onChange={(event)=>{setSearch(event.currentTarget.value);resetPage();}}
            style={{flex:3,minWidth:300}}
          />
          <Select
            label="Sort"
            value={sort}
            data={[
              {value:'name-asc',label:'Name A-Z'},
              {value:'name-desc',label:'Name Z-A'},
              {value:'hours',label:'Total hours high-low'},
              {value:'last-active',label:'Last active newest'},
              {value:'events-attended',label:'Events attended high-low'},
              {value:'events-registered',label:'Events registered high-low'},
              {value:'recruited-year',label:'Recruited year newest'},
              {value:'tag',label:'Tag then name'},
              {value:'newest',label:'Recently updated'},
              {value:'oldest',label:'Least recently updated'},
            ]}
            onChange={(value)=>{setSort((value||'name-asc') as VolunteerSearchSort);resetPage();}}
            style={{minWidth:220}}
          />
          <Menu shadow="md" width={240} closeOnItemClick={false} withinPortal>
            <Menu.Target><Button variant="default">Columns ({visibleColumns.length})</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Choose table columns</Menu.Label>
              {columns.map((column)=><Menu.Item key={column.id} onClick={()=>setVisibleColumns((current)=>current.includes(column.id)?current.filter((id)=>id!==column.id):[...current,column.id])}>
                <Checkbox checked={visibleColumns.includes(column.id)} readOnly label={column.label}/>
              </Menu.Item>)}
              <Menu.Divider/>
              <Menu.Item onClick={()=>setVisibleColumns(defaultColumns)}>Reset columns</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button variant={filtersOpen?'light':'default'} onClick={()=>setFiltersOpen((value)=>!value)}>
            Filters{activeFilterCount? ` (${activeFilterCount})`:''}
          </Button>
          {(activeFilterCount>0||search||sort!=='name-asc')?<Button variant="subtle" onClick={clearFilters}>Clear all</Button>:null}
        </Group>

        <Group gap="xs">
          {activeFilterCount>0?<Badge variant="light">{activeFilterCount} advanced filter{activeFilterCount===1?'':'s'} active</Badge>:null}
          {search?<Badge variant="outline">Quick search active</Badge>:null}
          {volunteers.isFetching&&!volunteers.isLoading?<Text size="xs" c="dimmed">Updating results…</Text>:null}
        </Group>

        {filtersOpen?<Stack gap="xs" mt="xs">
            <Text fw={700}>Advanced query</Text>
            <Text size="sm" c="dimmed">Combine conditions with ALL (AND) or ANY (OR). Groups can be nested for precise database searches.</Text>
            <AdvancedVolunteerQueryBuilder
              query={query}
              options={options.data||{tags:[],programmes:[],genders:[],shirtSizes:[],planningAreas:[],electoralDivisions:[],events:[]}}
              onChange={(next)=>{setQuery(next);resetPage();}}
            />
          </Stack>:null}
      </Stack>
    </Paper>

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md" miw={900}>
          <Table.Thead><Table.Tr><Table.Th>Volunteer</Table.Th>
            {columns.filter((column)=>visibleColumns.includes(column.id)).map((column)=><Table.Th key={column.id}>{column.label}</Table.Th>)}
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {resultRows.map((row)=><Table.Tr key={row.id} onClick={()=>setSelected(row)} style={{cursor:'pointer'}}>
              <Table.Td><Text fw={700}>{row.name}</Text><Text size="xs" c="dimmed">{row.volunteer_code}</Text></Table.Td>
              {columns.filter((column)=>visibleColumns.includes(column.id)).map((column)=><Table.Td key={column.id}>{cell(row,column.id)}</Table.Td>)}
            </Table.Tr>)}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {volunteers.isLoading&&<Group justify="center" p="xl"><Loader size="sm"/></Group>}
      {!volunteers.isLoading&&!resultRows.length&&<Text c="dimmed" ta="center" p="xl">No volunteers match this query.</Text>}
    </Paper>

    <Group justify="space-between">
      <Text size="sm" c="dimmed">Page {page+1} of {totalPages}</Text>
      <Pagination total={totalPages} value={page+1} onChange={(value)=>setPage(value-1)}/>
    </Group>

    <VolunteerDrawer
      volunteer={selected}
      canWrite={canWrite}
      canDelete={canDelete}
      onClose={()=>setSelected(null)}
      onSaved={(row)=>void handleSaved(row)}
      onDeleted={()=>void handleDeleted()}
    />
  </Stack>;
}
