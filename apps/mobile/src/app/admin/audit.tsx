import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet, View } from 'react-native';
import { AppText, Badge, EmptyState, ErrorState, LoadingState, Row, Screen } from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { colors, spacing } from '@/theme/tokens';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Read-only. Rows are written by the server inside the same transaction as the change. */
export default function Audit() {
  const list = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: adminApi.audit,
    refetchOnMount: 'always',
  });
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
        keyExtractor={(row) => String(row.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.rule} />}
        ListEmptyComponent={<EmptyState icon="reader-outline" title="Nothing logged yet" />}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Row>
              <Badge
                label={item.action}
                tone={
                  /suspend|block|reject|withdraw|delete/.test(item.action)
                    ? 'busy'
                    : /publish|approve/.test(item.action)
                      ? 'quiet'
                      : 'neutral'
                }
              />
              <AppText variant="caption" color={colors.inkMuted}>
                {when(item.created_at)}
              </AppText>
            </Row>
            <AppText variant="caption" color={colors.inkMuted}>
              {item.entity_type} {item.entity_id?.slice(0, 8) ?? ''} · by{' '}
              {item.actor_user_id?.slice(0, 8) ?? 'system'}
            </AppText>
            {item.reason ? <AppText>{item.reason}</AppText> : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexGrow: 1 },
  item: { gap: 4, paddingVertical: spacing.sm },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
