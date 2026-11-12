import {
  DISCOVERY_LABEL_TEXT,
  cardCrowdLabel,
  formatDistance,
  type CrowdLevel,
  type DiscoveryLabel,
} from '@gupit/shared';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { mediaUrl } from '@/lib/api';
import { colors, elevation, radius, spacing } from '@/theme/tokens';
import { CategoryArt } from './CategoryArt';
import { AppText, Badge } from './ui';

export interface SpotCardData {
  slug: string;
  name: string;
  category_slug?: string | null;
  category_label: string;
  locality: string | null;
  discovery_labels: string[];
  thumb_path: string | null;
  is_partner?: boolean;
  partner_label?: string | null;
  crowd_status?: string | null;
  crowd_level?: CrowdLevel | null;
  distance_m?: number | null;
  needs_recheck?: boolean;
  temporarily_unavailable?: boolean;
}

const crowdTone = { 1: 'quiet', 2: 'moderate', 3: 'busy' } as const;
const crowdIcon = { 1: 'leaf-outline', 2: 'people-outline', 3: 'people' } as const;

export function discoveryLabelText(labels: string[]): string | null {
  const first = labels.find((l): l is DiscoveryLabel => l in DISCOVERY_LABEL_TEXT);
  return first ? DISCOVERY_LABEL_TEXT[first] : null;
}

/**
 * A place in a list. Shows only what is known: no star ratings, no review counts, a
 * distance only when the user shared a location, and a crowd chip only for fresh live data.
 */
export const SpotCard = memo(function SpotCard({
  spot,
  fetchedAt,
  onPress,
  note,
}: {
  spot: SpotCardData;
  fetchedAt: number;
  onPress: () => void;
  note?: string;
}) {
  const crowd = cardCrowdLabel(
    { crowd_status: spot.crowd_status ?? null, crowd_level: spot.crowd_level ?? null },
    fetchedAt,
    Date.now(),
  );
  const distance = formatDistance(spot.distance_m);
  const label = discoveryLabelText(spot.discovery_labels);
  const thumb = mediaUrl(spot.thumb_path);
  const summary = [
    spot.name,
    spot.category_label,
    spot.locality,
    spot.is_partner ? (spot.partner_label ?? 'Partner') : null,
    label,
    crowd ? `${crowd} now` : null,
    distance ? `${distance} away` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={summary}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {thumb ? (
        <Image
          source={{ uri: thumb }}
          style={styles.thumb}
          contentFit="cover"
          transition={150}
          accessible={false}
        />
      ) : (
        <CategoryArt categorySlug={spot.category_slug} size={34} style={styles.thumb} />
      )}
      <View style={styles.body}>
        <AppText variant="subheading" numberOfLines={2}>
          {spot.name}
        </AppText>
        <AppText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {[spot.category_label, spot.locality].filter(Boolean).join(' · ')}
          {distance ? ` · ${distance}` : ''}
        </AppText>
        <View style={styles.badges}>
          {spot.is_partner ? (
            <Badge label={spot.partner_label ?? 'Partner'} tone="accent" icon="pricetag-outline" />
          ) : null}
          {label ? <Badge label={label} tone="primary" /> : null}
          {crowd && spot.crowd_level ? (
            <Badge
              label={`${crowd} now`}
              tone={crowdTone[spot.crowd_level]}
              icon={crowdIcon[spot.crowd_level]}
            />
          ) : null}
          {spot.temporarily_unavailable ? (
            <Badge label="Temporarily unavailable" tone="warning" icon="alert-circle-outline" />
          ) : null}
          {spot.needs_recheck ? (
            <Badge label="Details need rechecking" tone="warning" icon="time-outline" />
          ) : null}
        </View>
        {note ? (
          <AppText variant="caption" color={colors.inkMuted}>
            {note}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    ...elevation.card,
  },
  pressed: { opacity: 0.75 },
  thumb: { width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  body: { flex: 1, gap: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
});
