import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import type { EventRow, EventShiftRow } from '../../lib/types';
import { saveCanonicalEventSchedule, type CanonicalScheduleShiftInput } from './api';

type ShiftDraft = {
  localKey:string;
  id:string|null;
  label:string;
  startsAt:string;
  endsAt:string;
  status:'scheduled'|'cancelled';
  existing:EventShiftRow|null;
};

function singaporeLocal(value:string|null|undefined):string {
  if(!value)return '';
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp))return '';
  return new Date(timestamp+8*60*60*1000).toISOString().slice(0,16);
}

function utcTimestamp(value:string):number {
  return Date.parse(value+':00+08:00');
}

function formatLocal(value:string):string {
  if(!value)return 'Not set';
  return new Date(utcTimestamp(value)).toLocaleString('en-SG',{
    timeZone:'Asia/Singapore',
    day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,
  });
}

function initialDrafts(shifts:EventShiftRow[]):ShiftDraft[] {
  return [...shifts]
    .sort((a,b)=>(a.canonical_sort_order??0)-(b.canonical_sort_order??0)
      || String(a.canonical_starts_at).localeCompare(String(b.canonical_starts_at)))
    .map(shift=>({
      localKey:shift.keluarga_timeslot_id||shift.id,
      id:shift.keluarga_timeslot_id||null,
      label:shift.canonical_label??'',
      startsAt:singaporeLocal(shift.canonical_starts_at),
      endsAt:singaporeLocal(shift.canonical_ends_at),
      status:shift.canonical_status??'scheduled',
      existing:shift,
    }));
}

function boundary(drafts:ShiftDraft[],side:'start'|'end'):string {
  const values=drafts.filter(shift=>shift.status==='scheduled')
    .map(shift=>side==='start'?shift.startsAt:shift.endsAt)
    .filter(Boolean);
  if(!values.length)return '';
  return side==='start'
    ? [...values].sort((a,b)=>utcTimestamp(a)-utcTimestamp(b))[0]
    : [...values].sort((a,b)=>utcTimestamp(b)-utcTimestamp(a))[0];
}

type Props = {
  event:EventRow;
  shifts:EventShiftRow[];
  canWrite:boolean;
  onSaved:()=>Promise<void>;
};

export function CanonicalScheduleEditor({event,shifts,canWrite,onSaved}:Props){
  const [opened,setOpened]=useState(false);
  const [drafts,setDrafts]=useState<ShiftDraft[]>([]);
  const [reason,setReason]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);

  const displayDrafts=useMemo(()=>initialDrafts(shifts),[shifts]);
  const active=displayDrafts.filter(item=>item.status==='scheduled');
  const eventStart=boundary(displayDrafts,'start');
  const eventEnd=boundary(displayDrafts,'end');

  function open(){
    setDrafts(initialDrafts(shifts));
    setReason('');
    setError(null);
    setOpened(true);
  }

  function change(localKey:string,field:'label'|'startsAt'|'endsAt',value:string){
    setDrafts(current=>current.map(shift=>shift.localKey===localKey?{...shift,[field]:value}:shift));
  }

  function changeBoundary(side:'start'|'end',value:string){
    setDrafts(current=>{
      const candidates=current.filter(shift=>shift.status==='scheduled');
      if(!candidates.length)return current;
      const target=[...candidates].sort((a,b)=>side==='start'
        ? utcTimestamp(a.startsAt)-utcTimestamp(b.startsAt)
        : utcTimestamp(b.endsAt)-utcTimestamp(a.endsAt))[0];
      return current.map(shift=>shift.localKey===target.localKey
        ? {...shift,[side==='start'?'startsAt':'endsAt']:value}
        : shift);
    });
  }

  function addShift(){
    setDrafts(current=>[...current,{
      localKey:'new-'+(Math.max(0,...current.map(shift=>Number(shift.localKey.replace(/^new-/,''))||0))+1),
      id:null,label:'',startsAt:boundary(current,'start'),endsAt:boundary(current,'end'),
      status:'scheduled',existing:null,
    }]);
  }

  function removeUnsaved(localKey:string){
    setDrafts(current=>current.filter(shift=>shift.localKey!==localKey||shift.existing));
  }

  async function save(){
    const note=reason.trim();
    if(note.length<5||note.length>500){setError('Provide an audit reason between 5 and 500 characters.');return;}
    if(drafts.length<1||drafts.length>100){setError('An event must contain between 1 and 100 shifts.');return;}
    for(const shift of drafts){
      if(!shift.startsAt||!shift.endsAt||!Number.isFinite(utcTimestamp(shift.startsAt))||
        !Number.isFinite(utcTimestamp(shift.endsAt))||utcTimestamp(shift.endsAt)<=utcTimestamp(shift.startsAt)){
        setError('Each shift must have a valid end time after its start time.');return;
      }
      if(shift.label.length>120){setError('Shift names must be 120 characters or shorter.');return;}
    }
    const payload:CanonicalScheduleShiftInput[]=drafts.map(shift=>({
      id:shift.id,label:shift.label.trim()||null,
      starts_at:shift.startsAt+':00+08:00',
      ends_at:shift.endsAt+':00+08:00',
      ...(shift.existing?{
        expected_label:shift.existing.canonical_label??null,
        expected_starts_at:shift.existing.canonical_starts_at,
        expected_ends_at:shift.existing.canonical_ends_at??null,
        expected_status:shift.existing.canonical_status??'scheduled',
        expected_sort_order:shift.existing.canonical_sort_order??0,
        expected_registration_capacity:shift.existing.canonical_capacity??null,
      }:{status:'scheduled' as const}),
    }));
    setBusy(true);setError(null);
    try{
      await saveCanonicalEventSchedule({
        eventId:event.keluarga_event_id||event.id.replace(/^keluarga:/,''),
        expectedUpdatedAt:event.updated_at,
        reasonNote:note,shifts:payload,
      });
      setOpened(false);
      await onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Schedule could not be saved.');}
    finally{setBusy(false);}
  }

  return <Paper withBorder radius="lg" p="md">
    <Group justify="space-between" align="flex-start">
      <div>
        <Title order={4}>Event & shift timings</Title>
        <Text size="sm" c="dimmed">Singapore time · Overall event timing is derived from scheduled shifts.</Text>
      </div>
      {canWrite&&<Button size="xs" variant="light" onClick={open}>Edit timings / add shift</Button>}
    </Group>
    <SimpleGrid cols={{base:1,sm:2}} mt="sm">
      <div><Text size="xs" c="dimmed">Event starts</Text><Text fw={600} size="sm">{formatLocal(eventStart)}</Text></div>
      <div><Text size="xs" c="dimmed">Event ends</Text><Text fw={600} size="sm">{formatLocal(eventEnd)}</Text></div>
    </SimpleGrid>
    <Stack gap="xs" mt="sm">
      {displayDrafts.map(shift=><Group key={shift.localKey} justify="space-between" gap="sm">
        <Text size="sm" fw={600}>{shift.label||'General'} {shift.status==='cancelled'&&<Badge size="xs" color="gray">Cancelled</Badge>}</Text>
        <Text size="sm">{formatLocal(shift.startsAt)} – {formatLocal(shift.endsAt)}</Text>
      </Group>)}
      {!shifts.length&&<Text size="sm" c="dimmed">No shifts configured.</Text>}
    </Stack>
    <Modal opened={opened} onClose={()=>{if(!busy)setOpened(false);}} title="Edit event & shift timings" size="xl" closeOnEscape={!busy} closeOnClickOutside={!busy}>
      <Stack gap="md">
        <Alert color="blue" variant="light">Changes update the same Keluarga event and shift records. Existing roster assignments, check-in/out evidence and contribution approvals are not changed. A reason is recorded in the event audit.</Alert>
        {error&&<Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{base:1,sm:2}}>
          <TextInput label="Event start (SGT)" type="datetime-local" value={boundary(drafts,'start')} onChange={e=>changeBoundary('start',e.currentTarget.value)} disabled={busy}/>
          <TextInput label="Event end (SGT)" type="datetime-local" value={boundary(drafts,'end')} onChange={e=>changeBoundary('end',e.currentTarget.value)} disabled={busy}/>
        </SimpleGrid>
        <Text c="dimmed" size="xs">Changing the overall event start/end adjusts the earliest/latest scheduled shift. You can refine each shift below.</Text>
        <Stack gap="sm">
          {drafts.map((shift,index)=><Paper key={shift.localKey} withBorder radius="md" p="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">Shift {index+1} {shift.status==='cancelled'?'(cancelled)':''}</Text>
              {!shift.existing&&<Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={()=>removeUnsaved(shift.localKey)}>Remove new shift</Button>}
            </Group>
            <TextInput label="Shift name" placeholder="e.g. Saturday PM" value={shift.label} onChange={e=>change(shift.localKey,'label',e.currentTarget.value)} disabled={busy}/>
            <SimpleGrid cols={{base:1,sm:2}} mt="xs">
              <TextInput label="Shift start (SGT)" type="datetime-local" value={shift.startsAt} onChange={e=>change(shift.localKey,'startsAt',e.currentTarget.value)} disabled={busy}/>
              <TextInput label="Shift end (SGT)" type="datetime-local" value={shift.endsAt} onChange={e=>change(shift.localKey,'endsAt',e.currentTarget.value)} disabled={busy}/>
            </SimpleGrid>
          </Paper>)}
        </Stack>
        <Group><Button variant="light" disabled={busy||drafts.length>=100} onClick={addShift}>+ Add shift</Button></Group>
        <Textarea label="Reason for schedule correction" description="Required for the audit trail; changes do not alter captured attendance timestamps." value={reason} onChange={e=>setReason(e.currentTarget.value)} minRows={2} disabled={busy} required/>
        <Group justify="flex-end">
          <Button variant="default" disabled={busy} onClick={()=>setOpened(false)}>Cancel</Button>
          <Button loading={busy} onClick={()=>void save()}>Save schedule</Button>
        </Group>
      </Stack>
    </Modal>
  </Paper>;
}
