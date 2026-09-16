import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MantineProvider,
  createTheme,
  AppShell,
  Burger,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  Badge,
  ActionIcon,
  Tooltip,
  Button,
  Divider,
} from '@mantine/core';

const NAV_ITEMS = [
  ['uploadView', 'Upload'],
  ['mergeView', 'Merge Review'],
  ['databaseView', 'Central Database'],
  ['eventLogView', 'Event Log'],
  ['formAttendanceView', 'Form Attendance'],
  ['eventsView', 'Events'],
  ['dashboardView', 'Dashboard'],
  ['exportView', 'Export'],
  ['duplicatesView', 'Suspected Duplicates'],
];

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
});

function legacyNav() {
  return document.querySelector('#sharedAppShell > nav, body > nav');
}

function legacyButton(view) {
  return legacyNav()?.querySelector(`button[data-view="${view}"]`) || null;
}

function currentLegacyView() {
  const active = document.querySelector('main .view.active');
  return active?.id || 'uploadView';
}

function syncSnapshot() {
  const sync = document.getElementById('sharedSyncStatus');
  const account = document.getElementById('sharedAccountLabel');
  return {
    duplicateCount: (document.getElementById('dupCount')?.textContent || '0').trim(),
    syncLabel: (sync?.textContent || '').trim(),
    syncKind: sync?.classList.contains('bad') ? 'red' : sync?.classList.contains('ok') ? 'green' : 'gray',
    accountLabel: (account?.textContent || '').trim(),
  };
}

function Shell() {
  const [mobileOpened, setMobileOpened] = useState(false);
  const [activeView, setActiveView] = useState(currentLegacyView());
  const [snapshot, setSnapshot] = useState(syncSnapshot());
  const [, forceSync] = useState(0);

  useEffect(() => {
    document.body.classList.add('mantine-shell-active');

    const sync = () => {
      setActiveView(currentLegacyView());
      setSnapshot(syncSnapshot());
      forceSync((value) => value + 1);
    };
    sync();

    const observer = new MutationObserver(sync);
    const main = document.querySelector('main');
    const nav = legacyNav();
    if (main) observer.observe(main, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (nav) observer.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });

    window.addEventListener('maklom:access-state', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('maklom:access-state', sync);
      document.body.classList.remove('mantine-shell-active');
    };
  }, []);

  const items = NAV_ITEMS.filter(([view]) => view !== 'eventsView' || !!legacyButton(view));

  function go(view) {
    const button = legacyButton(view);
    if (!button) return;
    button.click();
    setActiveView(view);
    setMobileOpened(false);
  }

  function clickLegacy(id) {
    document.getElementById(id)?.click();
    setMobileOpened(false);
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding={0}
    >
      <AppShell.Header className="maklom-mantine-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={mobileOpened} onClick={() => setMobileOpened((value) => !value)} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <div>
              <Title order={3} lh={1.05}>MakLom</Title>
              <Text size="xs" c="dimmed" visibleFrom="xs">Volunteer data management</Text>
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {snapshot.syncLabel ? <Badge variant="light" color={snapshot.syncKind} visibleFrom="xs">{snapshot.syncLabel}</Badge> : null}
            <Tooltip label="About MakLom">
              <ActionIcon variant="light" size="lg" radius="md" aria-label="About MakLom" onClick={() => clickLegacy('infoTab')}>i</ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="maklom-mantine-navbar">
        <ScrollArea type="auto" h="100%">
          <Stack gap={3} p="sm">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" py={6}>Workspace</Text>
            {items.map(([view, label]) => (
              <NavLink
                key={view}
                label={label}
                active={activeView === view}
                onClick={() => go(view)}
                rightSection={view === 'duplicatesView' && snapshot.duplicateCount !== '0' ? <Badge size="sm" variant="light">{snapshot.duplicateCount}</Badge> : null}
                variant="light"
                bdrs="md"
              />
            ))}
            <Divider my="sm" />
            {snapshot.accountLabel ? <Text size="xs" c="dimmed" px="sm" className="maklom-account-label">{snapshot.accountLabel}</Text> : null}
            <Group grow gap="xs" px="xs">
              <Button size="compact-sm" variant="light" onClick={() => clickLegacy('sharedRefresh')}>Refresh</Button>
              <Button size="compact-sm" variant="default" onClick={() => clickLegacy('sharedSignOut')}>Sign out</Button>
            </Group>
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>
    </AppShell>
  );
}

const mount = document.getElementById('mantineShell');
if (mount) {
  createRoot(mount).render(
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Shell />
    </MantineProvider>
  );
}
