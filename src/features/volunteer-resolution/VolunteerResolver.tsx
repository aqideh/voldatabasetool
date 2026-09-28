import { useState } from 'react';
import { Alert, Button, Divider, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAttendanceResolutionRosterId,
  fetchInboxResolutionRosterId,
  fetchResolutionRosterContext,
  resolveVolunteer,
  searchResolutionCandidates,
  type ResolutionCandidate,
} from './api';

type Source =
  | { kind:'attendance'; attendanceId:string }
  | { kind:'inbox'; sourceKind:'insight'|'review'; sourceRecordId:string };

export function VolunteerResolver({
  source,
  initialName,
  initialEmail,
  initialPhone,
  onResolved,
}:{
  source:Source;
  initialName?:string|null;
  initialEmail?:string|null;
  initialPhone?:string|null;
  onResolved:()=>void;
}){
  const[search,setSearch]=useState(initialEmail||initialPhone||initialName||'');
  const[debounced]=useDebouncedValue(search,250);
  const[creating,setCreating]=useState(false);
  const[name,setName]=useState(initialName||'');
  const[email,setEmail]=useState(initialEmail||'');
  const[phone,setPhone]=useState(initialPhone||'');
  const[message,setMessage]=useState<string|null>(null);
  const[saving,setSaving]=useState(false);

  const rosterId=useQuery({
    queryKey:['resolution-roster',source],
    queryFn:()=>source.kind==='attendance'
      ?fetchAttendanceResolutionRosterId(source.attendanceId)
      :fetchInboxResolutionRosterId(source.sourceKind,source.sourceRecordId),
  });
  const roster=useQuery({
    queryKey:['resolution-roster-context',rosterId.data],
    queryFn:()=>fetchResolutionRosterContext(rosterId.data as string),
    enabled:Boolean(rosterId.data),
  });
  const candidates=useQuery({
    queryKey:['resolution-candidates',debounced],
    queryFn:()=>searchResolutionCandidates(debounced),
    enabled:debounced.trim().length>=2,
  });

  const fallbackName=name||roster.data?.volunteer_name||'';
  const fallbackEmail=email||roster.data?.email||'';
  const fallbackPhone=phone||roster.data?.mobile||'';

  async function link(candidate:ResolutionCandidate){
    if(!rosterId.data)return;
    setSaving(true);setMessage(null);
    try{
      const result=await resolveVolunteer({rosterId:rosterId.data,existingCoreVolunteerId:candidate.core_volunteer_id});
      setMessage(`Linked to ${result.display_name||candidate.name} (${result.volunteer_code||candidate.volunteer_code}).`);
      onResolved();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not link volunteer.');}
    finally{setSaving(false);}
  }

  async function create(){
    if(!rosterId.data)return;
    const createName=fallbackName.trim(),createEmail=fallbackEmail.trim(),createPhone=fallbackPhone.trim();
    if(!createName){setMessage('Volunteer name is required.');return;}
    if(!createEmail&&!createPhone){setMessage('Email or mobile number is required.');return;}
    setSaving(true);setMessage(null);
    try{
      const result=await resolveVolunteer({
        rosterId:rosterId.data,
        createName,
        createEmail:createEmail||null,
        createPhone:createPhone||null,
      });
      setMessage(`Created and linked ${result.display_name||createName} (${result.volunteer_code}).`);
      onResolved();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not create volunteer.');}
    finally{setSaving(false);}
  }

  return <Paper withBorder radius="md" p="md">
    <Stack gap="sm">
      <div>
        <Title order={5}>Resolve volunteer</Title>
        <Text size="sm" c="dimmed">Link this event identity to an existing volunteer first. Create a new record only when no match exists.</Text>
      </div>
      {message&&<Alert color={message.startsWith('Linked')||message.startsWith('Created')?'green':'red'}>{message}</Alert>}
      {(rosterId.isError||roster.isError)&&<Alert color="red">Volunteer identity details could not be loaded.</Alert>}
      <TextInput
        label="Search existing volunteers"
        placeholder="Name, email, mobile or KEL ID"
        value={search}
        onChange={(e)=>setSearch(e.currentTarget.value)}
      />
      <Stack gap="xs">
        {(candidates.data||[]).map((candidate)=><Paper key={candidate.core_volunteer_id} withBorder radius="md" p="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <div>
              <Text fw={700} size="sm">{candidate.name}</Text>
              <Text size="xs" c="dimmed">{candidate.volunteer_code} · {candidate.email||candidate.phone||'No contact recorded'}</Text>
            </div>
            <Button size="xs" variant="light" loading={saving} onClick={()=>void link(candidate)}>Link</Button>
          </Group>
        </Paper>)}
        {debounced.trim().length>=2&&!candidates.isLoading&&!candidates.data?.length&&<Text size="sm" c="dimmed">No existing volunteer matches this search.</Text>}
      </Stack>

      <Divider label="or" labelPosition="center"/>
      {!creating
        ?<Button variant="light" onClick={()=>setCreating(true)}>Create new volunteer</Button>
        :<Stack gap="sm">
          <Alert color="orange">Creating a new volunteer generates a new canonical KEL identity. Check the search results above before continuing.</Alert>
          <TextInput label="Name" value={fallbackName} onChange={(e)=>setName(e.currentTarget.value)}/>
          <TextInput label="Email" value={fallbackEmail} onChange={(e)=>setEmail(e.currentTarget.value)}/>
          <TextInput label="Mobile" value={fallbackPhone} onChange={(e)=>setPhone(e.currentTarget.value)}/>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={()=>setCreating(false)}>Cancel</Button>
            <Button loading={saving} onClick={()=>void create()}>Create and link</Button>
          </Group>
        </Stack>}
    </Stack>
  </Paper>;
}
