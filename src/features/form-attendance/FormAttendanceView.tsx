import { useMemo, useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteReconciliation, fetchFormAttendance, importFormAttendance, parseSignIn, parseSignOut, updateReconciliation } from './api';
import type { AttendanceReconciliation } from '../../lib/types';
import { minutesLabel, safeDateTime } from '../../lib/utils';

export function FormAttendanceView({canWrite,canDelete}:{canWrite:boolean;canDelete:boolean}){
  const qc=useQueryClient();const query=useQuery({queryKey:['form-attendance'],queryFn:fetchFormAttendance});
  const[signIn,setSignIn]=useState<File|null>(null);const[signOut,setSignOut]=useState<File|null>(null);const[busy,setBusy]=useState(false);const[message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);const[search,setSearch]=useState('');
  const rows=useMemo(()=>{const q=search.toLowerCase();return(query.data?.reconciliations||[]).filter((r)=>!q||[r.event_name,r.match_status,r.review_flags.join(' ')].join(' ').toLowerCase().includes(q));},[query.data,search]);
  const submissions=new Map((query.data?.submissions||[]).map((s)=>[s.id,s]));
  async function runImport(){if(!canWrite||(!signIn&&!signOut))return;setBusy(true);setMessage(null);try{const ins=signIn?parseSignIn(await signIn.text(),signIn.name):[];const outs=signOut?parseSignOut(await signOut.text(),signOut.name):[];const result=await importFormAttendance(ins,outs);setMessage({kind:'success',text:`Imported ${result.imported} new responses into ${result.sessions} attendance entries. ${result.warnings} entries need review; ${result.skipped} previously imported responses were skipped.`});setSignIn(null);setSignOut(null);await qc.invalidateQueries({queryKey:['form-attendance']});}catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Import failed.'});}finally{setBusy(false);}}
  return <Stack gap="md">
    <div><Title order={2}>Form Attendance</Title><Text c="dimmed" size="sm">Import FormSG sign-in/sign-out exports, reconcile them, and retain the original source responses for audit.</Text></div>
    {message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}
    <Paper withBorder radius="lg" p="lg">
      <SimpleGrid cols={{base:1,md:2}}>
        <Stack gap="xs"><Text fw={700}>Sign-in CSV</Text><Text size="sm" c="dimmed">{signIn?.name||'No file selected'}</Text><FileButton accept=".csv,text/csv" onChange={setSignIn}>{(props)=><Button {...props} variant="default">Choose sign-in CSV</Button>}</FileButton></Stack>
        <Stack gap="xs"><Text fw={700}>Sign-out CSV</Text><Text size="sm" c="dimmed">{signOut?.name||'No file selected'}</Text><FileButton accept=".csv,text/csv" onChange={setSignOut}>{(props)=><Button {...props} variant="default">Choose sign-out CSV</Button>}</FileButton></Stack>
      </SimpleGrid>
      {canWrite&&<Group justify="flex-end" mt="md"><Button loading={busy} disabled={!signIn&&!signOut} onClick={()=>void runImport()}>Import and reconcile</Button></Group>}
    </Paper>
    <Paper withBorder radius="lg" p="md"><Group justify="space-between"><TextInput label="Search" placeholder="Event or review flag" value={search} onChange={(e)=>setSearch(e.currentTarget.value)} maw={420} w="100%"/><Badge variant="light">{rows.length} entries</Badge></Group></Paper>
    <Stack gap="sm">{rows.map((row)=><ReconciliationCard key={row.id} row={row} signIn={row.sign_in_submission_id?submissions.get(row.sign_in_submission_id):undefined} signOut={row.sign_out_submission_id?submissions.get(row.sign_out_submission_id):undefined} canWrite={canWrite} canDelete={canDelete} onRefresh={()=>qc.invalidateQueries({queryKey:['form-attendance']})}/>)}</Stack>
    {!query.isLoading&&!rows.length&&<Paper withBorder p="xl"><Text c="dimmed" ta="center">No Form Attendance entries yet.</Text></Paper>}
  </Stack>;
}

function ReconciliationCard({row,signIn,signOut,canWrite,canDelete,onRefresh}:any){
  const[message,setMessage]=useState<string|null>(null);const[saving,setSaving]=useState(false);
  return <Paper withBorder radius="lg" p="md"><Stack gap="sm">
    <Group justify="space-between"><div><Text fw={800}>{signIn?.full_name||signOut?.full_name||'Unknown volunteer'}</Text><Text size="sm" c="dimmed">{row.event_name} · {row.event_date}</Text></div><Group gap="xs">{row.review_flags.map((flag:string)=><Badge key={flag} color="orange" variant="light">{flag.replaceAll('_',' ')}</Badge>)}{!row.review_flags.length&&<Badge color="green">Clean</Badge>}</Group></Group>
    {message&&<Alert variant="light">{message}</Alert>}
    <SimpleGrid cols={{base:1,md:4}}>
      <div><Text size="xs" c="dimmed">Original sign-in</Text><Text size="sm">{safeDateTime(signIn?.submitted_at||row.sign_in_at)}</Text></div>
      <div><Text size="xs" c="dimmed">Original sign-out</Text><Text size="sm">{safeDateTime(signOut?.submitted_at||row.sign_out_at)}</Text></div>
      <div><Text size="xs" c="dimmed">Calculated</Text><Text size="sm">{minutesLabel(row.calculated_duration_minutes)}</Text></div>
      <div><Text size="xs" c="dimmed">Volunteer match</Text><Text size="sm">{row.volunteer_id||'No database match'}</Text></div>
    </SimpleGrid>
    {canWrite&&<form onSubmit={(e)=>{e.preventDefault();setSaving(true);const d=new FormData(e.currentTarget);void updateReconciliation(row,{staff_credited_duration_minutes:d.get('credited')===''?null:Number(d.get('credited')),staff_credit_note:String(d.get('note')||'').trim()||null,review_acknowledged:true}).then(()=>{setMessage('Amendment saved.');return onRefresh();}).catch((err)=>setMessage(err.message)).finally(()=>setSaving(false));}}>
      <SimpleGrid cols={{base:1,md:2}}><NumberInput name="credited" label="Staff credited minutes" min={0} defaultValue={row.staff_credited_duration_minutes??''}/><Textarea name="note" label="Adjustment note" defaultValue={row.staff_credit_note||''}/></SimpleGrid>
      <Group justify="flex-end" mt="sm"><Button type="submit" size="sm" loading={saving}>Save amendment</Button>{canDelete&&<Button size="sm" color="red" variant="light" onClick={()=>{if(confirm('Delete this reconciled entry? Original source submissions remain retained.'))void deleteReconciliation(row).then(onRefresh)}}>Delete entry</Button>}</Group>
    </form>}
  </Stack></Paper>;
}
