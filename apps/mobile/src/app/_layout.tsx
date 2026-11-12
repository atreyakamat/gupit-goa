import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorState, Screen } from '@/components/ui';
import { refreshAccount, syncAccountSoon } from '@/features/account/session';
import { refreshAdminFlag } from '@/features/admin/session';
import { flushEvents, track } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { colors } from '@/theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Bounded retry with backoff for flaky mobile networks.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      gcTime: 30 * 60_000,
    },
  },
});

/** Shown if a screen throws while rendering, instead of a crash. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error('render_error', error);
  }, [error]);
  return (
    <Screen>
      <ErrorState
        title="This screen hit a problem"
        body="Nothing was lost. Try again."
        onRetry={() => void retry()}
      />
    </Screen>
  );
}

export default function RootLayout() {
  useEffect(() => {
    track('app_opened');
    void refreshAdminFlag();
    void refreshAccount().then(() => syncAccountSoon());
    const timer = setInterval(() => void flushEvents(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushEvents();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.ink,
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="filters" options={{ title: 'Filters', presentation: 'modal' }} />
          <Stack.Screen name="spot/[slug]" options={{ title: '' }} />
          <Stack.Screen
            name="report"
            options={{ title: 'Report a problem', presentation: 'modal' }}
          />
          <Stack.Screen name="saved/[listId]" options={{ title: 'Saved list' }} />
          <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
          <Stack.Screen name="about" options={{ title: 'About and verification' }} />
          <Stack.Screen name="partner-link" options={{ title: 'Link partner device' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="team-sign-in" options={{ title: 'Team sign-in' }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
