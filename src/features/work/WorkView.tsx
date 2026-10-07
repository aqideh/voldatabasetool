import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchWorkSummary } from './api';

export type WorkTarget =
  | 'Events'
  | 'Contribution Review'
  | 'Profile Change Review'
  | 'Insights & Reviews'
  | 'Form Attendance'
  | 'Profile Reconciliation'
  | 'Data Operations'
  | 'Historical Attendance'
  | 'Volunteer Leads';

interface Props {
  onNavigate:(target:WorkTarget)=>void;
  onOpenEvent:(eventId:string|null,eventName:string)=>void;
  onResolveEventMatch:(eventName:string,eventDate:string|null,rowIds:string[])=>void;
}

function dateLabel(value:string|null){
  return value?new Date(value+'T00:00:00').toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'}):'Date unavailable';
}

function QueueCard({label,count,note,button,onClick,color='blue'}:{
  label:string;count:number;note:string;button:string;onClick:()=>void;color?:string;
}){
  return <Paper withBorder radius="lg" p="lg">
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <div>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
        <Text fz={30} fw={800} mt={4}>{count.toLocaleString()}</Text>
      </div>
      <Badge color={count?color:'gray'} variant="light">{count?'Action':'Clear'}</Badge>
    </Group>
    <Text size="sm" c="dimmed" mt="xs" mih={42}>{note}</Text>
    <Button mt="md" size="xs" variant={count?'light':'subtle'} disabled={!count} onClick={onClick}>{button}</Button>
  </Paper>;
}

export function WorkView({onNavigate,onOpenEvent,onResolveEventMatch}:Props){
  const summary=useQuery({
    queryKey:['work-summary'],
    queryFn:fetchWorkSummary,
    refetchInterval:60000,
    refetchOnWindowFocus:true,
  });
  const s=summary.data;
  const blockerCount=(s?.stagedAttendance||0)+(s?.duplicateCases||0)+(s?.unresolvedObservations||0)+(s?.reconciliationMatches||0)+(s?.formAttendanceWarnings||0);
  const confirmationCount=(s?.contributionReviews||0)+(s?.profileChanges||0)+(s?.reconciliationChanges||0);

  return <Stack gap="lg">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Work</Title>
        <Text c="dimmed" size="sm">Resolve anything that can delay or weaken MakLom's data before reporting.</Text>
      </div>
      <Group gap="xs">
        <Badge size="lg" color={blockerCount?'orange':'green'} variant="light">{blockerCount.toLocaleString()} data issues</Badge>
        <Badge size="lg" color={confirmationCount?'blue':'gray'} variant="light">{confirmationCount.toLocaleString()} confirmations</Badge>
        <Button size="xs" variant="subtle" loading={summary.isFetching} onClick={()=>void summary.refetch()}>Refresh</Button>
      </Group>
    </Group>

    {summary.isError&&<Alert color="red">Work queues could not be loaded. {summary.error instanceof Error?summary.error.message:'Refresh and try again.'}</Alert>}

    {!summary.isLoading&&!summary.isError&&blockerCount===0&&confirmationCount===0&&<Alert color="green" variant="light">
      No unresolved data-quality or confirmation work is currently visible. Approved KELUARGA contribution hours are ready for reporting.
    </Alert>}

    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>Events needing attention</Title>
          <Text c="dimmed" size="sm">Pending imported attendance is grouped by event so you can resolve the source rows in context.</Text>
        </div>
        <Badge variant="light" color={(s?.eventGroups.length||0)?'orange':'gray'}>{s?.eventGroups.length||0} events</Badge>
      </Group>
      <Stack gap="xs" mt="md">
        {(s?.eventGroups||[]).slice(0,12).map((event)=><Paper key={event.key} withBorder radius="md" p="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <div style={{minWidth:0}}>
              <Text fw={700}>{event.eventName}</Text>
              <Text size="xs" c="dimmed">{dateLabel(event.eventDate)} · {event.count} pending row{event.count===1?'':'s'}</Text>
              <Group gap={6} mt={6}>
                {event.unresolvedIdentities>0&&<Badge size="xs" color="orange" variant="light">{event.unresolvedIdentities} unresolved {event.unresolvedIdentities===1?'identity':'identities'}</Badge>}
                {event.reviewRows>0&&<Badge size="xs" color="yellow" variant="light">{event.reviewRows} flagged row{event.reviewRows===1?'':'s'}</Badge>}
              </Group>
            </div>
            {event.eventId
              ? <Button size="xs" onClick={()=>onOpenEvent(event.eventId,event.eventName)}>Open event</Button>
              : <Button size="xs" variant="light" color="orange" onClick={()=>onResolveEventMatch(event.eventName,event.eventDate,event.rowIds)}>Resolve event match</Button>}
          </Group>
        </Paper>)}
        {!summary.isLoading&&!s?.eventGroups.length&&<Text size="sm" c="dimmed">No staged attendance is waiting for event-level review.</Text>}
      </Stack>
    </Paper>

    <div>
      <Title order={4}>Resolve first</Title>
      <Text c="dimmed" size="sm" mb="sm">These queues can affect identity, attendance or source-data accuracy.</Text>
      <SimpleGrid cols={{base:1,sm:2,xl:4}}>
        <QueueCard label="Staged attendance" count={s?.stagedAttendance||0} note="Imported attendance rows still waiting for an event-level decision." button="Open Events" onClick={()=>onNavigate('Events')} color="orange"/>
        <QueueCard label="Unresolved observations" count={s?.unresolvedObservations||0} note="Insights or reviews still pending, including records that need a volunteer match." button="Review observations" onClick={()=>onNavigate('Insights & Reviews')} color="orange"/>
        <QueueCard label="Duplicate cases" count={s?.duplicateCases||0} note="Possible duplicate volunteer identities still awaiting a decision." button="Open data tools" onClick={()=>onNavigate('Data Operations')} color="orange"/>
        <QueueCard label="Reconciliation matches" count={s?.reconciliationMatches||0} note="Imported profile rows still need their volunteer identity confirmed." button="Open reconciliation" onClick={()=>onNavigate('Profile Reconciliation')} color="orange"/>
        <QueueCard label="Form attendance warnings" count={s?.formAttendanceWarnings||0} note="Form attendance sessions still have unacknowledged review issues." button="Review form attendance" onClick={()=>onNavigate('Form Attendance')} color="orange"/>
      </SimpleGrid>
    </div>

    <div>
      <Title order={4}>Confirm next</Title>
      <Text c="dimmed" size="sm" mb="sm">These decisions determine what becomes authoritative in MakLom.</Text>
      <SimpleGrid cols={{base:1,sm:2,xl:4}}>
        <QueueCard label="Contribution hours" count={s?.contributionReviews||0} note="Attendance-derived hours waiting for approval or re-review before they count as approved KELUARGA time." button="Review contributions" onClick={()=>onNavigate('Contribution Review')} color="blue"/>
        <QueueCard label="Profile changes" count={s?.profileChanges||0} note="Volunteer profile changes waiting for Volunteer Management confirmation." button="Review profile changes" onClick={()=>onNavigate('Profile Change Review')} color="blue"/>
        <QueueCard label="Reconciliation fields" count={s?.reconciliationChanges||0} note="Proposed imported profile fields waiting for approve/reject decisions." button="Open reconciliation" onClick={()=>onNavigate('Profile Reconciliation')} color="blue"/>
        <QueueCard label="Volunteer leads" count={s?.openLeads||0} note="Open prospective-volunteer leads that still need follow-up or conversion." button="Open leads" onClick={()=>onNavigate('Volunteer Leads')} color="violet"/>
      </SimpleGrid>
    </div>

    {(s?.contributionGroups.length||0)>0&&<Paper withBorder radius="lg" p="lg">
      <Group justify="space-between"><div><Title order={4}>Contribution review by event</Title><Text c="dimmed" size="sm">Use this to clear reporting-critical hour approvals quickly.</Text></div><Button size="xs" variant="light" onClick={()=>onNavigate('Contribution Review')}>Open review queue</Button></Group>
      <Stack gap="xs" mt="md">
        {(s?.contributionGroups||[]).slice(0,8).map((event)=><Group key={event.eventTitle} justify="space-between">
          <div><Text size="sm" fw={600}>{event.eventTitle}</Text><Text size="xs" c="dimmed">{event.count} record{event.count===1?'':'s'} waiting{event.needsReview?' · '+event.needsReview+' need re-review':''}</Text></div>
          <Badge color={event.needsReview?'orange':'blue'} variant="light">{event.count}</Badge>
        </Group>)}
      </Stack>
    </Paper>}

    <Text size="xs" c="dimmed">Work refreshes automatically while this page is open. Counts reflect the current production records visible to your MakLom role.</Text>
  </Stack>;
}
