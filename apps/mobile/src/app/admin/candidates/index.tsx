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
  Screen,
} from '@/components/ui';
import { adminApi, adminErrorText } from '@/features/admin/api';
import { ListRow } from '@/features/admin/ui';
import { colors, spacing } from '@/theme/tokens';

const STATUSES: [string | null, string][] = [
  ['ready_for_review', 'Ready'],
  ['blocked', 'Blocked'],
  ['needs_more_evidence', 'Needs evidence'],
  ['new', 'Low confidence'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['merged', 'Merged'],
  [null, 'All'],
];

export default function Candidates() {
  const router = useRouter();
  const client = useQueryClient();
  const [status, setStatus] = useState<string | null>('ready_for_review');
  const list = useQuery({
    queryKey: ['admin', 'candidates', status],
    queryFn: () => adminApi.candidates(status),
    refetchOnMount: 'always',
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addLead = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await adminApi.addLead(name, url.trim() || null, note.trim() || null);
      setAdding(false);
      setName('');
      setUrl('');
      setNote('');
      await client.invalidateQueries({ queryKey: ['admin'] });
      router.push(`/admin/candidates/${id}`);
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
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListHeaderComponent={
            <Button
              label="Add a lead or tip"
              kind="secondary"
              icon="add"
              onPress={() => setAdding(true)}
              style={styles.add}
            />
          }
          ListEmptyComponent={<EmptyState icon="file-tray-outline" title="Nothing in this queue" />}
          renderItem={({ item }) => {
            const blocks = item.risk_flags.filter(
              (f) => f.severity === 'block' && !f.resolved_at,
            ).length;
            return (
              <ListRow
                title={item.candidate_name}
                subtitle={[
                  item.proposed_category_slug ?? 'no category',
                  item.proposed_locality,
                  item.discovered_by === 'manual' ? 'manual lead' : 'research worker',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <View style={styles.right}>
                    {item.confidence_score != null ? (
                      <Badge
                        label={`${item.confidence_score}`}
                        tone={
                          item.confidence_score >= 80
                            ? 'quiet'
                            : item.confidence_score >= 60
                              ? 'moderate'
                              : 'neutral'
                        }
                      />
                    ) : null}
                    {blocks ? (
                      <Badge label={`${blocks} block`} tone="busy" icon="warning-outline" />
                    ) : null}
                  </View>
                }
                onPress={() => router.push(`/admin/candidates/${item.id}`)}
              />
            );
          }}
        />
      )}
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a lead or tip">
        <AppText variant="caption" color={colors.inkMuted}>
          Paste a link (an Instagram post is fine) or write a local tip. Nothing is fetched from the
          site: the link and your own note are stored as a lead to verify. Do not copy captions or
          download media.
        </AppText>
        <Field label="Place name" value={name} onChangeText={setName} maxLength={160} />
        <Field
          label="Link (optional)"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field
          label="Your note (optional)"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          hint="In your own words: what it is, who told you, what to check."
        />
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <Button
          label="Add to queue"
          disabled={name.trim().length < 2}
          loading={busy}
          onPress={() => void addLead()}
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
