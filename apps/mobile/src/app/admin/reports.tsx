import { PROBLEM_TYPE_TEXT, type ProblemType } from '@gupit/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  AppText,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Row,
  Screen,
} from '@/components/ui';
import { adminApi, adminErrorText, type UserReportRow } from '@/features/admin/api';
import { ReasonSheet, shortDate } from '@/features/admin/ui';
import { colors, spacing } from '@/theme/tokens';

export default function Reports() {
  const router = useRouter();
  const client = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const list = useQuery({
    queryKey: ['admin', 'reports', openOnly],
    queryFn: () => adminApi.userReports(openOnly),
    refetchOnMount: 'always',
  });
  const [closing, setClosing] = useState<{
    report: UserReportRow;
    status: 'resolved' | 'dismissed';
  } | null>(null);

  if (list.isPending)
    return (
      <Screen edges={['bottom']}>
        <LoadingState />
      </Screen>
    );
  if (list.isError)
    return (
      <Screen edges={['bottom']}>
        <ErrorState body={adminErrorText(list.error)} onRetry={() => void list.refetch()} />
      </Screen>
    );

  return (
    <Screen padded={false} edges={['bottom']}>
      <FlatList
        data={list.data}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Row>
              <Chip label="Open" selected={openOnly} onPress={() => setOpenOnly(true)} />
              <Chip label="All" selected={!openOnly} onPress={() => setOpenOnly(false)} />
            </Row>
            <AppText variant="caption" color={colors.inkMuted}>
              For a credible, immediate safety risk: open the place and suspend it first, then
              investigate.
            </AppText>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="flag-outline" title="No reports" />}
        renderItem={({ item }) => (
          <Card>
            <Row>
              {item.priority === 'high' ? (
                <Badge label="Safety or access" tone="busy" icon="warning-outline" />
              ) : null}
              <Badge
                label={PROBLEM_TYPE_TEXT[item.report_type as ProblemType] ?? item.report_type}
              />
              <Badge label={item.status.replace(/_/g, ' ')} />
            </Row>
            <AppText variant="subheading">{item.spots?.name ?? 'Place'}</AppText>
            {item.message ? <AppText>{item.message}</AppText> : null}
            <AppText variant="caption" color={colors.inkMuted}>
              {shortDate(item.created_at)}
            </AppText>
            <Row>
              <Button
                label="Open place"
                kind="secondary"
                onPress={() => router.push(`/admin/spots/${item.spot_id}`)}
              />
              {item.status !== 'resolved' && item.status !== 'dismissed' ? (
                <>
                  <Button
                    label="Resolve"
                    kind="ghost"
                    onPress={() => setClosing({ report: item, status: 'resolved' })}
                  />
                  <Button
                    label="Dismiss"
                    kind="ghost"
                    onPress={() => setClosing({ report: item, status: 'dismissed' })}
                  />
                </>
              ) : null}
            </Row>
          </Card>
        )}
      />
      <ReasonSheet
        visible={closing != null}
        title={closing?.status === 'resolved' ? 'Resolve report' : 'Dismiss report'}
        label="What was done?"
        confirmLabel="Confirm"
        onClose={() => setClosing(null)}
        onConfirm={async (note) => {
          if (!closing) return;
          await adminApi.resolveUserReport(closing.report.id, closing.status, note);
          await client.invalidateQueries({ queryKey: ['admin'] });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
    flexGrow: 1,
  },
  gap: { height: spacing.md },
  header: { gap: spacing.sm, marginBottom: spacing.md },
});
