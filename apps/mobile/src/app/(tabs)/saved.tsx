import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { AppText, Button, EmptyState, Field, LoadingState, Screen } from '@/components/ui';
import { LocalStoreError } from '@/lib/db';
import { useSavedLists, useSavedMutations } from '@/lib/hooks';
import { colors, elevation, radius, spacing } from '@/theme/tokens';

export default function Saved() {
  const router = useRouter();
  const lists = useSavedLists();
  const { createList } = useSavedMutations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      await createList.mutateAsync(name);
      setName('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof LocalStoreError ? e.message : 'Could not create the list.');
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header" style={styles.flex}>
          Saved
        </AppText>
        <Button label="New list" kind="secondary" icon="add" onPress={() => setOpen(true)} />
      </View>
      {lists.isPending ? (
        <LoadingState />
      ) : (
        <FlatList
          data={lists.data ?? []}
          keyExtractor={(list) => list.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="Nothing saved yet"
              body="Tap the bookmark on any place to save it. Lists stay on this phone and work offline. No account needed."
              action={
                <Button
                  label="Find places"
                  kind="secondary"
                  icon="compass-outline"
                  onPress={() => router.push('/(tabs)')}
                />
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/saved/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.count} place${item.count === 1 ? '' : 's'}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Ionicons name="bookmark" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <AppText variant="subheading">{item.name}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  {item.count} place{item.count === 1 ? '' : 's'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
            </Pressable>
          )}
        />
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="New list">
        <Field
          label="List name"
          placeholder="Goa trip"
          value={name}
          onChangeText={setName}
          maxLength={40}
          error={error}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void create()}
        />
        <Button
          label="Create list"
          disabled={name.trim().length === 0}
          loading={createList.isPending}
          onPress={() => void create()}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  gap: { height: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    ...elevation.card,
  },
  pressed: { opacity: 0.75 },
});
