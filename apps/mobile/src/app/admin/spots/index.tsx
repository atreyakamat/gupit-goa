import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Row,
  Screen,
} from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { ListRow, shortDate } from '@/features/admin/ui';
import { useCategories } from '@/lib/hooks';
import { spacing } from '@/theme/tokens';

const STATUSES: [string | null, string][] = [
  ['review', 'In review'],
  ['published', 'Published'],
  ['stale', 'Stale'],
  ['suspended', 'Suspended'],
  ['draft', 'Draft'],
  ['withdrawn', 'Withdrawn'],
  [null, 'All'],
];

export default function Spots() {
  const router = useRouter();
  const client = useQueryClient();
  const categories = useCategories();
  const [status, setStatus] = useState<string | null>('review');
  const list = useQuery({
    queryKey: ['admin', 'spots', status],
    queryFn: () => adminApi.spots(status),
    refetchOnMount: 'always',
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await adminApi.saveSpot(null, { name, primary_category_slug: category }, null);
      setCreating(false);
      setName('');
      await client.invalidateQueries({ queryKey: ['admin'] });
      router.push(`/admin/spots/${id}`);
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false} edges={['bottom']}>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {STATUSES.map(([value, label]) => (
            <Chip
              key={label}
              label={label}
              selected={status === value}
              onPress={() => setStatus(value)}
            />
          ))}
        </ScrollView>
      </View>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState body={adminErrorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListHeaderComponent={
            <Button
              label="New place (visited by the team)"
              kind="secondary"
              icon="add"
              onPress={() => setCreating(true)}
              style={styles.add}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="location-outline" title="No places with this status" />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={`${[item.locality, item.region].filter(Boolean).join(' · ')} · checked ${shortDate(item.last_verified_at)}`}
              right={
                <View style={styles.right}>
                  <Badge
                    label={item.verification_status}
                    tone={item.verification_status === 'published' ? 'quiet' : 'neutral'}
                  />
                  {item.safety_blocked ? <Badge label="Blocked" tone="busy" /> : null}
                </View>
              }
              onPress={() => router.push(`/admin/spots/${item.id}`)}
            />
          )}
        />
      )}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="New place">
        <AppText variant="caption">
          Starts as a draft. It is not public until the checklist passes and you publish it.
        </AppText>
        <Field label="Name" value={name} onChangeText={setName} maxLength={120} />
        <AppText variant="label">Category</AppText>
        <Row>
          {(categories.data ?? [])
            .filter((c) => c.parent_slug != null)
            .map((c) => (
              <Chip
                key={c.slug}
                label={c.label}
                selected={category === c.slug}
                onPress={() => setCategory(c.slug)}
              />
            ))}
        </Row>
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <Button
          label="Create draft"
          disabled={name.trim().length < 2 || !category}
          loading={busy}
          onPress={() => void create()}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  gap: { height: spacing.sm },
  add: { marginBottom: spacing.md },
  right: { alignItems: 'flex-end', gap: 4 },
});
