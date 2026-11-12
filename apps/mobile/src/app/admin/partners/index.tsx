import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { AppText, Badge, EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { ListRow, shortDate } from '@/features/admin/ui';
import { colors, spacing } from '@/theme/tokens';

export default function Partners() {
  const router = useRouter();
  const list = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: adminApi.partners,
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
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListHeaderComponent={
          <AppText variant="caption" color={colors.inkMuted} style={styles.note}>
            To add a partner, open the place in Places and choose "Add a partner for this place". A
            partnership never changes crowd levels, safety notes or ranking.
          </AppText>
        }
        ListEmptyComponent={<EmptyState icon="storefront-outline" title="No partners yet" />}
        renderItem={({ item }) => (
          <ListRow
            title={item.business_name}
            subtitle={`${item.spots?.name ?? 'Place'} · from ${shortDate(item.starts_at)}${item.ends_at ? ` to ${shortDate(item.ends_at)}` : ''}`}
            right={
              <Badge
                label={item.partner_status}
                tone={
                  item.partner_status === 'active' || item.partner_status === 'pilot'
                    ? 'quiet'
                    : 'neutral'
                }
              />
            }
            onPress={() => router.push(`/admin/partners/${item.id}`)}
          />
        )}
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
  gap: { height: spacing.sm },
  note: { marginBottom: spacing.md },
});
