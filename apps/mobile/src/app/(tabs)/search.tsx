import { countActiveFilters } from '@gupit/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { OfflineBanner } from '@/components/OfflineBanner';
import {
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Row,
  Screen,
} from '@/components/ui';
import { SpotList } from '@/features/explore/SpotList';
import { track } from '@/lib/analytics';
import { useBrowseCards } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import { colors, spacing } from '@/theme/tokens';

const IDEAS = [
  'Cafés',
  'Beaches',
  'Forts',
  'Waterfalls',
  'Pubs',
  'Clubs',
  'Markets',
  'Sunset',
  'Quiet café',
  'Family-friendly beach',
];

export default function Search() {
  const router = useRouter();
  const { filters, position } = useAppStore();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  // Debounce typing so a weak connection is not flooded with requests.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    // The search text itself is never sent to analytics.
    if (query.length >= 2) track('search_submitted', { length: query.length });
  }, [query]);

  const active = query.length >= 2;
  const results = useBrowseCards({
    query: active ? query : null,
    filters,
    origin: position,
    enabled: active,
  });
  const filterCount = countActiveFilters(filters);

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <AppText variant="title" accessibilityRole="header">
          Search
        </AppText>
        <Field
          label="Search places"
          placeholder="Place, type or locality"
          value={text}
          onChangeText={setText}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          maxLength={80}
        />
        {filterCount ? (
          <Row>
            <AppText variant="caption" color={colors.inkMuted}>
              {filterCount} filter{filterCount === 1 ? '' : 's'} also applied.
            </AppText>
            <Button label="Edit filters" kind="ghost" onPress={() => router.push('/filters')} />
          </Row>
        ) : null}
      </View>
      <OfflineBanner />
      {!active ? (
        <View style={styles.ideas}>
          <AppText variant="label" color={colors.inkMuted}>
            Try
          </AppText>
          <Row>
            {IDEAS.map((idea) => (
              <Chip key={idea} label={idea} onPress={() => setText(idea)} />
            ))}
          </Row>
        </View>
      ) : results.isPending ? (
        <LoadingState label="Searching" />
      ) : results.isError && !results.data ? (
        <ErrorState onRetry={() => void results.refetch()} />
      ) : (
        <SpotList
          cards={results.data?.cards ?? []}
          fetchedAt={results.data?.fetchedAt ?? 0}
          refreshing={results.isRefetching}
          onRefresh={() => void results.refetch()}
          empty={
            <EmptyState
              icon="search-outline"
              title={`Nothing found for "${query}"`}
              body="Check the spelling, or try a type of place such as cafés or forts."
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  ideas: { paddingHorizontal: spacing.lg, gap: spacing.sm },
});
