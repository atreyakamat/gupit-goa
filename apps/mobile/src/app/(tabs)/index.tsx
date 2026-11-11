import { countActiveFilters, toggle } from '@gupit/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { OfflineBanner } from '@/components/OfflineBanner';
import {
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Screen,
} from '@/components/ui';
import { SpotList } from '@/features/explore/SpotList';
import { SpotMap } from '@/features/explore/SpotMap';
import { useNearMe } from '@/features/explore/useNearMe';
import { track } from '@/lib/analytics';
import { isBackendConfigured } from '@/lib/env';
import { useBrowseCards, useCategories, useViewportCards, type Bounds } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import { colors, spacing } from '@/theme/tokens';

export default function Explore() {
  const router = useRouter();
  const { filters, setFilters, resetFilters, viewMode, setViewMode, position } = useAppStore();
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const categories = useCategories();
  const nearMe = useNearMe();
  const activeCount = countActiveFilters(filters);

  const browse = useBrowseCards({
    query: null,
    filters,
    origin: position,
    enabled: viewMode === 'list',
  });
  const viewport = useViewportCards(viewMode === 'map' ? bounds : null, filters);

  useEffect(() => {
    track('explore_viewed');
  }, []);
  useEffect(() => {
    track(viewMode === 'map' ? 'map_viewed' : 'list_viewed');
  }, [viewMode]);

  const groups = (categories.data ?? []).filter((c) => c.parent_slug == null);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header" style={styles.title}>
          Explore Goa
        </AppText>
        <IconButton
          icon={viewMode === 'map' ? 'list-outline' : 'map-outline'}
          label={viewMode === 'map' ? 'Show as list' : 'Show on map'}
          onPress={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
        />
        <IconButton
          icon="options-outline"
          label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
          active={activeCount > 0}
          onPress={() => router.push('/filters')}
        />
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="Near me"
            icon="locate-outline"
            selected={position != null}
            onPress={() => (position ? nearMe.clear() : void nearMe.start())}
          />
          {groups.map((group) => (
            <Chip
              key={group.slug}
              label={group.label}
              selected={filters.categorySlugs.includes(group.slug)}
              onPress={() => {
                setFilters({
                  ...filters,
                  categorySlugs: toggle(filters.categorySlugs, group.slug),
                });
                track('filter_applied', { kind: 'category' });
              }}
            />
          ))}
        </ScrollView>
      </View>

      <OfflineBanner />

      {!isBackendConfigured ? (
        <View style={styles.padded}>
          <Notice tone="warning">
            This build is not connected to a backend yet. Add the Supabase URL and anon key to
            apps/mobile/.env and rebuild.
          </Notice>
        </View>
      ) : viewMode === 'map' ? (
        <SpotMap
          cards={viewport.data?.cards ?? []}
          fetchedAt={viewport.data?.fetchedAt ?? 0}
          position={position}
          onBoundsChange={setBounds}
          onOpen={(slug) => router.push(`/spot/${slug}`)}
          onNearMe={() => void nearMe.start()}
        />
      ) : browse.isPending ? (
        <LoadingState label="Finding places" />
      ) : browse.isError && !browse.data ? (
        <ErrorState onRetry={() => void browse.refetch()} />
      ) : (
        <SpotList
          cards={browse.data?.cards ?? []}
          fetchedAt={browse.data?.fetchedAt ?? 0}
          refreshing={browse.isRefetching}
          onRefresh={() => void browse.refetch()}
          header={
            <AppText variant="caption" color={colors.inkMuted} style={styles.count}>
              {browse.data?.cards.length ?? 0} places{position ? ', nearest first' : ''}
              {activeCount ? ` · ${activeCount} filter${activeCount === 1 ? '' : 's'}` : ''}
            </AppText>
          }
          empty={
            <EmptyState
              title="No places match"
              body={
                activeCount
                  ? 'Try removing a filter or widening the distance.'
                  : 'The catalogue is still being built. Check back soon.'
              }
              action={
                activeCount ? (
                  <Button label="Clear all filters" kind="secondary" onPress={resetFilters} />
                ) : undefined
              }
            />
          }
        />
      )}
      {nearMe.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { flex: 1 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  padded: { paddingHorizontal: spacing.lg },
  count: { marginBottom: spacing.sm },
});
