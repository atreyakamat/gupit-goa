import { CROWD_RULES, formatDistance, type Alternative } from '@gupit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SpotCard } from '@/components/SpotCard';
import { AppText, ErrorState, LoadingState, Notice, Section } from '@/components/ui';
import { useAlternatives } from '@/lib/hooks';
import { colors, spacing } from '@/theme/tokens';

/** Says why a place is suggested, and never calls it quieter without live evidence. */
export function alternativeReason(alt: Alternative): string {
  const distance = formatDistance(alt.distance_m) ?? 'nearby';
  const type = alt.same_category ? 'Same type of place' : 'Similar type of place';
  return alt.reason === 'quieter'
    ? `${type}, ${distance} away, quieter based on recent reports.`
    : `${type}, ${distance} away. No live crowd data to compare.`;
}

export function AlternativesSection({ spotId }: { spotId: string }) {
  const router = useRouter();
  const query = useAlternatives(spotId, true);
  const radiusKm = Math.round(
    (query.data?.radius_m ?? CROWD_RULES.alternativesRadiusMetres) / 1000,
  );

  return (
    <Section title="Try instead">
      {query.isPending ? (
        <LoadingState label="Looking for alternatives" />
      ) : query.isError ? (
        <ErrorState body="Alternatives need a connection." onRetry={() => void query.refetch()} />
      ) : query.data.alternatives.length === 0 ? (
        <AppText color={colors.inkMuted}>
          There is no similar, verified place within {radiusKm} km that we can suggest right now.
        </AppText>
      ) : (
        <View style={styles.list}>
          {!query.data.crowd_comparison_available ? (
            <Notice>
              These are similar places within {radiusKm} km. There is not enough live crowd data to
              say whether they are quieter.
            </Notice>
          ) : null}
          {query.data.alternatives.map((alt) => (
            <SpotCard
              key={alt.id}
              spot={{ ...alt, crowd_status: alt.reason === 'quieter' ? alt.crowd_status : null }}
              fetchedAt={query.dataUpdatedAt}
              note={alternativeReason(alt)}
              onPress={() => router.push(`/spot/${alt.slug}`)}
            />
          ))}
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
