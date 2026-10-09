import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AppShell, Badge, Box, Burger, Button, Center, Group, Loader, NavLink, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { loadMember, signIn, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import type { AppMember } from './lib/types';
import { LeadsView } from './features/leads/LeadsView';
import { VolunteersView } from './features/volunteers/VolunteersView';
import { EventsView } from './features/events/EventsView';
import { AttendanceView } from './features/attendance/AttendanceView';
import { ContributionReviewView } from './features/contributions/ContributionReviewView';
import { ProfileChangeReviewView } from './features/profile-changes/ProfileChangeReviewView';
import { ProfileInboxView } from './features/profile-inbox/ProfileInboxView';
import { FormAttendanceView } from './features/form-attendance/FormAttendanceView';
import { HistoricalAttendanceView } from './features/historical-attendance/HistoricalAttendanceView';
import { DataOperationsView } from './features/data-operations/DataOperationsView';
import { VolunteerIntelligenceView } from './features/intelligence/VolunteerIntelligenceView';
import { ProfileReconciliationView } from './features/profile-reconciliation/ProfileReconciliationView';
import { WorkView, type WorkTarget } from './features/work/WorkView';
import {fetchMaklomAccess,hasAccess,type MaklomAccess} from './lib/maklom-access';
import {AccessManagementView} from './features/access/AccessManagementView';
import {AggregateReportingView} from './features/access/AggregateReportingView';

const primarySections=['Work','Data Dashboard','Events','Volunteer Leads','Volunteers'] as const;
const reviewSections=['Contribution Review','Profile Change Review','Insights & Reviews','Form Attendance','Historical Attendance','Profile Reconciliation','Data Operations','Attendance'] as const;
type PrimarySection=(typeof primarySections)[number];
type ReviewSection=(typeof reviewSections)[number];
type Section=PrimarySection|ReviewSection|'Access Management'|'Reporting Overview';

function sectionLabel(section:Section){return section;}

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
  const[access,setAccess]=useState<MaklomAccess|null>(null);const[session,setSession]=useState<Session|null>(null);const[member,setMember]=useState<AppMember|null>(null);const[initialising,setInitialising]=useState(true);const[memberLoading,setMemberLoading]=useState(false);const[memberError,setMemberError]=useState('');const[section,setSection]=useState<Section>('Work');const[requestedEventId,setRequestedEventId]=useState<string|null>(null);const[requestedEventName,setRequestedEventName]=useState<string|null>(null);const[historicalFocus,setHistoricalFocus]=useState<{eventName:string;eventDate:string|null;rowIds:string[]}|null>(null);const[requestedEventRowIds,setRequestedEventRowIds]=useState<string[]>([]);const[opened,{toggle,close}]=useDisclosure(false);const qc=useQueryClient();const memberRequest=useRef(0);

  const loadCurrentMember=useCallback(async(current:Session)=>{
    const request=++memberRequest.current;
    setMember(null);setMemberLoading(true);setMemberError('');
    try{
      const [nextMember,nextAccess]=await Promise.all([loadMember(current),fetchMaklomAccess(current)]);
      if(request!==memberRequest.current)return;
      setMember(nextMember);setAccess(nextAccess);
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
  if(!access?.active&&!member?.active)return <Center mih="100vh" p="md"><Paper withBorder radius="xl" p="xl" maw={520}><Stack><Title order={2}>Access not authorised</Title><Text c="dimmed">This account is signed in but is not an active MakLom member.</Text><Button variant="light" onClick={()=>void signOut()}>Sign out</Button></Stack></Paper></Center>;
  const allowed=(p:Parameters<typeof hasAccess>[1])=>hasAccess(access,p);
  const permitted=access?.active||member?.active;
  const superadmin=allowed('staff.manage');
  const canDelete=superadmin;
  const menuSections:Section[]=permitted?[
    ...(allowed('ops.read')?(['Work','Events','Attendance','Contribution Review','Insights & Reviews','Form Attendance','Historical Attendance'] as Section[]):[]),
    ...(allowed('leads.read')?(['Volunteer Leads'] as Section[]):[]),
    ...(allowed('volunteers.read')?(['Volunteers'] as Section[]):[]),
    ...(allowed('data.read')?(['Profile Change Review','Profile Reconciliation','Data Operations'] as Section[]):[]),
    ...(allowed('analytics.read')?(['Reporting Overview'] as Section[]):[]),
    ...(superadmin?(['Access Management'] as Section[]):[])
  ]:[];
  const effectiveSection=menuSections.includes(section)?section:menuSections[0]||'Reporting Overview';
  return <AppShell header={{height:64}} navbar={{width:245,breakpoint:'sm',collapsed:{mobile:!opened}}} padding="lg">
    <AppShell.Header px="md"><Group h="100%" justify="space-between"><Group><Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm"/><div className="maklom-brand"><img src="/maklom-logo.svg" alt=""/><div><Text fw={800} fz="lg">MakLom</Text><Text size="xs" c="dimmed">Volunteer operations database</Text></div></div></Group><Group gap="xs"><Badge variant="light">{access?.role||member?.role||'No access'}</Badge><Text size="sm" visibleFrom="sm">{session.user.email}</Text><Button size="xs" variant="subtle" onClick={()=>void signOut()}>Sign out</Button></Group></Group></AppShell.Header>
    <AppShell.Navbar p="sm"><Stack gap={4}>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase" px="sm" py={6}>MakLom</Text>
      {menuSections.filter(item=>!['Contribution Review','Insights & Reviews','Form Attendance','Historical Attendance','Profile Change Review','Profile Reconciliation','Data Operations','Attendance'].includes(item)).map((item)=><NavLink key={item} label={sectionLabel(item)} active={section===item} onClick={()=>{setSection(item);close();}}/>)}
      <Box mt="md">
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" px="sm" py={6}>Review tools</Text>
        {menuSections.filter(item=>['Contribution Review','Insights & Reviews','Form Attendance','Historical Attendance','Profile Change Review','Profile Reconciliation','Data Operations','Attendance'].includes(item)).map((item)=><NavLink key={item} label={sectionLabel(item)} active={section===item} onClick={()=>{if(item==='Historical Attendance')setHistoricalFocus(null);setSection(item);close();}}/>)}
      </Box>
    </Stack></AppShell.Navbar>
    <AppShell.Main bg="gray.0"><Box maw={1600} mx="auto">
      {effectiveSection==='Access Management'&&superadmin&&<AccessManagementView/>}
      {effectiveSection==='Reporting Overview'&&allowed('analytics.read')&&<AggregateReportingView/>}
      {effectiveSection==='Work'&&allowed('ops.read')&&<WorkView
        onNavigate={(target:WorkTarget)=>{setSection(target as Section);close();}}
        onOpenEvent={(eventId,eventName,rowIds)=>{setRequestedEventId(eventId);setRequestedEventName(eventName);setRequestedEventRowIds(rowIds);setSection('Events');close();}}
        onResolveEventMatch={(eventName,eventDate,rowIds)=>{setHistoricalFocus({eventName,eventDate,rowIds});setSection('Historical Attendance');close();}}
      />}
      {effectiveSection==='Data Dashboard'&&allowed('analytics.read')&&<VolunteerIntelligenceView/>}
      {effectiveSection==='Volunteer Leads'&&allowed('leads.read')&&<LeadsView canWrite={allowed('leads.write')}/>}
      {effectiveSection==='Volunteers'&&allowed('volunteers.read')&&<VolunteersView canWrite={allowed('volunteers.write')} canDelete={canDelete}/>}
      {effectiveSection==='Events'&&allowed('ops.read')&&<EventsView canWrite={allowed('ops.write')} canDelete={canDelete} requestedEventId={requestedEventId} requestedEventName={requestedEventName} requestedRowIds={requestedEventRowIds} onRequestedEventHandled={()=>{setRequestedEventId(null);setRequestedEventName(null);setRequestedEventRowIds([]);}}/>}
      {effectiveSection==='Attendance'&&allowed('ops.read')&&<AttendanceView canWrite={allowed('ops.write')} canDelete={canDelete}/>}
      {effectiveSection==='Contribution Review'&&allowed('ops.read')&&<ContributionReviewView canWrite={allowed('ops.write')}/>}
      {effectiveSection==='Profile Change Review'&&allowed('data.read')&&<ProfileChangeReviewView canWrite={allowed('data.write')}/>}
      {effectiveSection==='Insights & Reviews'&&allowed('ops.read')&&<ProfileInboxView canWrite={allowed('ops.write')}/>}
      {effectiveSection==='Form Attendance'&&allowed('ops.read')&&<FormAttendanceView canWrite={allowed('ops.write')} canDelete={canDelete}/>}
      {effectiveSection==='Historical Attendance'&&allowed('ops.read')&&<HistoricalAttendanceView canWrite={allowed('ops.write')} focus={historicalFocus} onClearFocus={()=>setHistoricalFocus(null)}/>}
      {effectiveSection==='Profile Reconciliation'&&allowed('data.read')&&<ProfileReconciliationView canWrite={allowed('data.write')}/>}
      {effectiveSection==='Data Operations'&&allowed('data.read')&&<DataOperationsView canWrite={allowed('data.write')}/>}
    </Box></AppShell.Main>
  </AppShell>;
}
