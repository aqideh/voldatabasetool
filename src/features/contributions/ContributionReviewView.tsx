import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Checkbox, Group, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bulkApproveContributions,
  fetchContributionEventSheet,
  fetchContributionReviewEvents,
  setContributionReviewStatus,
  type ContributionEventSheet,
  type ContributionSheetRow,
  type ContributionSheetRowStatus,
} from './api';

type SortKey='status'|'name'|'sign-in'|'sign-out'|'duration';
type SortDirection='asc'|'desc';

function sgTime(value:string|null){
  if(!value)return '—';
  return new Date(value).toLocaleTimeString('en-SG',{
    timeZone:'Asia/Singapore',
    hour:'2-digit',
    minute:'2-digit',
    hour12:true,
  });
}

function sgDate(value:string){
  return new Date(value).toLocaleDateString('en-SG',{
    timeZone:'Asia/Singapore',
    day:'numeric',
    month:'short',
    year:'numeric',
  });
}

function durationLabel(minutes:number|null){
  if(minutes==null)return '—';
  const safe=Math.max(0,Math.round(minutes));
  const hours=Math.floor(safe/60);
  const mins=safe%60;
  return hours?hours+'h '+mins+'m':mins+'m';
}

function durationInput(minutes:number|null){
  if(minutes==null)return '';
  const safe=Math.max(0,Math.round(minutes));
  return Math.floor(safe/60)+':'+String(safe%60).padStart(2,'0');
}

function parseDuration(value:string){
  const text=value.trim();
  if(!text)return null;
  const colon=text.match(/^(\d{1,3}):([0-5]\d)$/);
  if(colon)return Number(colon[1])*60+Number(colon[2]);
  const minutes=text.match(/^(\d{1,5})$/);
  if(minutes)return Number(minutes[1]);
  return null;
}

function statusRank(status:ContributionSheetRowStatus){
  if(status==='attended')return 0;
  if(status==='checked_in')return 1;
  if(status==='no_record')return 2;
  if(status==='withdrawn')return 3;
  return 4;
}

function statusBadge(status:ContributionSheetRowStatus){
  if(status==='attended')return <Badge color="green" variant="light">Attended</Badge>;
  if(status==='checked_in')return <Badge color="blue" variant="light">Checked in</Badge>;
  if(status==='withdrawn')return <Badge color="gray" variant="light">Withdrawn</Badge>;
  if(status==='absent')return <Badge color="red" variant="light">Absent</Badge>;
  return <Badge color="yellow" variant="light">No attendance</Badge>;
}

function sortRows(rows:ContributionSheetRow[],sortKey:SortKey,direction:SortDirection){
  const factor=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    if(sortKey==='status'){
      const rank=statusRank(a.status)-statusRank(b.status);
      return rank!==0?rank:a.volunteer_name.localeCompare(b.volunteer_name);
    }
    if(sortKey==='name')return factor*a.volunteer_name.localeCompare(b.volunteer_name);
    if(sortKey==='sign-in')return factor*((a.sign_in_at||'').localeCompare(b.sign_in_at||''));
    if(sortKey==='sign-out')return factor*((a.sign_out_at||'').localeCompare(b.sign_out_at||''));
    return factor*((a.operational_minutes||0)-(b.operational_minutes||0));
  });
}

function isPrimaryContributionRow(row:ContributionSheetRow){
  return Boolean(
    row.contribution_id
    && row.session_id
    && row.session_origin_roster_id===row.roster_id
  );
}

export function ContributionReviewView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();
  const events=useQuery({queryKey:['contribution-review-events'],queryFn:fetchContributionReviewEvents});
  const[eventId,setEventId]=useState<string|null>(null);
  const[shiftId,setShiftId]=useState<string>('all');
  const[sortKey,setSortKey]=useState<SortKey>('status');
  const[sortDirection,setSortDirection]=useState<SortDirection>('asc');
  const[selected,setSelected]=useState<Set<string>>(new Set());
  const[adjusted,setAdjusted]=useState<Record<string,string>>({});
  const[message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const[busy,setBusy]=useState(false);

  useEffect(()=>{
    if(eventId||!events.data?.length)return;
    const firstWithPending=events.data.find((event)=>event.pending_count>0)||events.data[0];
    if(firstWithPending)setEventId(firstWithPending.id);
  },[events.data,eventId]);

  const sheet=useQuery({
    queryKey:['contribution-event-sheet',eventId],
    queryFn:()=>fetchContributionEventSheet(eventId!),
    enabled:Boolean(eventId),
  });

  useEffect(()=>{
    setShiftId('all');
    setSelected(new Set());
    setAdjusted({});
    setMessage(null);
  },[eventId]);

  useEffect(()=>{
    if(!sheet.data)return;
    const nextAdjusted:Record<string,string>={};
    const nextSelected=new Set<string>();
    for(const row of sheet.data.rows){
      if(!isPrimaryContributionRow(row)||!row.contribution_id)continue;
      nextAdjusted[row.contribution_id]=durationInput(row.approved_minutes??row.operational_minutes);
      if(canWrite&&row.status==='attended'&&(row.contribution_status==='pending'||row.contribution_status==='needs_review')){
        nextSelected.add(row.contribution_id);
      }
    }
    setAdjusted(nextAdjusted);
    setSelected(nextSelected);
  },[sheet.data,canWrite]);

  const shiftOptions=useMemo(()=>{
    const base=[{value:'all',label:'All shifts'}];
    for(const shift of sheet.data?.shifts||[]){
      base.push({value:shift.id,label:(shift.label?.trim()||'Shift')+' · '+sgDate(shift.starts_at)});
    }
    return base;
  },[sheet.data?.shifts]);

  const shiftById=useMemo(()=>new Map((sheet.data?.shifts||[]).map((shift)=>[shift.id,shift])),[sheet.data?.shifts]);

  const visibleRows=useMemo(()=>{
    const rows=(sheet.data?.rows||[]).filter((row)=>shiftId==='all'||row.timeslot_id===shiftId);
    return sortRows(rows,sortKey,sortDirection);
  },[sheet.data?.rows,shiftId,sortKey,sortDirection]);

  const eligibleVisible=useMemo(()=>visibleRows.filter((row)=>
    isPrimaryContributionRow(row)
    && row.contribution_id
    && row.status==='attended'
    && (row.contribution_status==='pending'||row.contribution_status==='needs_review')
  ),[visibleRows]);

  const selectedEligible=eligibleVisible.filter((row)=>row.contribution_id&&selected.has(row.contribution_id));

  function toggleAllVisible(checked:boolean){
    const next=new Set(selected);
    for(const row of eligibleVisible){
      if(!row.contribution_id)continue;
      if(checked)next.add(row.contribution_id);
      else next.delete(row.contribution_id);
    }
    setSelected(next);
  }

  function toggleRow(id:string,checked:boolean){
    const next=new Set(selected);
    if(checked)next.add(id); else next.delete(id);
    setSelected(next);
  }

  function changeSort(next:SortKey){
    if(sortKey===next)setSortDirection((current)=>current==='asc'?'desc':'asc');
    else{
      setSortKey(next);
      setSortDirection(next==='duration'?'desc':'asc');
    }
  }

  async function refresh(){
    await Promise.all([
      qc.invalidateQueries({queryKey:['contribution-event-sheet']}),
      qc.invalidateQueries({queryKey:['contribution-review-events']}),
      qc.invalidateQueries({queryKey:['work-summary']}),
      qc.invalidateQueries({queryKey:['intelligence-summary']}),
      qc.invalidateQueries({queryKey:['volunteer-intelligence']}),
    ]);
  }

  async function approveSelected(){
    if(!eventId||!selectedEligible.length)return;
    const items:Array<{id:string;approved_minutes:number;expected_updated_at:string}>=[];
    for(const row of selectedEligible){
      if(!row.contribution_id||!row.contribution_updated_at)continue;
      const minutes=parseDuration(adjusted[row.contribution_id]||'');
      if(minutes==null){
        setMessage({kind:'error',text:'Enter adjusted time as H:MM or total minutes for '+row.volunteer_name+'.'});
        return;
      }
      items.push({
        id:row.contribution_id,
        approved_minutes:minutes,
        expected_updated_at:row.contribution_updated_at,
      });
    }
    if(!items.length)return;

    setBusy(true);setMessage(null);
    try{
      const result=await bulkApproveContributions({
        eventId,
        items,
        note:'Bulk confirmed in MakLom contribution review sheet',
      });
      setMessage({kind:'success',text:'Approved '+result.approved_count+' contribution record'+(result.approved_count===1?'':'s')+'.'});
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not confirm selected contributions.'});
    }finally{setBusy(false);}
  }

  async function markRow(row:ContributionSheetRow,status:'needs_review'|'rejected'){
    if(!row.contribution_id)return;
    setBusy(true);setMessage(null);
    try{
      await setContributionReviewStatus({
        id:row.contribution_id,
        status,
        note:status==='rejected'?'Rejected in contribution review sheet':'Marked for review in contribution review sheet',
      });
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not update contribution.'});
    }finally{setBusy(false);}
  }

  const eventOptions=(events.data||[]).map((event)=>({
    value:event.id,
    label:event.title+(event.pending_count?' · '+event.pending_count+' pending':''),
  }));

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Contribution Review</Title>
        <Text c="dimmed" size="sm">Review the full roster by event and shift, adjust contributed time, then confirm eligible attendance in bulk.</Text>
      </div>
      <Group gap="xs">
        <Badge color={eligibleVisible.length?'blue':'gray'} variant="light">{eligibleVisible.length} eligible in view</Badge>
        <Badge color={selectedEligible.length?'green':'gray'} variant="light">{selectedEligible.length} selected</Badge>
      </Group>
    </Group>

    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}
    {events.isError&&<Alert color="red">Events could not be loaded. {events.error instanceof Error?events.error.message:''}</Alert>}
    {sheet.isError&&<Alert color="red">Contribution sheet could not be loaded. {sheet.error instanceof Error?sheet.error.message:''}</Alert>}

    <Paper withBorder radius="lg" p="md">
      <Group align="flex-end" wrap="wrap">
        <Select
          label="Event"
          placeholder="Choose event"
          searchable
          w={{base:'100%',md:420}}
          data={eventOptions}
          value={eventId}
          onChange={setEventId}
        />
        <Select
          label="Shift"
          w={{base:'100%',sm:300}}
          data={shiftOptions}
          value={shiftId}
          onChange={(value)=>setShiftId(value||'all')}
          disabled={!sheet.data}
        />
        <Select
          label="Sort"
          w={210}
          value={sortKey}
          data={[
            {value:'status',label:'Attendance status'},
            {value:'name',label:'Volunteer name'},
            {value:'sign-in',label:'Sign-in time'},
            {value:'sign-out',label:'Sign-out time'},
            {value:'duration',label:'Contributed time'},
          ]}
          onChange={(value)=>setSortKey((value||'status') as SortKey)}
        />
        <Button variant="subtle" onClick={()=>setSortDirection((current)=>current==='asc'?'desc':'asc')}>
          {sortDirection==='asc'?'Ascending':'Descending'}
        </Button>
      </Group>
      {sheet.data&&<Text size="xs" c="dimmed" mt="sm">
        {sheet.data.event.title} · {sheet.data.event.venue||'Venue not recorded'} · {sheet.data.rows.length} roster assignment{sheet.data.rows.length===1?'':'s'}
      </Text>}
    </Paper>

    <Paper withBorder radius="lg" p={0} style={{overflow:'hidden'}}>
      <ScrollArea type="auto" scrollbarSize={10}>
        <Table
          withColumnBorders
          highlightOnHover
          verticalSpacing={5}
          horizontalSpacing="sm"
          miw={1450}
          style={{fontVariantNumeric:'tabular-nums'}}
        >
          <Table.Thead style={{position:'sticky',top:0,zIndex:2,background:'var(--mantine-color-body)'}}>
            <Table.Tr>
              <Table.Th w={42}>
                <Checkbox
                  aria-label="Select all eligible rows in view"
                  checked={eligibleVisible.length>0&&selectedEligible.length===eligibleVisible.length}
                  indeterminate={selectedEligible.length>0&&selectedEligible.length<eligibleVisible.length}
                  disabled={!canWrite||!eligibleVisible.length}
                  onChange={(event)=>toggleAllVisible(event.currentTarget.checked)}
                />
              </Table.Th>
              <Table.Th onClick={()=>changeSort('name')} style={{cursor:'pointer'}}>Volunteer</Table.Th>
              <Table.Th onClick={()=>changeSort('status')} style={{cursor:'pointer'}}>Status</Table.Th>
              <Table.Th>Shift</Table.Th>
              <Table.Th>Scheduled start</Table.Th>
              <Table.Th>Scheduled end</Table.Th>
              <Table.Th onClick={()=>changeSort('sign-in')} style={{cursor:'pointer'}}>Sign in</Table.Th>
              <Table.Th onClick={()=>changeSort('sign-out')} style={{cursor:'pointer'}}>Sign out</Table.Th>
              <Table.Th onClick={()=>changeSort('duration')} style={{cursor:'pointer'}}>Contributed</Table.Th>
              <Table.Th w={140}>Adjusted</Table.Th>
              <Table.Th>Review</Table.Th>
              <Table.Th w={160}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibleRows.map((row)=>{
              const shift=shiftById.get(row.timeslot_id);
              const primary=isPrimaryContributionRow(row);
              const eligible=Boolean(
                primary
                && row.contribution_id
                && row.status==='attended'
                && (row.contribution_status==='pending'||row.contribution_status==='needs_review')
              );
              const checked=Boolean(row.contribution_id&&selected.has(row.contribution_id));
              const shared=Boolean(row.session_id&&row.shared_shift_count>1);
              return <Table.Tr key={row.roster_id}>
                <Table.Td>
                  <Checkbox
                    checked={checked}
                    disabled={!canWrite||!eligible||!row.contribution_id}
                    onChange={(event)=>row.contribution_id&&toggleRow(row.contribution_id,event.currentTarget.checked)}
                    aria-label={'Select '+row.volunteer_name}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>{row.volunteer_name}</Text>
                  <Text size="xs" c="dimmed">{row.volunteer_code||row.email||row.mobile||'—'}</Text>
                </Table.Td>
                <Table.Td>{statusBadge(row.status)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{shift?.label||'Shift'}</Text>
                  {shared&&<Text size="xs" c="dimmed">Shared session · {row.shared_shift_labels.join(', ')}</Text>}
                </Table.Td>
                <Table.Td>{shift?sgTime(shift.starts_at):'—'}</Table.Td>
                <Table.Td>{shift?sgTime(shift.ends_at):'—'}</Table.Td>
                <Table.Td>{sgTime(row.sign_in_at)}</Table.Td>
                <Table.Td>{sgTime(row.sign_out_at)}</Table.Td>
                <Table.Td>
                  {primary
                    ? <Text fw={600}>{durationLabel(row.operational_minutes)}</Text>
                    : shared
                      ? <Text size="xs" c="dimmed">Included in shared session</Text>
                      : <Text c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td>
                  {primary&&row.contribution_id
                    ? <TextInput
                        size="xs"
                        value={adjusted[row.contribution_id]??durationInput(row.approved_minutes??row.operational_minutes)}
                        disabled={!canWrite||row.status!=='attended'}
                        onChange={(event)=>setAdjusted((current)=>({...current,[row.contribution_id!]:event.currentTarget.value}))}
                        placeholder="H:MM"
                        styles={{input:{textAlign:'right',fontVariantNumeric:'tabular-nums'}}}
                      />
                    : <Text c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td>
                  {row.contribution_status
                    ? <Badge
                        variant="light"
                        color={row.contribution_status==='approved'?'green':row.contribution_status==='rejected'?'red':row.contribution_status==='needs_review'?'orange':'blue'}
                      >{row.contribution_status.replace('_',' ')}</Badge>
                    : <Text size="xs" c="dimmed">{row.status==='attended'?'Contribution unavailable':'Not creditable'}</Text>}
                </Table.Td>
                <Table.Td>
                  {canWrite&&primary&&row.contribution_id&&<Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="subtle" color="orange" disabled={busy} onClick={()=>void markRow(row,'needs_review')}>Review</Button>
                    <Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={()=>void markRow(row,'rejected')}>Reject</Button>
                  </Group>}
                </Table.Td>
              </Table.Tr>;
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {!sheet.isLoading&&!visibleRows.length&&<Text c="dimmed" ta="center" p="xl">No roster rows match this event and shift.</Text>}
    </Paper>

    <Paper withBorder radius="lg" p="md" style={{position:'sticky',bottom:12,zIndex:3}}>
      <Group justify="space-between" align="center">
        <div>
          <Text fw={700}>{selectedEligible.length} contribution{selectedEligible.length===1?'':'s'} selected</Text>
          <Text size="xs" c="dimmed">Adjusted time accepts H:MM or total minutes. Only attended rows with a contribution record can be bulk confirmed.</Text>
        </div>
        <Group>
          <Button variant="light" disabled={!eligibleVisible.length||busy} onClick={()=>toggleAllVisible(true)}>Select eligible</Button>
          <Button
            disabled={!canWrite||!selectedEligible.length}
            loading={busy}
            onClick={()=>void approveSelected()}
          >Confirm selected</Button>
        </Group>
      </Group>
    </Paper>

    <Alert variant="light">
      Continuous attendance is credited once per attendance session. If a volunteer stayed across adjacent shifts, the linked shift rows remain visible for comparison but only the session's originating row is editable and confirmable.
    </Alert>
  </Stack>;
}
