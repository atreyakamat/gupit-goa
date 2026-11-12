import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  AppText,
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { signOutReviewer } from '@/features/admin/session';
import { ListRow, shortDate } from '@/features/admin/ui';
import { colors } from '@/theme/tokens';

const n = (map: Record<string, number> | undefined, key: string) => map?.[key] ?? 0;

export default function AdminHome() {
  const router = useRouter();
  const dash = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminApi.dashboard,
    refetchOnMount: 'always',
  });
  const stats = useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn: () => adminApi.analytics(30),
  });

  if (dash.isPending)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );
  if (dash.isError)
    return (
      <Screen edges={['bottom']}>
        <ErrorState body={adminErrorText(dash.error)} onRetry={() => void dash.refetch()} />
      </Screen>
    );
  const d = dash.data;
  const events = (stats.data?.events ?? {}) as Record<string, number>;
  const crowd = (stats.data?.crowd_reports ?? {}) as Record<string, number>;

  return (
    <Screen scroll edges={['bottom']}>
      {d.high_priority_reports > 0 ? (
        <Notice tone="danger">
          {d.high_priority_reports} safety or access report(s) need attention first.
        </Notice>
      ) : null}
      {d.research_errors_24h > 0 ? (
        <Notice tone="warning">
          {d.research_errors_24h} research error(s) in the last 24 hours. See Research worker.
        </Notice>
      ) : null}

      <Section title="To do">
        <View style={{ gap: 8 }}>
          <ListRow
            title="Review queue"
            subtitle={`${n(d.candidates, 'ready_for_review')} ready · ${n(d.candidates, 'blocked')} blocked · ${n(d.candidates, 'needs_more_evidence')} need evidence · ${n(d.candidates, 'new')} low confidence`}
            onPress={() => router.push('/admin/candidates')}
          />
          <ListRow
            title="Places"
            subtitle={`${n(d.spots, 'published')} published · ${n(d.spots, 'review')} in review · ${n(d.spots, 'stale')} stale · ${d.stale_listings} not checked in 180 days`}
            onPress={() => router.push('/admin/spots')}
          />
          <ListRow
            title="Problem reports"
            subtitle={`${d.open_user_reports} open`}
            onPress={() => router.push('/admin/reports')}
            right={d.high_priority_reports ? <Badge label="Urgent" tone="busy" /> : undefined}
          />
          <ListRow
            title="Partners"
            subtitle={`${d.active_partners} active`}
            onPress={() => router.push('/admin/partners')}
          />
          <ListRow
            title="Research worker"
            subtitle={
              d.workers[0]
                ? `Last seen ${shortDate(d.workers[0].last_seen_at)} · ${n(d.jobs, 'queued')} queued · ${n(d.jobs, 'failed')} failed`
                : 'No worker has checked in yet'
            }
            onPress={() => router.push('/admin/research')}
          />
          <ListRow
            title="Audit log"
            subtitle="Every publish, edit, merge and decision"
            onPress={() => router.push('/admin/audit')}
          />
        </View>
      </Section>

      <Section title="Last 30 days">
        <Card>
          <AppText variant="caption" color={colors.inkMuted}>
            Anonymous counts. No coordinates, search text or message content is collected.
          </AppText>
          <Row>
            <Badge label={`${String(stats.data?.sessions ?? 0)} sessions`} />
            <Badge label={`${events.spot_opened ?? 0} place views`} />
            <Badge label={`${events.spot_saved ?? 0} saves`} />
            <Badge label={`${events.directions_opened ?? 0} directions`} />
            <Badge label={`${events.partner_whatsapp_tapped ?? 0} WhatsApp taps`} />
            <Badge label={`${crowd.valid ?? 0} valid crowd reports`} />
            <Badge label={`${crowd.rejected_too_far ?? 0} rejected: too far`} />
          </Row>
          <AppText variant="caption" color={colors.inkMuted}>
            A WhatsApp tap is enquiry intent. It is not a confirmed enquiry, booking or sale.
          </AppText>
        </Card>
      </Section>

      <Button
        label="Sign out"
        kind="ghost"
        onPress={() => void signOutReviewer().then(() => router.replace('/(tabs)/more'))}
      />
    </Screen>
  );
}
