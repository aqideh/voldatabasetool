import { Alert, Badge, Group, Loader, Paper, ScrollArea, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchVolunteerProfileDetails } from './api';
import type { VolunteerRow } from '../../lib/types';
import { minutesLabel } from '../../lib/utils';

const shown=(value:unknown):string=>{
  if(value===null||value===undefined||value==='')return 'Not provided';
  if(Array.isArray(value))return value.length?value.join(', '):'Not provided';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
};
function Info({label,value}:{label:string;value:unknown}){
  return <div><Text c="dimmed" size="xs">{label}</Text><Text size="sm" fw={500} style={{overflowWrap:'anywhere'}}>{shown(value)}</Text></div>;
}
function Section({title,children}:{title:string;children:React.ReactNode}){
  return <Paper withBorder radius="md" p="md"><Stack gap="sm">
    <Title order={4}>{title}</Title>{children}
  </Stack></Paper>;
}
function Fields({items}:{items:Array<[string,unknown]>}){
  return <SimpleGrid cols={{base:1,sm:2}} spacing="md">{items.map(([label,value])=><Info key={label} label={label} value={value}/>)}</SimpleGrid>;
}
const date=(value:string|null|undefined)=>value?new Date(value.length===10?value+'T00:00:00':value).toLocaleDateString('en-SG'):'Not provided';

export function VolunteerProfileTabs({volunteer,adminContent}:{volunteer:VolunteerRow;adminContent:React.ReactNode}){
  const details=useQuery({
    queryKey:['complete-volunteer-profile',volunteer.core_volunteer_id,volunteer.id],
    queryFn:()=>fetchVolunteerProfileDetails(volunteer.core_volunteer_id,volunteer.id),
    staleTime:60_000,
  });
  const d=details.data;
  const p=d?.privateDetails||{};
  const k=d?.familyProfile||{};
  const events=d?.events||[];
  const contributions=d?.contributions||[];
  const changes=d?.changeRequests||[];
  return <Stack gap="md">
    <Paper radius="md" bg="gray.0" p="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <div><Title order={3}>{volunteer.name}</Title><Text c="dimmed" size="sm">{volunteer.volunteer_code} · {volunteer.neighbourhood||volunteer.planning_area||'Location not provided'}</Text></div>
        <Group gap="xs"><Badge variant="light">{volunteer.age??'—'} yrs</Badge><Badge variant="light">{volunteer.attended_event_count??0} events</Badge><Badge variant="light">{minutesLabel(volunteer.total_credited_minutes??0)}</Badge></Group>
      </Group>
    </Paper>
    {volunteer.mobile_needs_review&&<Alert color="orange" title="Phone number awaiting staff review">
      Keluarga and the historical MakLom entry differ. The canonical number is displayed; the previously stored number and any pending requests are shown under Admin. No number has been changed automatically.
    </Alert>}
    <Tabs defaultValue="profile" keepMounted={false}>
      <ScrollArea type="auto"><Tabs.List style={{flexWrap:'nowrap'}}>
        <Tabs.Tab value="profile">Profile</Tabs.Tab><Tabs.Tab value="capabilities">Capabilities</Tabs.Tab>
        <Tabs.Tab value="history">History</Tabs.Tab><Tabs.Tab value="admin">Admin</Tabs.Tab>
      </Tabs.List></ScrollArea>
      {details.isLoading&&<Group justify="center" p="md"><Loader size="sm"/><Text size="sm">Loading volunteer details…</Text></Group>}
      {details.isError&&<Alert color="red" title="Profile details unavailable">{details.error instanceof Error?details.error.message:'Unable to load volunteer records.'}</Alert>}
      <Tabs.Panel value="profile" pt="md"><Stack gap="md">
        <Section title="Identity and contact"><Fields items={[
          ['Full name',volunteer.name],['KEL ID',volunteer.volunteer_code],['NRIC / FIN',volunteer.nric],
          ['Date of birth',date(volunteer.date_of_birth)],['Age',volunteer.age==null?null:volunteer.age+' years'+(volunteer.age_source==='staff_recorded'?' (staff recorded)':'')],
          ['Gender',volunteer.gender],['Email',volunteer.email],['Mobile',volunteer.phone],
        ]}/></Section>
        <Section title="Home address"><Fields items={[
          ['Address',p.address_line??volunteer.address],['Postal code',p.postal_code],['Neighbourhood',p.neighbourhood??volunteer.neighbourhood],
          ['Planning area',p.planning_area??volunteer.planning_area],['GRC / SMC',p.electoral_division??volunteer.electoral_division],
          ['Electoral code',p.electoral_division_code],['Boundary version',p.electoral_boundary_version],
          ['Verified on',p.address_verified_at?date(String(p.address_verified_at)):null],
          ['Latitude',p.latitude],['Longitude',p.longitude],
        ]}/></Section>
        <Section title="Emergency contact and welfare"><Fields items={[
          ['Emergency contact',p.emergency_contact_name??volunteer.emergency_name],
          ['Emergency phone',p.emergency_contact_mobile??volunteer.emergency_phone],
          ['Dietary requirements',p.dietary_requirements??volunteer.dietary],
          ['Food allergies',p.food_allergies],['No known food allergies',p.no_known_food_allergies],
          ['T-shirt size',p.tshirt_size??volunteer.shirt_size],
        ]}/></Section>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="capabilities" pt="md"><Stack gap="md">
        <Section title="Education and languages"><Fields items={[
          ['Highest qualification',p.highest_qualification],['Institution',p.institution],
          ['Field of study',p.field_of_study],['Languages',p.languages_spoken??volunteer.languages_spoken],
        ]}/></Section>
        <Section title="Skills and interests"><Fields items={[
          ['Specialised skills',k.skills],['Interests',k.interests],['Legacy MakLom interests',volunteer.interests],
          ['Biography',k.bio],
        ]}/></Section>
        <Section title="Availability"><Fields items={[
          ['Availability slots',k.availability_slots],['Preferred commitment',k.preferred_commitment],
          ['Availability notes',k.availability_notes],['Onboarding completed',k.onboarding_completed_at?date(String(k.onboarding_completed_at)):null],
          ['Profile photo path',k.avatar_path],['Event photo opt-in',k.event_card_photo_opt_in],
        ]}/></Section>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="history" pt="md"><Stack gap="md">
        <Section title="Participation overview"><Fields items={[
          ['First event',volunteer.first_event_date?date(volunteer.first_event_date):null],
          ['Last active',volunteer.last_active?date(volunteer.last_active):null],
          ['Events attended',volunteer.attended_event_count],['Events registered',volunteer.registered_event_count],
          ['Credited hours',minutesLabel(volunteer.total_credited_minutes??0)],
          ['Events in last 90 days',volunteer.events_last_90d],
        ]}/></Section>
        <Section title="Event participation">
          {events.length===0?<Text c="dimmed" size="sm">No events recorded.</Text>:events.map((event)=><Group key={event.event_key} justify="space-between" py={6} style={{borderBottom:'1px solid var(--mantine-color-gray-2)'}}>
            <div><Text size="sm" fw={600}>{event.event_title}</Text><Text size="xs" c="dimmed">{event.has_keluarga_source?'Keluarga':''}{event.has_keluarga_source&&event.has_historical_source?' · ':''}{event.has_historical_source?'Historical records':''}</Text></div>
            <Text size="sm">{date(event.event_date)}</Text>
          </Group>)}
        </Section>
        <Section title="Individual contributions">{contributions.length===0?<Text size="sm" c="dimmed">No individual contribution records.</Text>:contributions.map((item)=><Group key={item.id} justify="space-between" align="start" py={6} style={{borderBottom:'1px solid var(--mantine-color-gray-2)'}}>
          <div><Text size="sm" fw={600}>{item.event_title||'Volunteer contribution'}</Text><Text size="xs" c="dimmed">{date(item.occurred_at)} · {item.status}</Text>{item.approval_note&&<Text size="xs">{item.approval_note}</Text>}</div>
          <Text size="sm">{minutesLabel(item.approved_minutes??item.operational_minutes??0)}</Text>
        </Group>)}</Section>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="admin" pt="md"><Stack gap="md">
        <Section title="Recruitment and staff record"><Fields items={[
          ['Recruited year',volunteer.recruited_year],['Chat session',volunteer.chat_session],
          ['Chat session date',volunteer.chat_session_date?date(volunteer.chat_session_date):null],
          ['Programmes',volunteer.programmes_registered],['Tags',volunteer.tags],
          ['Internal notes',volunteer.notes],['Record last updated',volunteer.updated_at?date(volunteer.updated_at):null],
          ['Record version',volunteer.row_version],
        ]}/></Section>
        <Section title="Identity discrepancies"><Fields items={[
          ['Canonical name',volunteer.name],['Stored MakLom name',volunteer.maklom_stored_name],
          ['Canonical email',volunteer.email],['Stored MakLom email',volunteer.maklom_stored_email],
          ['Canonical mobile',volunteer.phone],['Stored MakLom mobile',volunteer.maklom_stored_phone],
        ]}/></Section>
        <Section title="Profile change requests">{changes.length===0?<Text size="sm" c="dimmed">No profile change requests.</Text>:changes.map((ch)=><Paper key={ch.id} radius="sm" p="sm" withBorder><Group justify="space-between">
          <Text size="sm" fw={600}>{ch.field_name} · {ch.status}</Text><Text size="xs" c="dimmed">{date(ch.source_changed_at)}</Text></Group>
          <Text size="xs">Previous: {shown(ch.old_value)}</Text><Text size="xs">Requested: {shown(ch.new_value)}</Text>
        </Paper>)}</Section>
        <Section title="Staff audit history">{!d?.audit.length?<Text size="sm" c="dimmed">No recorded staff updates.</Text>:d.audit.map((a)=><Group key={a.id} justify="space-between">
          <Text size="sm">{a.action} · {a.actor_user_id||'System'}</Text><Text size="xs" c="dimmed">{date(a.occurred_at)}</Text>
        </Group>)}</Section>
        {adminContent}
      </Stack></Tabs.Panel>
    </Tabs>
  </Stack>;
}
