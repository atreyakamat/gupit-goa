import type { SpotCard as SpotCardModel } from '@gupit/shared';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SpotCard } from '@/components/SpotCard';
import { colors, spacing } from '@/theme/tokens';

export function SpotList({
  cards,
  fetchedAt,
  refreshing,
  onRefresh,
  empty,
  header,
}: {
  cards: SpotCardModel[];
  fetchedAt: number;
  refreshing: boolean;
  onRefresh: () => void;
  empty: ReactElement;
  header?: ReactElement;
}) {
  const router = useRouter();
  return (
    <FlatList
      data={cards}
      keyExtractor={(card) => card.id}
      renderItem={({ item }) => (
        <SpotCard
          spot={item}
          fetchedAt={fetchedAt}
          onPress={() => router.push(`/spot/${item.slug}`)}
        />
      )}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={8}
      windowSize={7}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    />
  );
}

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  separator: { height: spacing.md },
});
