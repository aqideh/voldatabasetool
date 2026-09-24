import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Group, NumberInput, SimpleGrid, Stack, TagsInput, Textarea, TextInput } from '@mantine/core';
import { updateVolunteer } from './api';
import type { VolunteerRow, VolunteerUpdate } from '../../lib/types';

interface Props{volunteer:VolunteerRow|null;canWrite:boolean;onClose:()=>void;onSaved:(row:VolunteerRow)=>void;}
const n=(value:string)=>value.trim()||null;

export function VolunteerDrawer({volunteer,canWrite,onClose,onSaved}:Props){
  const[form,setForm]=useState<Record<string,any>>({});const[saving,setSaving]=useState(false);const[message,setMessage]=useState<{kind:'error'|'success';text:string}|null>(null);
  useEffect(()=>{if(!volunteer)return;setForm({...volunteer,tags:volunteer.tags||[],programmes_registered:volunteer.programmes_registered||[]});setMessage(null);},[volunteer]);
  const set=(key:string,value:any)=>setForm((prev)=>({...prev,[key]:value}));
  async function save(){
    if(!volunteer||!canWrite)return;if(!String(form.name||'').trim()){setMessage({kind:'error',text:'Name is required.'});return;}
    const update:VolunteerUpdate={name:String(form.name).trim(),nric:n(form.nric||''),phone:n(form.phone||''),email:n(form.email||''),gender:n(form.gender||''),address:n(form.address||''),recruited_year:typeof form.recruited_year==='number'?form.recruited_year:null,chat_session:n(form.chat_session||''),chat_session_date:n(form.chat_session_date||''),interests:n(form.interests||''),languages_spoken:n(form.languages_spoken||''),programmes_registered:(form.programmes_registered||[]).map((v:string)=>v.trim()).filter(Boolean),tags:(form.tags||[]).map((v:string)=>v.trim()).filter(Boolean),emergency_name:n(form.emergency_name||''),emergency_phone:n(form.emergency_phone||''),shirt_size:n(form.shirt_size||''),dietary:n(form.dietary||''),notes:n(form.notes||'')};
    setSaving(true);setMessage(null);try{const updated=await updateVolunteer(volunteer.id,volunteer.row_version,update);setMessage({kind:'success',text:'Volunteer updated.'});onSaved(updated);}catch(error){setMessage({kind:'error',text:error instanceof Error?error.message:'Could not update volunteer.'});}finally{setSaving(false);}
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
  </Stack>}</Drawer>;
}
