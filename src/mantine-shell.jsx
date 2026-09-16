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

function legacyButton(view) {
  return document.querySelector(`body > nav button[data-view="${view}"]`);
}

function currentLegacyView() {
  const active = document.querySelector('main .view.active');
  return active?.id || 'uploadView';
}

function Shell() {
  const [mobileOpened, setMobileOpened] = useState(false);
  const [activeView, setActiveView] = useState(currentLegacyView());
  const [duplicateCount, setDuplicateCount] = useState('0');
  const [, forceSync] = useState(0);

  useEffect(() => {
    document.body.classList.add('mantine-shell-active');

    const sync = () => {
      setActiveView(currentLegacyView());
      const count = document.getElementById('dupCount');
      setDuplicateCount((count?.textContent || '0').trim());
      forceSync((value) => value + 1);
    };
    sync();

    const observer = new MutationObserver(sync);
    const main = document.querySelector('main');
    const legacyNav = document.querySelector('body > nav');
    if (main) observer.observe(main, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (legacyNav) observer.observe(legacyNav, { subtree: true, childList: true, characterData: true });

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

  function openInfo() {
    document.getElementById('infoTab')?.click();
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
          <Tooltip label="About MakLom">
            <ActionIcon variant="light" size="lg" radius="md" aria-label="About MakLom" onClick={openInfo}>i</ActionIcon>
          </Tooltip>
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
                rightSection={view === 'duplicatesView' && duplicateCount !== '0' ? <Badge size="sm" variant="light">{duplicateCount}</Badge> : null}
                variant="light"
                bdrs="md"
              />
            ))}
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
