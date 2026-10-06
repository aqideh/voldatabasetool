import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AppShell, Badge, Box, Burger, Button, Center, Group, Loader, NavLink, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { loadMember, signIn, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import type { AppMember } from './lib/types';
import { DashboardView } from './features/dashboard/DashboardView';
import { LeadsView } from './features/leads/LeadsView';
import { VolunteersView } from './features/volunteers/VolunteersView';
import { EventsView } from './features/events/EventsView';
import { AttendanceView } from './features/attendance/AttendanceView';
import { ContributionReviewView } from './features/contributions/ContributionReviewView';
import { ProfileChangeReviewView } from './features/profile-changes/ProfileChangeReviewView';
import { ProfileInboxView } from './features/profile-inbox/ProfileInboxView';
import { FormAttendanceView } from './features/form-attendance/FormAttendanceView';
import { DataOperationsView } from './features/data-operations/DataOperationsView';
import { VolunteerIntelligenceView } from './features/intelligence/VolunteerIntelligenceView';
import { ProfileReconciliationView } from './features/profile-reconciliation/ProfileReconciliationView';

const sections=['Overview','Volunteer Leads','Central Database','Volunteer Intelligence','Events & Shifts','Attendance','Contribution Review','Profile Change Review','Insights & Reviews','Form Attendance','Profile Reconciliation','Data Operations'] as const;
type Section=(typeof sections)[number];

function LoginScreen(){
  const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[loading,setLoading]=useState(false);
  async function submit(){setLoading(true);setError('');try{await signIn(email.trim(),password);}catch(err){setError(err instanceof Error?err.message:'Sign in failed');}finally{setLoading(false);setPassword('');}}
  return <Center mih="100vh" bg="gray.0" p="md"><Paper withBorder shadow="sm" radius="xl" p="xl" w="100%" maw={420}><Stack gap="md">
    <div className="maklom-brand"><img src="/maklom-logo.svg" alt="MakLom"/><div><Title order={1}>MakLom</Title><Text c="dimmed">Volunteer operations database</Text></div></div>
    <TextInput label="Email" autoComplete="username" value={email} onChange={(e)=>setEmail(e.currentTarget.value)}/>
    <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.currentTarget.value)} onKeyDown={(e)=>{if(e.key==='Enter')void submit();}}/>
    {error&&<Text c="red" size="sm">{error}</Text>}<Button loading={loading} onClick={()=>void submit()}>Sign in</Button>
  </Stack></Paper></Center>;
}

function LoadingScreen({label}:{label:string}){
  return <Center mih="100vh" bg="gray.0" p="md"><Paper withBorder radius="xl" p="xl" w="100%" maw={420}><Stack align="center" gap="md">
    <div className="maklom-brand"><img src="/maklom-logo.svg" alt=""/><div><Title order={2}>MakLom</Title><Text c="dimmed">Volunteer operations database</Text></div></div>
    <Loader/>
    <Text c="dimmed" size="sm">{label}</Text>
  </Stack></Paper></Center>;
}

export default function App(){
  const[session,setSession]=useState<Session|null>(null);const[member,setMember]=useState<AppMember|null>(null);const[initialising,setInitialising]=useState(true);const[memberLoading,setMemberLoading]=useState(false);const[memberError,setMemberError]=useState('');const[section,setSection]=useState<Section>('Overview');const[opened,{toggle,close}]=useDisclosure(false);const qc=useQueryClient();const memberRequest=useRef(0);

  const loadCurrentMember=useCallback(async(current:Session)=>{
    const request=++memberRequest.current;
    setMember(null);setMemberLoading(true);setMemberError('');
    try{
      const nextMember=await loadMember(current);
      if(request!==memberRequest.current)return;
      setMember(nextMember);
    }catch(err){
      if(request!==memberRequest.current)return;
      setMemberError(err instanceof Error?err.message:'MakLom access could not be loaded.');
    }finally{
      if(request===memberRequest.current)setMemberLoading(false);
    }
  },[]);

  useEffect(()=>{
    let active=true;
    void supabase.auth.getSession().then(({data})=>{
      if(!active)return;
      const next=data.session;
      setSession(next);
      setInitialising(false);
      if(next)void loadCurrentMember(next);
      else{setMember(null);setMemberLoading(false);setMemberError('');}
    }).catch((err)=>{
      if(!active)return;
      setInitialising(false);setMember(null);setMemberLoading(false);setMemberError(err instanceof Error?err.message:'MakLom session could not be loaded.');
    });
    const{data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{
      if(!active)return;
      setSession(next);
      if(!next){memberRequest.current++;setMember(null);setMemberLoading(false);setMemberError('');qc.clear();return;}
      setTimeout(()=>{if(active)void loadCurrentMember(next);},0);
    });
    return()=>{active=false;memberRequest.current++;listener.subscription.unsubscribe();};
  },[qc,loadCurrentMember]);

  if(initialising)return <LoadingScreen label="Starting MakLom…"/>;
  if(!session)return <LoginScreen/>;
  if(memberLoading)return <LoadingScreen label="Checking your MakLom access…"/>;
  if(memberError)return <Center mih="100vh" bg="gray.0" p="md"><Paper withBorder radius="xl" p="xl" w="100%" maw={520}><Stack>
    <div className="maklom-brand"><img src="/maklom-logo.svg" alt=""/><div><Title order={2}>MakLom could not load</Title><Text c="dimmed">Your sign-in succeeded, but your access profile could not be retrieved.</Text></div></div>
    <Text c="red" size="sm">{memberError}</Text>
    <Group><Button onClick={()=>void loadCurrentMember(session)}>Try again</Button><Button variant="subtle" onClick={()=>void signOut()}>Sign out</Button></Group>
  </Stack></Paper></Center>;
  if(!member?.active)return <Center mih="100vh" p="md"><Paper withBorder radius="xl" p="xl" maw={520}><Stack><Title order={2}>Access not authorised</Title><Text c="dimmed">This account is signed in but is not an active MakLom member.</Text><Button variant="light" onClick={()=>void signOut()}>Sign out</Button></Stack></Paper></Center>;
  const canWrite=member.role==='editor'||member.role==='admin',canDelete=member.role==='admin';
  return <AppShell header={{height:64}} navbar={{width:245,breakpoint:'sm',collapsed:{mobile:!opened}}} padding="lg">
    <AppShell.Header px="md"><Group h="100%" justify="space-between"><Group><Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm"/><div className="maklom-brand"><img src="/maklom-logo.svg" alt=""/><div><Text fw={800} fz="lg">MakLom</Text><Text size="xs" c="dimmed">Volunteer operations database</Text></div></div></Group><Group gap="xs"><Badge variant="light">{member.role}</Badge><Text size="sm" visibleFrom="sm">{session.user.email}</Text><Button size="xs" variant="subtle" onClick={()=>void signOut()}>Sign out</Button></Group></Group></AppShell.Header>
    <AppShell.Navbar p="sm"><Stack gap={4}>{sections.map((item)=><NavLink key={item} label={item} active={section===item} onClick={()=>{setSection(item);close();}}/>)}</Stack></AppShell.Navbar>
    <AppShell.Main bg="gray.0"><Box maw={1600} mx="auto">
      {section==='Overview'&&<DashboardView/>}
      {section==='Volunteer Leads'&&<LeadsView canWrite={canWrite}/>}
      {section==='Central Database'&&<VolunteersView canWrite={canWrite} canDelete={canDelete}/>}
      {section==='Volunteer Intelligence'&&<VolunteerIntelligenceView/>}
      {section==='Events & Shifts'&&<EventsView canWrite={canWrite} canDelete={canDelete}/>}
      {section==='Attendance'&&<AttendanceView canWrite={canWrite} canDelete={canDelete}/>}
      {section==='Contribution Review'&&<ContributionReviewView canWrite={canWrite}/>}
      {section==='Profile Change Review'&&<ProfileChangeReviewView canWrite={canWrite}/>}
      {section==='Insights & Reviews'&&<ProfileInboxView canWrite={canWrite}/>}
      {section==='Form Attendance'&&<FormAttendanceView canWrite={canWrite} canDelete={canDelete}/>}
      {section==='Profile Reconciliation'&&<ProfileReconciliationView canWrite={canWrite}/>}
      {section==='Data Operations'&&<DataOperationsView canWrite={canWrite}/>}
    </Box></AppShell.Main>
  </AppShell>;
}
