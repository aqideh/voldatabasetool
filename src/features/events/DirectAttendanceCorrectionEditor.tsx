import { useState } from 'react';
import { Alert, Button, Group, SimpleGrid, Stack, TextInput, Textarea } from '@mantine/core';
import type { ContributionSheetRow } from '../contributions/api';
import { asApiError, singaporeMinuteInput, timestampFromSingaporeInput } from '../../lib/reconciliation-inputs';
import { correctDirectRosterAttendance } from './api';

export function DirectAttendanceCorrectionEditor({
  row,onSaved,
}:{row:ContributionSheetRow;onSaved:()=>Promise<void>}){
  const [checkIn,setCheckIn]=useState(singaporeMinuteInput(row.sign_in_at));
  const [checkOut,setCheckOut]=useState(singaporeMinuteInput(row.sign_out_at));
  const [reason,setReason]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);

  async function save(){
    if(busy||saved)return;
    let signInAt:string|null;
    let signOutAt:string|null;
    try{
      signInAt=timestampFromSingaporeInput(checkIn,row.sign_in_at);
      signOutAt=timestampFromSingaporeInput(checkOut,row.sign_out_at);
    }catch(e){setError(asApiError(e).message);return;}
    if(!signInAt){setError('A valid check-in time is required.');return;}
    if(signOutAt&&Date.parse(signOutAt)<Date.parse(signInAt)){
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
      setSaved(true);
      try{await onSaved();}
      catch{setError('Attendance was saved, but refreshing failed. Reopen this event before making another correction.');}
    }catch(e){setError(asApiError(e).message);}
    finally{setBusy(false);}
  }

  return <Stack gap="sm">
    <Alert color="blue" variant="light">This historical record has no linked continuous attendance session. Your correction is audited. Unchanged timestamps keep their original seconds; saving does not approve contribution hours.</Alert>
    {error&&<Alert color="red">{error}</Alert>}
    <SimpleGrid cols={{base:1,sm:2}}>
      <TextInput label="Check-in (Singapore time)" type="datetime-local" value={checkIn} onChange={e=>setCheckIn(e.currentTarget.value)} required disabled={busy||saved}/>
      <TextInput label="Check-out (Singapore time)" type="datetime-local" value={checkOut} onChange={e=>setCheckOut(e.currentTarget.value)} disabled={busy||saved}/>
    </SimpleGrid>
    <Textarea label="Reason for attendance correction" value={reason} onChange={e=>setReason(e.currentTarget.value)} minRows={2} required disabled={busy||saved}/>
    <Group justify="flex-end"><Button loading={busy} disabled={saved} onClick={()=>void save()}>{saved?'Correction saved':'Save correction'}</Button></Group>
  </Stack>;
}
