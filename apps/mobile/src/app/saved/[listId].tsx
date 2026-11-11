import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { SpotCard } from '@/components/SpotCard';
import { AppText, Button, EmptyState, Field, LoadingState, Row, Screen } from '@/components/ui';
import { LocalStoreError } from '@/lib/db';
import { useSavedListSpots, useSavedLists, useSavedMutations } from '@/lib/hooks';
import { colors, spacing } from '@/theme/tokens';

export default function SavedList() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const lists = useSavedLists();
  const spots = useSavedListSpots(listId);
  const { renameList, deleteList, unsave } = useSavedMutations();
  const list = lists.data?.find((l) => l.id === listId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    setError(null);
    try {
      await renameList.mutateAsync({ id: listId, name });
      setRenaming(false);
    } catch (e) {
      setError(e instanceof LocalStoreError ? e.message : 'Could not rename the list.');
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete this list?',
      'The places stay in the app; only this list is removed from your phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteList.mutate(listId, { onSuccess: () => router.back() });
          },
        },
      ],
    );

  return (
    <Screen padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: list?.name ?? 'Saved list' }} />
      {spots.isPending ? (
        <LoadingState />
      ) : (
        <FlatList
          data={spots.data ?? []}
          keyExtractor={(item) => item.detail.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListHeaderComponent={
            <Row style={styles.header}>
              <Button
                label="Rename"
                kind="secondary"
                icon="create-outline"
                onPress={() => {
                  setName(list?.name ?? '');
                  setRenaming(true);
                }}
              />
              <Button
                label="Delete list"
                kind="danger"
                icon="trash-outline"
                onPress={confirmDelete}
              />
            </Row>
          }
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="This list is empty"
              body="Open a place and tap Save to add it here."
            />
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <SpotCard
                spot={{
                  slug: item.detail.slug,
                  name: item.detail.name,
                  category_label: item.detail.category.label,
                  locality: item.detail.locality,
                  discovery_labels: item.detail.discovery_labels,
                  thumb_path: item.detail.media[0]?.thumb_path ?? null,
                }}
                fetchedAt={item.cachedAt}
                onPress={() => router.push(`/spot/${item.detail.slug}`)}
              />
              <Button
                label="Remove from list"
                kind="ghost"
                onPress={() => unsave.mutate({ listId, spotId: item.detail.id })}
              />
            </View>
          )}
          ListFooterComponent={
            (spots.data?.length ?? 0) > 0 ? (
              <AppText variant="caption" color={colors.inkMuted} style={styles.footer}>
                Saved places open without a connection. Crowd levels are only shown live.
              </AppText>
            ) : undefined
          }
        />
      )}
      <Sheet visible={renaming} onClose={() => setRenaming(false)} title="Rename list">
        <Field
          label="List name"
          value={name}
          onChangeText={setName}
          maxLength={40}
          error={error}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void rename()}
        />
        <Button
          label="Save name"
          disabled={name.trim().length === 0}
          loading={renameList.isPending}
          onPress={() => void rename()}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { marginBottom: spacing.md },
  gap: { height: spacing.md },
  item: { gap: spacing.xs },
  footer: { marginTop: spacing.lg, textAlign: 'center' },
});
