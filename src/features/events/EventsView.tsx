import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Group, Modal, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack,
  Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctEventAttendance,
  createEvent,
  createMetric,
  createShift,
  deleteEvent,
  deleteMetric,
  deleteShift,
  fetchEventAudit,
  fetchEventPeople,
  fetchEventsBundle,
  fetchStagedIdentityCandidates,
  pairStagedAttendance,
  resolveStagedIdentity,
  reviewStagedAttendance,
  setRosterOperationalOverride,
  updateEvent,
} from './api';
import type { AttendanceRow, EventRow, EventShiftRow, HistoricalAttendanceImportRow } from '../../lib/types';
import type { EventRosterDetailRow, StagedIdentityCandidate } from './api';

interface Props { canWrite: boolean; canDelete: boolean; }

const REASON_OPTIONS=[
  {value:'system_outage',label:'System outage'},
  {value:'walk_in_adjustment',label:'Walk-in adjustment'},
  {value:'staff_correction',label:'Staff correction'},
  {value:'historical_import',label:'Historical import'},
  {value:'volunteer_request',label:'Volunteer request'},
  {value:'event_logistics',label:'Event logistics'},
  {value:'other',label:'Other'},
];

function sgDateTime(value:string|null|undefined) {
  if(!value)return '—';
  return new Date(value).toLocaleString('en-SG',{timeZone:'Asia/Singapore'});
}

function dateTimeLocalValue(value:string|null|undefined) {
  if(!value)return '';
  const shifted=new Date(new Date(value).getTime()+8*60*60*1000).toISOString();
  return shifted.slice(0,16);
}

function fromSingaporeLocal(value:string) {
  if(!value)return null;
  return value+':00+08:00';
}

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
      qc.invalidateQueries({ queryKey: ['event-people'] }),
      qc.invalidateQueries({ queryKey: ['event-audit'] }),
      qc.invalidateQueries({ queryKey: ['attendance'] }),
      qc.invalidateQueries({ queryKey: ['historical-attendance'] }),
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
        <Text c="dimmed" size="sm">Staff event workspaces across Keluarga operations and MakLom history.</Text>
      </div>
      <Badge size="lg" variant="light">{query.data?.events.length || 0} events</Badge>
    </Group>

    {message && <Alert color="red" variant="light">{message}</Alert>}
    {query.isError && <Alert color="red" variant="light">
      Events could not be loaded. {query.error instanceof Error ? query.error.message : 'Please refresh and try again.'}
    </Alert>}

    {canWrite && <Paper withBorder radius="lg" p="md">
      <form onSubmit={(event) => { event.preventDefault(); void addEvent(event.currentTarget); }}>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <TextInput name="name" label="Historical / MakLom event name" required />
            <TextInput name="start" label="Start date" type="date" required />
            <TextInput name="end" label="End date" type="date" />
            <TextInput name="programme" label="Programme / category" />
            <TextInput name="venue" label="Venue" />
            <TextInput name="notes" label="Notes" />
          </SimpleGrid>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Use this only for standalone historical MakLom events. Keluarga operational events are created in Keluarga.</Text>
            <Button type="submit" loading={creating}>Create MakLom event</Button>
          </Group>
        </Stack>
      </form>
    </Paper>}

    <Paper withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Event</Table.Th><Table.Th>Dates</Table.Th><Table.Th>Programme</Table.Th><Table.Th>Venue</Table.Th><Table.Th>Shifts</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(query.data?.events || []).map((event) => <Table.Tr key={event.id} onClick={() => { setSelectedId(event.id); open(); }} style={{ cursor: 'pointer' }}>
            <Table.Td>
              <Group gap="xs">
                <Text fw={700}>{event.name}</Text>
                {event.source === 'keluarga' && <Badge size="xs" variant="light">Keluarga</Badge>}
              </Group>
              <Text size="xs" c="dimmed">{event.status}</Text>
            </Table.Td>
            <Table.Td>{event.start_date}{event.end_date !== event.start_date ? ' – '+event.end_date : ''}</Table.Td>
            <Table.Td>{event.programme || '-'}</Table.Td>
            <Table.Td>{event.venue || '-'}</Table.Td>
            <Table.Td>{query.data?.shifts.filter((shift) => shift.event_id === event.id).length || 0}</Table.Td>
          </Table.Tr>)}
        </Table.Tbody>
      </Table>
      {!query.isLoading && !query.isError && !query.data?.events.length && <Text c="dimmed" ta="center" p="xl">No events found.</Text>}
    </Paper>

    <Modal opened={opened} onClose={close} title={selected?.name || 'Event'} size="calc(100vw - 40px)">
      {selected && (selected.source==='keluarga'
        ? <KeluargaEventWorkspace event={selected} shifts={shifts} canWrite={canWrite} onRefresh={refresh}/>
        : <LegacyEventEditor
            event={selected}
            shifts={shifts}
            metrics={metrics}
            canWrite={canWrite}
            canDelete={canDelete}
            onRefresh={refresh}
            onDeleted={() => { setSelectedId(null); close(); void refresh(); }}
          />)}
    </Modal>
  </Stack>;
}

type StagedShiftResolution = {
  safe:boolean;
  timeslotId:string|null;
  candidateTimeslotIds:string[];
  reason:string;
};

function singaporeShiftWindow(shift:EventShiftRow) {
  if(!shift.keluarga_timeslot_id||!shift.shift_date||!shift.start_time)return null;
  const start=Date.parse(shift.shift_date+'T'+shift.start_time.slice(0,8)+'+08:00');
  if(!Number.isFinite(start))return null;
  let end=Number.POSITIVE_INFINITY;
  if(shift.end_time){
    end=Date.parse(shift.shift_date+'T'+shift.end_time.slice(0,8)+'+08:00');
    if(Number.isFinite(end)&&end<=start)end+=24*60*60*1000;
  }
  return {timeslotId:shift.keluarga_timeslot_id,start,end};
}

function resolveStagedShift(
  row:HistoricalAttendanceImportRow,
  shifts:EventShiftRow[],
  roster:EventRosterDetailRow[],
):StagedShiftResolution {
  if(!row.matched_core_volunteer_id){
    return {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'Resolve the volunteer first.'};
  }
  if(!row.source_sign_in_at){
    return {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'No usable source sign-in time.'};
  }

  const signIn=new Date(row.source_sign_in_at).getTime();
  if(!Number.isFinite(signIn)){
    return {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'The source sign-in time is invalid.'};
  }

  const windows=shifts
    .filter((shift)=>shift.shift_date===row.event_date&&Boolean(shift.keluarga_timeslot_id))
    .map(singaporeShiftWindow)
    .filter((window):window is NonNullable<ReturnType<typeof singaporeShiftWindow>>=>Boolean(window));

  if(row.source_feedback_at){
    const checkOut=new Date(row.source_feedback_at).getTime();
    if(!Number.isFinite(checkOut)||checkOut<signIn){
      return {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'The source check-out is before the sign-in time.'};
    }
    const overlapping=windows.filter((window)=>window.start<checkOut&&window.end>signIn);
    return overlapping.length
      ? {safe:true,timeslotId:null,candidateTimeslotIds:overlapping.map((window)=>window.timeslotId),reason:'Source sign-in/check-out interval resolves to the event shifts.'}
      : {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'No event shift overlaps the source attendance interval.'};
  }

  const containing=windows.filter((window)=>window.start<=signIn&&signIn<window.end);
  if(containing.length===1){
    return {safe:true,timeslotId:containing[0].timeslotId,candidateTimeslotIds:[containing[0].timeslotId],reason:'Source sign-in resolves to one event shift.'};
  }
  if(containing.length>1){
    const rostered=containing.filter((window)=>roster.some((assignment)=>
      assignment.volunteer_id===row.matched_core_volunteer_id&&assignment.timeslot_id===window.timeslotId
    ));
    if(rostered.length===1){
      return {safe:true,timeslotId:rostered[0].timeslotId,candidateTimeslotIds:containing.map((window)=>window.timeslotId),reason:'Overlapping shift resolved from the existing roster assignment.'};
    }
    return {
      safe:false,
      timeslotId:null,
      candidateTimeslotIds:containing.map((window)=>window.timeslotId),
      reason:rostered.length>1
        ? 'The sign-in time overlaps multiple shifts and the volunteer is rostered to more than one. Choose the correct shift.'
        : 'The sign-in time overlaps multiple shifts. Choose the correct shift.',
    };
  }

  return {safe:false,timeslotId:null,candidateTimeslotIds:[],reason:'No event shift contains the source sign-in time.'};
}

function KeluargaEventWorkspace({event,shifts,canWrite,onRefresh}:any) {
  const qc=useQueryClient();
  const [message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [overrideRow,setOverrideRow]=useState<EventRosterDetailRow|null>(null);
  const [attendanceRow,setAttendanceRow]=useState<AttendanceRow|null>(null);
  const [identityRow,setIdentityRow]=useState<HistoricalAttendanceImportRow|null>(null);
  const [manualShiftByRow,setManualShiftByRow]=useState<Record<string,string>>({});

  const people=useQuery({
    queryKey:['event-people',event.id],
    queryFn:()=>fetchEventPeople(event),
  });
  const audit=useQuery({
    queryKey:['event-audit',event.id],
    queryFn:()=>fetchEventAudit(event),
  });

  const eventId=event.keluarga_event_id||event.id.replace(/^keluarga:/,'');
  const pending=(people.data?.staged||[]).filter((row)=>row.decision==='pending');

  const pairProposals=useMemo(()=>{
    const grouped=new Map<string,HistoricalAttendanceImportRow[]>();
    for(const row of pending){
      if(!row.matched_core_volunteer_id||!row.review_flags?.includes('reused_signin_pair_candidate'))continue;
      const key=row.matched_core_volunteer_id+'|'+row.event_date;
      grouped.set(key,[...(grouped.get(key)||[]),row]);
    }
    return [...grouped.values()].flatMap((rows)=>{
      const sorted=rows
        .filter((row)=>row.source_sign_in_at)
        .sort((a,b)=>new Date(a.source_sign_in_at!).getTime()-new Date(b.source_sign_in_at!).getTime());
      if(sorted.length!==2)return [];
      const durationMinutes=Math.round((new Date(sorted[1].source_sign_in_at!).getTime()-new Date(sorted[0].source_sign_in_at!).getTime())/60000);
      if(durationMinutes<15||durationMinutes>960)return [];
      return [{checkIn:sorted[0],checkOut:sorted[1],durationMinutes}];
    });
  },[pending]);

  const pairedPendingIds=new Set(pairProposals.flatMap((pair)=>[pair.checkIn.id,pair.checkOut.id]));
  const standalonePending=pending.filter((row)=>!pairedPendingIds.has(row.id));
  const reviewRequiredCount=pairProposals.length+standalonePending.length;

  const shiftResolutionByRow=useMemo(()=>new Map(
    standalonePending.map((row)=>[
      row.id,
      resolveStagedShift(row,shifts as EventShiftRow[],people.data?.roster||[]),
    ])
  ),[standalonePending,shifts,people.data?.roster]);

  const safePending=standalonePending.flatMap((row)=>{
    const resolution=shiftResolutionByRow.get(row.id);
    return resolution?.safe?[{row,timeslotId:resolution.timeslotId}]:[];
  });

  async function reload() {
    await Promise.all([
      qc.invalidateQueries({queryKey:['event-people',event.id]}),
      qc.invalidateQueries({queryKey:['event-audit',event.id]}),
      onRefresh(),
    ]);
  }

  async function review(row:HistoricalAttendanceImportRow,decision:'accept'|'reject',timeslotId?:string|null) {
    setBusy(true);setMessage(null);
    try{
      await reviewStagedAttendance({
        rowId:row.id,
        expectedVersion:row.row_version,
        decision,
        keluargaEventId:eventId,
        keluargaTimeslotId:timeslotId??null,
        targetCoreVolunteerId:row.matched_core_volunteer_id,
        reasonNote:decision==='accept'?'Reviewed in MakLom event workspace':'Rejected in MakLom event workspace',
      });
      setMessage({kind:'success',text:decision==='accept'?'Attendance accepted.':'Staged row rejected.'});
      await reload();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not review this staged row.'});
    }finally{setBusy(false);}
  }

  async function confirmPair(pair:{checkIn:HistoricalAttendanceImportRow;checkOut:HistoricalAttendanceImportRow;durationMinutes:number}) {
    setBusy(true);setMessage(null);
    try{
      await pairStagedAttendance({
        checkInRowId:pair.checkIn.id,
        checkInExpectedVersion:pair.checkIn.row_version,
        checkOutRowId:pair.checkOut.id,
        checkOutExpectedVersion:pair.checkOut.row_version,
        keluargaEventId:eventId,
        reasonNote:'Confirmed paired check-in/check-out because the sign-in form was reused for sign-out',
      });
      setMessage({kind:'success',text:'Attendance pair confirmed for '+pair.checkIn.full_name+'.'});
      await reload();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not confirm this attendance pair.'});
    }finally{setBusy(false);}
  }

  async function acceptSafe() {
    if(!safePending.length)return;
    setBusy(true);setMessage(null);
    let accepted=0;
    const failures:string[]=[];
    try{
      for(const candidate of safePending){
        const {row,timeslotId}=candidate;
        try{
          await reviewStagedAttendance({
            rowId:row.id,
            expectedVersion:row.row_version,
            decision:'accept',
            keluargaEventId:eventId,
            keluargaTimeslotId:timeslotId,
            targetCoreVolunteerId:row.matched_core_volunteer_id,
            reasonNote:'Bulk-approved safe attendance in MakLom event workspace',
          });
          accepted+=1;
        }catch(error){
          failures.push(row.full_name+': '+(error instanceof Error?error.message:'Could not accept this row.'));
        }
      }
      await reload();
      if(failures.length){
        const examples=failures.slice(0,3).join(' · ');
        setMessage({
          kind:'error',
          text:'Accepted '+accepted+' safe row'+(accepted===1?'':'s')+'. '+failures.length+' row'+(failures.length===1?'':'s')+' still need review. '+examples+(failures.length>3?' · …':''),
        });
      }else{
        setMessage({kind:'success',text:'Accepted '+accepted+' safe staged attendance row'+(accepted===1?'':'s')+'.'});
      }
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Attendance review could not be refreshed.'});
    }finally{setBusy(false);}
  }

  return <Stack gap="md">
    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <Title order={3}>{event.name}</Title>
            <Badge variant="light">Keluarga event</Badge>
          </Group>
          <Text size="sm" c="dimmed">{event.start_date}{event.end_date!==event.start_date?' – '+event.end_date:''} · {event.venue||'Venue not recorded'}</Text>
          <Text size="xs" c="dimmed" mt={4}>MakLom is the staff operations surface. Publishing details remain owned by Keluarga; operational actions below use governed commands and audit logging.</Text>
        </div>
        <Group gap="xs">
          <Badge variant="light">{people.data?.roster.length||0} rostered</Badge>
          <Badge variant="light" color="green">{people.data?.attendance.length||0} attendance</Badge>
          <Badge variant="light" color={reviewRequiredCount?'orange':'gray'}>{reviewRequiredCount} review required</Badge>
        </Group>
      </Group>
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>Needs attention</Title>
          <Text size="sm" c="dimmed">Resolve imported attendance before routine roster work.</Text>
        </div>
        {canWrite&&<Button size="xs" variant="light" disabled={!safePending.length||busy} loading={busy} onClick={()=>void acceptSafe()}>
          Accept all safe ({safePending.length})
        </Button>}
      </Group>

      {people.isError&&<Alert color="red" mt="md">{people.error instanceof Error?people.error.message:'Event workspace data could not be loaded.'}</Alert>}
      <Stack gap="xs" mt="md">
        {pairProposals.map((pair)=><Paper key={pair.checkIn.id+'|'+pair.checkOut.id} withBorder radius="md" p="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div style={{minWidth:0}}>
              <Group gap="xs">
                <Text fw={700}>{pair.checkIn.full_name}</Text>
                <Badge size="xs" color="blue" variant="light">Proposed check-in / check-out pair</Badge>
                <Badge size="xs" color="green" variant="light">Volunteer matched</Badge>
              </Group>
              <Text size="xs" c="dimmed">{pair.checkIn.email||pair.checkIn.phone||'No email/mobile'} · source rows {pair.checkIn.source_row_number} + {pair.checkOut.source_row_number}</Text>
              <Text size="sm" mt={4}>{pair.checkIn.event_name}</Text>
              <Text size="sm" fw={600} mt={4}>{sgDateTime(pair.checkIn.source_sign_in_at)} to {sgDateTime(pair.checkOut.source_sign_in_at)} · {pair.durationMinutes} min</Text>
              <Text size="xs" c="dimmed">The later submission came from the reused sign-in form. Confirming keeps both source rows for audit and commits one attendance session.</Text>
            </div>
            {canWrite&&<Group gap="xs" wrap="nowrap">
              <Button size="xs" disabled={busy} onClick={()=>void confirmPair(pair)}>Confirm pair</Button>
            </Group>}
          </Group>
        </Paper>)}

        {standalonePending.map((row)=>{
          const resolution=shiftResolutionByRow.get(row.id);
          const manualOptions=(resolution?.candidateTimeslotIds||[]).map((timeslotId)=>{
            const shift=(shifts as EventShiftRow[]).find((item)=>item.keluarga_timeslot_id===timeslotId);
            return {value:timeslotId,label:shift?.name||'Event shift'};
          });
          const manualTimeslotId=manualShiftByRow[row.id]||null;
          const canAccept=Boolean(
            row.matched_core_volunteer_id&&row.source_sign_in_at&&(resolution?.safe||manualTimeslotId)
          );
          const acceptTimeslotId=resolution?.safe?resolution.timeslotId:manualTimeslotId;
          return <Paper key={row.id} withBorder radius="md" p="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div style={{minWidth:0}}>
                <Group gap="xs">
                  <Text fw={700}>{row.full_name}</Text>
                  <Badge size="xs" color={row.matched_core_volunteer_id?'green':'orange'} variant="light">
                    {row.matched_core_volunteer_id?'Volunteer matched':'Volunteer unresolved'}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">{row.email||row.phone||'No email/mobile'} · source row {row.source_row_number}</Text>
                <Text size="sm" mt={4}>{row.event_name}</Text>
                <Text size="xs" c="dimmed">
                  Source sign-in: {sgDateTime(row.source_sign_in_at)}
                  {' · '}Source check-out (feedback): {sgDateTime(row.source_feedback_at)}
                  {' · '}{row.review_flags?.map((x)=>x.replaceAll('_',' ')).join(' · ')||'No review flags'}
                </Text>
                {row.matched_core_volunteer_id&&!resolution?.safe&&<Text size="xs" c="orange" mt={4}>{resolution?.reason}</Text>}
              </div>
              {canWrite&&<Group gap="xs" wrap="nowrap">
                {!row.matched_core_volunteer_id&&<Button size="xs" variant="light" disabled={busy} onClick={()=>setIdentityRow(row)}>Resolve volunteer</Button>}
                {row.matched_core_volunteer_id&&row.source_sign_in_at&&!resolution?.safe&&manualOptions.length>1&&<Select
                  size="xs"
                  w={180}
                  placeholder="Choose shift"
                  data={manualOptions}
                  value={manualTimeslotId}
                  disabled={busy}
                  onChange={(value)=>setManualShiftByRow((current)=>({...current,[row.id]:value||''}))}
                />}
                {row.matched_core_volunteer_id&&row.source_sign_in_at&&canAccept&&<Button
                  size="xs"
                  disabled={busy}
                  onClick={()=>void review(row,'accept',acceptTimeslotId)}
                >Accept</Button>}
                <Button size="xs" color="red" variant="light" disabled={busy} onClick={()=>void review(row,'reject',null)}>Reject</Button>
              </Group>}
            </Group>
          </Paper>;
        })}
        {!people.isLoading&&!reviewRequiredCount&&<Text c="dimmed" size="sm">No staged attendance needs review for this event.</Text>}
      </Stack>
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between">
        <div><Title order={4}>Roster</Title><Text size="sm" c="dimmed">Operational assignments and event-scoped logistics.</Text></div>
        <Badge variant="light">{people.data?.roster.length||0}</Badge>
      </Group>
      <ScrollArea mt="sm">
        <Table striped highlightOnHover miw={980} verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>Volunteer</Table.Th><Table.Th>Shift</Table.Th><Table.Th>Contact</Table.Th>
            <Table.Th>Event logistics</Table.Th><Table.Th>Link</Table.Th><Table.Th></Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{(people.data?.roster||[]).map((row)=><Table.Tr key={row.id}>
            <Table.Td><Text fw={600} size="sm">{row.volunteer_name}</Text><Text size="xs" c="dimmed">{row.email||row.mobile||'—'}</Text></Table.Td>
            <Table.Td><Text size="xs">{row.timeslot_id?(shifts.find((shift:any)=>shift.keluarga_timeslot_id===row.timeslot_id)?.name||'Assigned'):'General'}</Text></Table.Td>
            <Table.Td><Text size="xs">{row.override?.contact_on_day||row.mobile||row.email||'—'}</Text>{row.override?.contact_on_day&&<Badge size="xs" variant="light">event override</Badge>}</Table.Td>
            <Table.Td><Text size="xs">{[
              row.override?.tshirt_size_override?('T-shirt '+row.override.tshirt_size_override):row.tshirt_size?('T-shirt '+row.tshirt_size):'',
              row.override?.dietary_override||row.dietary_requirements||'',
              row.override?.note||'',
            ].filter(Boolean).join(' · ')||'—'}</Text></Table.Td>
            <Table.Td><Badge size="xs" variant="light" color={row.volunteer_id?'green':'orange'}>{row.volunteer_id?'linked':'unresolved'}</Badge></Table.Td>
            <Table.Td>{canWrite&&<Button size="xs" variant="subtle" onClick={()=>setOverrideRow(row)}>Operational override</Button>}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between">
        <div><Title order={4}>Attendance</Title><Text size="sm" c="dimmed">Canonical sessions. Staff corrections require reason category, note, version check and audit entry.</Text></div>
        <Badge color="green" variant="light">{people.data?.attendance.length||0}</Badge>
      </Group>
      <ScrollArea mt="sm">
        <Table striped highlightOnHover miw={1050} verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>Volunteer</Table.Th><Table.Th>Shift</Table.Th><Table.Th>Check-in</Table.Th><Table.Th>Check-out</Table.Th>
            <Table.Th>Credited</Table.Th><Table.Th>Contribution</Table.Th><Table.Th></Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{(people.data?.attendance||[]).map((row)=><Table.Tr key={row.id}>
            <Table.Td><Text fw={600} size="sm">{row.name}</Text><Text size="xs" c="dimmed">{row.email||row.contact||'—'}</Text></Table.Td>
            <Table.Td>{row.shift_label||'General'}</Table.Td>
            <Table.Td>{sgDateTime(row.sign_in_at)}</Table.Td>
            <Table.Td>{sgDateTime(row.sign_out_at)}</Table.Td>
            <Table.Td>{row.staff_credited_duration_minutes??row.duration_minutes??0} min</Table.Td>
            <Table.Td><Badge size="xs" variant="light">{row.contribution_status||'—'}</Badge></Table.Td>
            <Table.Td>{canWrite&&row.record_source==='keluarga'&&<Button size="xs" variant="subtle" onClick={()=>setAttendanceRow(row)}>Correct</Button>}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!people.isLoading&&!people.data?.attendance.length&&<Text c="dimmed" size="sm" mt="sm">No committed attendance yet.</Text>}
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Title order={4}>Event details & shifts</Title>
      <SimpleGrid cols={{base:1,md:4}} mt="sm">
        <div><Text size="xs" c="dimmed">Programme</Text><Text size="sm">{event.programme||'—'}</Text></div>
        <div><Text size="xs" c="dimmed">Venue</Text><Text size="sm">{event.venue||'—'}</Text></div>
        <div><Text size="xs" c="dimmed">Status</Text><Text size="sm">{event.status}</Text></div>
        <div><Text size="xs" c="dimmed">Sessions</Text><Text size="sm">{shifts.length}</Text></div>
      </SimpleGrid>
      {event.notes&&<Text size="sm" c="dimmed" mt="sm">{event.notes}</Text>}
      <Stack gap={4} mt="md">{shifts.map((shift:any)=><Group key={shift.id} justify="space-between">
        <Text size="sm" fw={600}>{shift.name}</Text>
        <Text size="xs" c="dimmed">{shift.shift_date} {shift.start_time?'· '+String(shift.start_time).slice(0,5)+'–'+String(shift.end_time||'').slice(0,5):''}</Text>
      </Group>)}</Stack>
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between"><div><Title order={4}>Audit trail</Title><Text size="sm" c="dimmed">Latest governed staff and import actions for this event.</Text></div><Badge variant="light">{audit.data?.length||0}</Badge></Group>
      <Stack gap="xs" mt="sm">
        {(audit.data||[]).slice(0,20).map((entry)=><Group key={entry.id} justify="space-between" align="flex-start">
          <div><Text size="sm" fw={600}>{entry.action.replaceAll('.',' · ').replaceAll('_',' ')}</Text><Text size="xs" c="dimmed">{String(entry.metadata?.reason_note||entry.metadata?.review_note||entry.target_type||'')}</Text></div>
          <Text size="xs" c="dimmed">{sgDateTime(entry.occurred_at)}</Text>
        </Group>)}
        {!audit.isLoading&&!audit.data?.length&&<Text size="sm" c="dimmed">No event audit entries yet.</Text>}
      </Stack>
    </Paper>

    <Modal opened={Boolean(identityRow)} onClose={()=>setIdentityRow(null)} title={identityRow?'Resolve volunteer · '+identityRow.full_name:'Resolve volunteer'} size="lg">
      {identityRow&&<StagedIdentityResolver
        row={identityRow}
        onResolved={async(result)=>{
          setIdentityRow(null);
          setMessage({kind:'success',text:result.created?'New volunteer created and linked.':'Existing volunteer linked.'});
          await reload();
        }}
      />}
    </Modal>

    <Modal opened={Boolean(overrideRow)} onClose={()=>setOverrideRow(null)} title={overrideRow?'Operational override · '+overrideRow.volunteer_name:'Operational override'} size="lg">
      {overrideRow&&<RosterOverrideEditor row={overrideRow} onSaved={async()=>{setOverrideRow(null);await reload();}}/>}
    </Modal>

    <Modal opened={Boolean(attendanceRow)} onClose={()=>setAttendanceRow(null)} title={attendanceRow?'Correct attendance · '+attendanceRow.name:'Correct attendance'} size="lg">
      {attendanceRow&&<AttendanceCorrectionEditor row={attendanceRow} onSaved={async()=>{setAttendanceRow(null);await reload();}}/>}
    </Modal>
  </Stack>;
}

function StagedIdentityResolver({
  row,
  onResolved,
}:{
  row:HistoricalAttendanceImportRow;
  onResolved:(result:{created:boolean})=>Promise<void>;
}) {
  const [mode,setMode]=useState<'existing'|'create'>('existing');
  const [search,setSearch]=useState(row.email||row.phone||row.full_name);
  const [selected,setSelected]=useState<StagedIdentityCandidate|null>(null);
  const [name,setName]=useState(row.full_name);
  const [email,setEmail]=useState(row.email||'');
  const [phone,setPhone]=useState(row.phone||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const candidates=useQuery({
    queryKey:['staged-identity-candidates',row.id,search],
    queryFn:()=>fetchStagedIdentityCandidates(row.id,search.trim()||null),
    enabled:mode==='existing',
  });

  async function linkExisting() {
    if(!selected){setError('Select an existing volunteer first.');return;}
    setBusy(true);setError(null);
    try{
      const result=await resolveStagedIdentity({
        rowId:row.id,
        expectedVersion:row.row_version,
        existingCoreVolunteerId:selected.core_volunteer_id,
        createNew:false,
        name:null,
        email:null,
        phone:null,
      });
      await onResolved({created:result.created});
    }catch(e){
      setError(e instanceof Error?e.message:'Could not link this volunteer.');
    }finally{setBusy(false);}
  }

  async function createVolunteer() {
    if(!name.trim()){setError('Volunteer name is required.');return;}
    if(!email.trim()&&!phone.trim()){setError('Email or mobile number is required.');return;}
    setBusy(true);setError(null);
    try{
      const result=await resolveStagedIdentity({
        rowId:row.id,
        expectedVersion:row.row_version,
        existingCoreVolunteerId:null,
        createNew:true,
        name:name.trim(),
        email:email.trim()||null,
        phone:phone.trim()||null,
      });
      await onResolved({created:result.created});
    }catch(e){
      setError(e instanceof Error?e.message:'Could not create this volunteer.');
    }finally{setBusy(false);}
  }

  return <Stack>
    <Alert variant="light">
      Resolve this staged attendance row to one canonical volunteer. Creating a new volunteer is blocked if the email or mobile already exists.
    </Alert>
    {error&&<Alert color="red">{error}</Alert>}

    <Group gap="xs">
      <Button size="xs" variant={mode==='existing'?'filled':'light'} onClick={()=>{setMode('existing');setError(null);}}>Match existing volunteer</Button>
      <Button size="xs" variant={mode==='create'?'filled':'light'} onClick={()=>{setMode('create');setError(null);}}>Create new volunteer</Button>
    </Group>

    {mode==='existing'?<Stack gap="sm">
      <TextInput
        label="Search volunteers"
        description="Search by name, email or mobile."
        value={search}
        onChange={(e)=>{setSearch(e.currentTarget.value);setSelected(null);}}
      />
      {candidates.isError&&<Alert color="red">{candidates.error instanceof Error?candidates.error.message:'Volunteer search failed.'}</Alert>}
      <ScrollArea h={300}>
        <Stack gap="xs">
          {(candidates.data||[]).map((candidate)=><Paper
            key={candidate.core_volunteer_id}
            withBorder
            p="sm"
            radius="md"
            onClick={()=>setSelected(candidate)}
            style={{
              cursor:'pointer',
              outline:selected?.core_volunteer_id===candidate.core_volunteer_id?'2px solid var(--mantine-color-blue-6)':'none',
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={700}>{candidate.name}</Text>
                <Text size="xs" c="dimmed">{candidate.volunteer_code||'No volunteer code'} · {candidate.email||candidate.phone||'No contact'}</Text>
              </div>
              {candidate.score>=100&&<Badge size="xs" color="green" variant="light">Strong match</Badge>}
            </Group>
          </Paper>)}
          {!candidates.isLoading&&!candidates.data?.length&&<Text size="sm" c="dimmed">No matching volunteers found. Try another search or create a new volunteer.</Text>}
        </Stack>
      </ScrollArea>
      <Group justify="flex-end">
        <Button loading={busy} disabled={!selected} onClick={()=>void linkExisting()}>Link selected volunteer</Button>
      </Group>
    </Stack>:<Stack gap="sm">
      <Alert color="orange" variant="light">Create a new volunteer only after confirming this person does not already exist in MakLom.</Alert>
      <TextInput label="Full name" value={name} onChange={(e)=>setName(e.currentTarget.value)} required/>
      <TextInput label="Email" value={email} onChange={(e)=>setEmail(e.currentTarget.value)}/>
      <TextInput label="Mobile" value={phone} onChange={(e)=>setPhone(e.currentTarget.value)}/>
      <Group justify="flex-end">
        <Button loading={busy} onClick={()=>void createVolunteer()}>Create volunteer & link</Button>
      </Group>
    </Stack>}
  </Stack>;
}

function RosterOverrideEditor({row,onSaved}:{row:EventRosterDetailRow;onSaved:()=>Promise<void>}) {
  const [contact,setContact]=useState(row.override?.contact_on_day||'');
  const [dietary,setDietary]=useState(row.override?.dietary_override||'');
  const [shirt,setShirt]=useState<string|null>(row.override?.tshirt_size_override||null);
  const [note,setNote]=useState(row.override?.note||'');
  const [reasonCode,setReasonCode]=useState<string|null>('event_logistics');
  const [reasonNote,setReasonNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  async function save() {
    if(!reasonCode){setError('Choose a reason category.');return;}
    setBusy(true);setError(null);
    try{
      await setRosterOperationalOverride({
        rosterId:row.id,
        expectedRosterVersion:row.row_version,
        expectedOverrideVersion:row.override?.row_version||0,
        contactOnDay:contact.trim()||null,
        dietaryOverride:dietary.trim()||null,
        tshirtSizeOverride:shirt,
        note:note.trim()||null,
        reasonCode,
        reasonNote,
      });
      await onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Could not save operational override.');}
    finally{setBusy(false);}
  }

  return <Stack>
    <Alert variant="light">These values apply only to this event. They do not overwrite the volunteer's master profile.</Alert>
    {error&&<Alert color="red">{error}</Alert>}
    <TextInput label="Contact on the day" value={contact} onChange={(e)=>setContact(e.currentTarget.value)}/>
    <Select label="T-shirt size override" clearable value={shirt} onChange={setShirt} data={['S','M','L','XL','2XL','3XL','5XL','7XL']}/>
    <Textarea label="Dietary / logistics override" value={dietary} onChange={(e)=>setDietary(e.currentTarget.value)}/>
    <Textarea label="Operational note" value={note} onChange={(e)=>setNote(e.currentTarget.value)}/>
    <Select label="Reason category" value={reasonCode} onChange={setReasonCode} data={REASON_OPTIONS} required/>
    <Textarea label="Staff note" description="Required for audit traceability." value={reasonNote} onChange={(e)=>setReasonNote(e.currentTarget.value)} required/>
    <Group justify="flex-end"><Button loading={busy} onClick={()=>void save()}>Save event override</Button></Group>
  </Stack>;
}

function AttendanceCorrectionEditor({row,onSaved}:{row:AttendanceRow;onSaved:()=>Promise<void>}) {
  const sessionId=row.id.replace(/^keluarga:/,'');
  const [checkIn,setCheckIn]=useState(dateTimeLocalValue(row.sign_in_at));
  const [checkOut,setCheckOut]=useState(dateTimeLocalValue(row.sign_out_at));
  const [reasonCode,setReasonCode]=useState<string|null>('staff_correction');
  const [reasonNote,setReasonNote]=useState('');
  const [creditAction,setCreditAction]=useState<'unchanged'|'approve'|'needs_review'|'reject'>('unchanged');
  const [minutes,setMinutes]=useState<number|string>(row.staff_credited_duration_minutes??row.duration_minutes??0);
  const [approvalNote,setApprovalNote]=useState(row.staff_credit_note||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  async function save() {
    if(!reasonCode){setError('Choose a reason category.');return;}
    const checkedIn=fromSingaporeLocal(checkIn);
    if(!checkedIn){setError('Check-in time is required.');return;}
    setBusy(true);setError(null);
    try{
      await correctEventAttendance({
        sessionId,
        expectedVersion:row.row_version,
        checkedInAt:checkedIn,
        checkedOutAt:fromSingaporeLocal(checkOut),
        reasonCode,
        reasonNote,
        creditAction,
        approvedMinutes:creditAction==='approve'?Math.max(0,Number(minutes)||0):null,
        approvalNote:approvalNote.trim()||null,
      });
      await onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Could not correct attendance.');}
    finally{setBusy(false);}
  }

  return <Stack>
    <Alert variant="light">If this session changed after you opened it, MakLom will reject the correction and ask you to refresh.</Alert>
    {error&&<Alert color="red">{error}</Alert>}
    <SimpleGrid cols={{base:1,md:2}}>
      <TextInput label="Check-in" type="datetime-local" value={checkIn} onChange={(e)=>setCheckIn(e.currentTarget.value)} required/>
      <TextInput label="Check-out" type="datetime-local" value={checkOut} onChange={(e)=>setCheckOut(e.currentTarget.value)}/>
    </SimpleGrid>
    <Select label="Reason category" value={reasonCode} onChange={setReasonCode} data={REASON_OPTIONS} required/>
    <Textarea label="Staff correction note" value={reasonNote} onChange={(e)=>setReasonNote(e.currentTarget.value)} required/>
    <Select
      label="Contribution hours"
      value={creditAction}
      onChange={(value)=>setCreditAction((value||'unchanged') as any)}
      data={[
        {value:'unchanged',label:'Leave contribution review unchanged'},
        {value:'approve',label:'Approve credited minutes'},
        {value:'needs_review',label:'Mark contribution for review'},
        {value:'reject',label:'Reject contribution credit'},
      ]}
    />
    {creditAction==='approve'&&<NumberInput label="Approved minutes" min={0} value={minutes} onChange={setMinutes}/>}
    {creditAction!=='unchanged'&&<Textarea label="Contribution review note" value={approvalNote} onChange={(e)=>setApprovalNote(e.currentTarget.value)}/>}
    <Group justify="flex-end"><Button loading={busy} onClick={()=>void save()}>Apply correction</Button></Group>
  </Stack>;
}

function LegacyEventEditor({ event, shifts, metrics, canWrite, canDelete, onRefresh, onDeleted }: any) {
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
    {status&&<Alert variant="light">{status}</Alert>}
    <form onSubmit={(e)=>{e.preventDefault();void save(e.currentTarget);}}>
      <SimpleGrid cols={{base:1,md:2}}>
        <TextInput name="name" label="Name" defaultValue={event.name} disabled={!canWrite}/>
        <Select name="status" label="Status" defaultValue={event.status} data={['active','archived']} disabled={!canWrite}/>
        <TextInput name="start_date" label="Start date" type="date" defaultValue={event.start_date} disabled={!canWrite}/>
        <TextInput name="end_date" label="End date" type="date" defaultValue={event.end_date} disabled={!canWrite}/>
        <TextInput name="programme" label="Programme / category" defaultValue={event.programme||''} disabled={!canWrite}/>
        <TextInput name="venue" label="Venue" defaultValue={event.venue||''} disabled={!canWrite}/>
      </SimpleGrid>
      <Textarea name="notes" label="Notes" mt="sm" defaultValue={event.notes||''} disabled={!canWrite}/>
      {canWrite&&<Group justify="flex-end" mt="md"><Button type="submit" loading={saving}>Save event</Button></Group>}
    </form>

    <Paper withBorder p="md">
      <Title order={4}>Shifts</Title>
      <Stack gap="xs" mt="sm">
        {shifts.map((shift:any)=><Group key={shift.id} justify="space-between">
          <div><Text fw={600}>{shift.name}</Text><Text size="xs" c="dimmed">{shift.shift_date} {shift.start_time?'· '+String(shift.start_time).slice(0,5)+'–'+String(shift.end_time||'').slice(0,5):''}</Text></div>
          {canDelete&&<Button size="xs" color="red" variant="subtle" onClick={()=>void deleteShift(shift).then(onRefresh)}>Delete</Button>}
        </Group>)}
        {canWrite&&<form onSubmit={(e)=>{
          e.preventDefault();const data=new FormData(e.currentTarget);
          void createShift(event.id,{
            name:String(data.get('name')||'').trim(),
            shift_date:String(data.get('date')||''),
            start_time:String(data.get('start')||'')||null,
            end_time:String(data.get('end')||'')||null,
            notes:null,
          }).then(()=>{e.currentTarget.reset();return onRefresh();});
        }}>
          <SimpleGrid cols={{base:1,md:4}}>
            <TextInput name="name" label="Shift name" required/>
            <TextInput name="date" label="Date" type="date" required/>
            <TextInput name="start" label="Start" type="time"/>
            <TextInput name="end" label="End" type="time"/>
          </SimpleGrid>
          <Group justify="flex-end" mt="sm"><Button size="xs" type="submit">Add shift</Button></Group>
        </form>}
      </Stack>
    </Paper>

    <Paper withBorder p="md">
      <Title order={4}>Impact metrics</Title>
      <Stack gap="xs" mt="sm">
        {metrics.map((metric:any)=><Group key={metric.id} justify="space-between">
          <Text>{metric.label}: <b>{metric.value}</b> {metric.unit||''}</Text>
          {canDelete&&<Button size="xs" color="red" variant="subtle" onClick={()=>void deleteMetric(metric).then(onRefresh)}>Delete</Button>}
        </Group>)}
        {canWrite&&<form onSubmit={(e)=>{
          e.preventDefault();const data=new FormData(e.currentTarget);
          void createMetric(event.id,String(data.get('label')||'').trim(),Number(data.get('value')||0),String(data.get('unit')||'').trim()||null)
            .then(()=>{e.currentTarget.reset();return onRefresh();});
        }}>
          <SimpleGrid cols={{base:1,md:3}}>
            <TextInput name="label" label="Metric" required/>
            <NumberInput name="value" label="Value" min={0} required/>
            <TextInput name="unit" label="Unit"/>
          </SimpleGrid>
          <Group justify="flex-end" mt="sm"><Button size="xs" type="submit">Add metric</Button></Group>
        </form>}
      </Stack>
    </Paper>

    {canDelete&&<Group justify="flex-end"><Button color="red" variant="light" onClick={()=>{
      if(confirm('Delete '+event.name+'? Related shifts and metrics will be removed.'))void deleteEvent(event).then(onDeleted);
    }}>Delete event</Button></Group>}
  </Stack>;
}
