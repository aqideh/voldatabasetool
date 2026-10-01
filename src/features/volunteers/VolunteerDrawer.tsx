import { useEffect, useState } from 'react';
import { Alert, Button, Divider, Drawer, Group, NumberInput, Paper, SimpleGrid, Stack, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import { inspectVolunteerRemoval, removeTestVolunteer, updateVolunteer } from './api';
import type { VolunteerRemovalPreflight } from './api';
import type { VolunteerRow, VolunteerUpdate } from '../../lib/types';

interface Props{volunteer:VolunteerRow|null;canWrite:boolean;canDelete:boolean;onClose:()=>void;onSaved:(row:VolunteerRow)=>void;onDeleted:()=>void;}
const n=(value:string)=>value.trim()||null;

export function VolunteerDrawer({volunteer,canWrite,canDelete,onClose,onSaved,onDeleted}:Props){
  const[form,setForm]=useState<Record<string,any>>({});const[saving,setSaving]=useState(false);const[message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);
  const[checkingRemoval,setCheckingRemoval]=useState(false);const[removing,setRemoving]=useState(false);const[removal,setRemoval]=useState<VolunteerRemovalPreflight|null>(null);const[confirmation,setConfirmation]=useState('');
  useEffect(()=>{if(!volunteer)return;setForm({...volunteer,tags:volunteer.tags||[],programmes_registered:volunteer.programmes_registered||[]});setMessage(null);setRemoval(null);setConfirmation('');},[volunteer]);
  const set=(key:string,value:any)=>setForm((prev)=>({...prev,[key]:value}));
  async function save(){
    if(!volunteer||!canWrite)return;if(!String(form.name||'').trim()){setMessage({kind:'error',text:'Name is required.'});return;}
    const update:VolunteerUpdate={name:String(form.name).trim(),nric:n(form.nric||''),phone:n(form.phone||''),email:n(form.email||''),gender:n(form.gender||''),address:n(form.address||''),recruited_year:typeof form.recruited_year==='number'?form.recruited_year:null,chat_session:n(form.chat_session||''),chat_session_date:n(form.chat_session_date||''),interests:n(form.interests||''),languages_spoken:n(form.languages_spoken||''),programmes_registered:(form.programmes_registered||[]).map((v:string)=>v.trim()).filter(Boolean),tags:(form.tags||[]).map((v:string)=>v.trim()).filter(Boolean),emergency_name:n(form.emergency_name||''),emergency_phone:n(form.emergency_phone||''),shirt_size:n(form.shirt_size||''),dietary:n(form.dietary||''),notes:n(form.notes||'')};
    setSaving(true);setMessage(null);try{const updated=await updateVolunteer(volunteer.id,volunteer.row_version,update);setMessage({kind:'success',text:'Volunteer updated.'});onSaved(updated);}catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not update volunteer.'});}finally{setSaving(false);}
  }
  async function checkRemoval(){
    if(!volunteer||!canDelete)return;
    setCheckingRemoval(true);setMessage(null);setRemoval(null);setConfirmation('');
    try{setRemoval(await inspectVolunteerRemoval(volunteer.core_volunteer_id));}
    catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not check whether this volunteer can be removed.'});}
    finally{setCheckingRemoval(false);}
  }
  async function confirmRemoval(){
    if(!volunteer||!removal?.eligible||confirmation.trim().toUpperCase()!==removal.volunteerCode.toUpperCase())return;
    setRemoving(true);setMessage(null);
    try{await removeTestVolunteer(volunteer.core_volunteer_id,confirmation.trim());onDeleted();}
    catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not remove this volunteer.'});}
    finally{setRemoving(false);}
  }
  const disabled=!canWrite;
  return <Drawer opened={!!volunteer} onClose={onClose} title={volunteer?.name||'Volunteer'} position="right" size="xl">{volunteer&&<Stack gap="md">
    {!canWrite&&<Alert color="blue">Read-only access.</Alert>}{message&&<Alert color={message.kind==='error'?'red':'green'}>{message.text}</Alert>}
    <SimpleGrid cols={{base:1,md:2}}>
      <TextInput label="Name" required value={form.name||''} onChange={(e)=>set('name',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="NRIC / FIN" value={form.nric||''} onChange={(e)=>set('nric',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Email" value={form.email||''} onChange={(e)=>set('email',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Phone" value={form.phone||''} onChange={(e)=>set('phone',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Gender" value={form.gender||''} onChange={(e)=>set('gender',e.currentTarget.value)} disabled={disabled}/>
      <NumberInput label="Recruited year" value={form.recruited_year??''} min={1900} max={2100} onChange={(v)=>set('recruited_year',typeof v==='number'?v:null)} disabled={disabled}/>
      <TextInput label="Chat session" value={form.chat_session||''} onChange={(e)=>set('chat_session',e.currentTarget.value)} disabled={disabled}/>
      <TextInput type="date" label="Chat session date" value={form.chat_session_date||''} onChange={(e)=>set('chat_session_date',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Languages spoken" value={form.languages_spoken||''} onChange={(e)=>set('languages_spoken',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="T-shirt size" value={form.shirt_size||''} onChange={(e)=>set('shirt_size',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Emergency contact name" value={form.emergency_name||''} onChange={(e)=>set('emergency_name',e.currentTarget.value)} disabled={disabled}/>
      <TextInput label="Emergency contact phone" value={form.emergency_phone||''} onChange={(e)=>set('emergency_phone',e.currentTarget.value)} disabled={disabled}/>
    </SimpleGrid>
    <Textarea label="Address" autosize minRows={2} value={form.address||''} onChange={(e)=>set('address',e.currentTarget.value)} disabled={disabled}/>
    <Textarea label="Interests / skills" autosize minRows={2} value={form.interests||''} onChange={(e)=>set('interests',e.currentTarget.value)} disabled={disabled}/>
    <TagsInput label="Programmes" value={form.programmes_registered||[]} onChange={(v)=>set('programmes_registered',v)} disabled={disabled}/>
    <TagsInput label="Tags" value={form.tags||[]} onChange={(v)=>set('tags',v)} disabled={disabled}/>
    <Textarea label="Dietary requirements" autosize minRows={2} value={form.dietary||''} onChange={(e)=>set('dietary',e.currentTarget.value)} disabled={disabled}/>
    <Textarea label="Notes" autosize minRows={4} value={form.notes||''} onChange={(e)=>set('notes',e.currentTarget.value)} disabled={disabled}/>
    {canWrite&&<Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={()=>void save()}>Save changes</Button></Group>}
    {canDelete&&<>
      <Divider my="xs"/>
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <div><Text fw={700}>Test record cleanup</Text><Text size="sm" c="dimmed">For accidental or test registrations only. MakLom will refuse removal if retained volunteer history exists.</Text></div>
          {!removal&&<Group justify="flex-end"><Button color="red" variant="light" loading={checkingRemoval} onClick={()=>void checkRemoval()}>Check removal eligibility</Button></Group>}
          {removal&&!removal.eligible&&<Alert color="orange" title="This volunteer cannot be removed">
            <Stack gap={4}>{removal.blockers.map((blocker)=><Text key={blocker} size="sm">• {blocker}</Text>)}</Stack>
          </Alert>}
          {removal?.eligible&&<Alert color="red" title="Permanent test record removal">
            <Stack gap="sm">
              <Text size="sm">This will remove {removal.registrationCount} registration{removal.registrationCount===1?'':'s'}, {removal.rosterCount} roster row{removal.rosterCount===1?'':'s'}, {removal.recruitmentApplicationCount} recruitment application{removal.recruitmentApplicationCount===1?'':'s'}, {removal.pointEntryCount} point entr{removal.pointEntryCount===1?'y':'ies'} and {removal.badgeCount} badge record{removal.badgeCount===1?'':'s'}. {removal.hasAccount?'The linked sign-in account will also be removed.':''}</Text>
              <TextInput label={`Type ${removal.volunteerCode} to confirm`} value={confirmation} onChange={(event)=>setConfirmation(event.currentTarget.value)} disabled={removing}/>
              <Group justify="flex-end">
                <Button variant="default" onClick={()=>{setRemoval(null);setConfirmation('');}} disabled={removing}>Cancel</Button>
                <Button color="red" loading={removing} disabled={confirmation.trim().toUpperCase()!==removal.volunteerCode.toUpperCase()} onClick={()=>void confirmRemoval()}>Remove test volunteer</Button>
              </Group>
            </Stack>
          </Alert>}
        </Stack>
      </Paper>
    </>}
  </Stack>}</Drawer>;
}
