import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Paper, Stack, Text, Title } from '@mantine/core';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MakLom Data Dashboard render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Paper withBorder radius="lg" p="lg">
        <Stack gap="sm" align="flex-start">
          <Title order={3}>Data Dashboard could not be displayed</Title>
          <Text size="sm" c="dimmed">
            This section encountered an unexpected error. Other MakLom sections are still available.
          </Text>
          <Button variant="light" onClick={() => this.setState({ hasError: false })}>
            Try again
          </Button>
        </Stack>
      </Paper>
    );
  }
}
