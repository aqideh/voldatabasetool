import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  Center,
  Group,
  Loader,
  NavLink,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { loadMember, signIn, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import type { AppMember } from './lib/types';
import { DashboardView } from './features/dashboard/DashboardView';
import { LeadsView } from './features/leads/LeadsView';
import { VolunteersView } from './features/volunteers/VolunteersView';

const sections = ['Overview', 'Leads', 'Volunteers', 'Events', 'Attendance', 'Imports'] as const;
type Section = (typeof sections)[number];

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
      setPassword('');
    }
  }

  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <Paper withBorder shadow="sm" radius="xl" p="xl" w="100%" maw={420}>
        <Stack gap="md">
          <div>
            <Title order={1}>MakLom</Title>
            <Text c="dimmed">Volunteer operations database</Text>
          </div>
          <TextInput
            label="Email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Button loading={loading} onClick={() => void submit()}>Sign in</Button>
        </Stack>
      </Paper>
    </Center>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<AppMember | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [section, setSection] = useState<Section>('Volunteers');
  const [opened, { toggle, close }] = useDisclosure(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session) setMember(await loadMember(data.session));
        setInitialising(false);
      })
      .catch(() => setInitialising(false));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setMember(null);
        queryClient.clear();
        return;
      }

      setTimeout(() => {
        void loadMember(nextSession).then(setMember).catch(() => setMember(null));
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  if (initialising) return <Center mih="100vh"><Loader /></Center>;
  if (!session) return <LoginScreen />;

  if (!member?.active) {
    return (
      <Center mih="100vh" p="md">
        <Paper withBorder radius="xl" p="xl" maw={520}>
          <Stack>
            <Title order={2}>Access not authorised</Title>
            <Text c="dimmed">
              This Supabase account is signed in but is not an active MakLom member.
            </Text>
            <Button variant="light" onClick={() => void signOut()}>Sign out</Button>
          </Stack>
        </Paper>
      </Center>
    );
  }

  const canWrite = member.role === 'editor' || member.role === 'admin';

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <div>
              <Text fw={800} fz="lg">MakLom</Text>
              <Text size="xs" c="dimmed">Volunteer operations database</Text>
            </div>
          </Group>
          <Group gap="xs">
            <Badge variant="light">{member.role}</Badge>
            <Text size="sm" visibleFrom="sm">{session.user.email}</Text>
            <Button size="xs" variant="subtle" onClick={() => void signOut()}>Sign out</Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={4}>
          {sections.map((item) => (
            <NavLink
              key={item}
              label={item}
              active={section === item}
              onClick={() => {
                setSection(item);
                close();
              }}
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg="gray.0">
        <Box maw={1500} mx="auto">
          {section === 'Overview' && <DashboardView />}
          {section === 'Leads' && <LeadsView canWrite={canWrite} />}
          {section === 'Volunteers' && <VolunteersView canWrite={canWrite} />}
          {!['Overview', 'Leads', 'Volunteers'].includes(section) && (
            <Paper withBorder radius="lg" p="xl">
              <Title order={2}>{section}</Title>
              <Text c="dimmed" mt="sm">
                This section remains in the current MakLom while the v2 workflow is rebuilt.
              </Text>
            </Paper>
          )}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
