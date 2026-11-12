import { Redirect, Stack } from 'expo-router';
import { useAppStore } from '@/store/app';
import { colors } from '@/theme/tokens';

/**
 * Admin area. Hidden from guests, and every server call re-checks the reviewer allowlist,
 * so reaching these screens without being an admin shows nothing and can change nothing.
 */
export default function AdminLayout() {
  const isAdmin = useAppStore((s) => s.isAdmin);
  if (!isAdmin) return <Redirect href="/team-sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Review and admin' }} />
      <Stack.Screen name="candidates/index" options={{ title: 'Review queue' }} />
      <Stack.Screen name="candidates/[id]" options={{ title: 'Candidate' }} />
      <Stack.Screen name="spots/index" options={{ title: 'Places' }} />
      <Stack.Screen name="spots/[id]" options={{ title: 'Edit place' }} />
      <Stack.Screen name="partners/index" options={{ title: 'Partners' }} />
      <Stack.Screen name="partners/[id]" options={{ title: 'Partner' }} />
      <Stack.Screen name="reports" options={{ title: 'Problem reports' }} />
      <Stack.Screen name="research" options={{ title: 'Research worker' }} />
      <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
    </Stack>
  );
}
