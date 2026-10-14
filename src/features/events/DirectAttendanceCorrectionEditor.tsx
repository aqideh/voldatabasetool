import { useState } from 'react';
import { Alert, Button, Group, SimpleGrid, Stack, TextInput, Textarea } from '@mantine/core';
import type { ContributionSheetRow } from '../contributions/api';
import { correctDirectRosterAttendance } from './api';

function singaporeLocal(value:string|null){
  if(!value)return '';
  return new Date(Date.parse(value)+8*60*60*1000).toISOString().slice(0,16);
}
function timestamp(value:string){
  return value?value+':00+08:00':null;
}

export function DirectAttendanceCorrectionEditor({
  row,onSaved,
}:{row:ContributionSheetRow;onSaved:()=>Promise<void>}){
  const [checkIn,setCheckIn]=useState(singaporeLocal(row.sign_in_at));
  const [checkOut,setCheckOut]=useState(singaporeLocal(row.sign_out_at));
  const [reason,setReason]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);

  async function save(){
    const signInAt=timestamp(checkIn);
    const signOutAt=timestamp(checkOut);
    if(!signInAt||!Number.isFinite(Date.parse(signInAt))){setError('A valid check-in time is required.');return;}
    if(signOutAt&&(!Number.isFinite(Date.parse(signOutAt))||Date.parse(signOutAt)<Date.parse(signInAt))){
      setError('Check-out cannot be before check-in.');return;
    }
    if(reason.trim().length<5||reason.trim().length>500){
      setError('Provide a reason between 5 and 500 characters.');return;
    }
    if(!row.direct_attendance_updated_at){
      setError('Attendance changed or is unavailable. Refresh and try again.');return;
    }
    setBusy(true);setError(null);
    try{
      await correctDirectRosterAttendance({
        rosterId:row.roster_id,expectedUpdatedAt:row.direct_attendance_updated_at,
        signedInAt:signInAt,signedOutAt:signOutAt,reasonNote:reason.trim(),
      });
      await onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Attendance could not be corrected.');}
    finally{setBusy(false);}
  }

  return <Stack gap="sm">
    <Alert color="blue" variant="light">This is a historical check-in/out record without a linked continuous attendance session. Changes will retain an audit trail; previously captured source evidence is not deleted.</Alert>
    {error&&<Alert color="red">{error}</Alert>}
    <SimpleGrid cols={{base:1,sm:2}}>
      <TextInput label="Check-in (Singapore time)" type="datetime-local" value={checkIn} onChange={e=>setCheckIn(e.currentTarget.value)} required disabled={busy}/>
      <TextInput label="Check-out (Singapore time)" type="datetime-local" value={checkOut} onChange={e=>setCheckOut(e.currentTarget.value)} disabled={busy}/>
    </SimpleGrid>
    <Textarea label="Reason for attendance correction" value={reason} onChange={e=>setReason(e.currentTarget.value)} minRows={2} required disabled={busy}/>
    <Group justify="flex-end"><Button loading={busy} onClick={()=>void save()}>Save correction</Button></Group>
  </Stack>;
}
