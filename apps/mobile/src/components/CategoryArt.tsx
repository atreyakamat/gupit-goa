import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Group =
  | 'eat-drink'
  | 'beaches-coast'
  | 'nature-outdoors'
  | 'sightseeing-heritage'
  | 'culture-local-life'
  | 'activities-experiences'
  | 'stay';

const PALETTE: Record<Group, { background: string; foreground: string }> = {
  'eat-drink': { background: '#F6E3D8', foreground: '#B5532A' },
  'beaches-coast': { background: '#D6EEF2', foreground: '#0E6E86' },
  'nature-outdoors': { background: '#DDF1E4', foreground: '#22693F' },
  'sightseeing-heritage': { background: '#ECE4F5', foreground: '#5B3E96' },
  'culture-local-life': { background: '#FDF1D7', foreground: '#8A5A0B' },
  'activities-experiences': { background: '#E1ECFB', foreground: '#1F5FA8' },
  stay: { background: '#EFE8DA', foreground: '#14213D' },
};

const CATEGORY: Record<string, [Group, IconName]> = {
  cafe: ['eat-drink', 'cafe'],
  restaurant: ['eat-drink', 'restaurant'],
  'beach-shack': ['eat-drink', 'restaurant'],
  bakery: ['eat-drink', 'cafe'],
  dessert: ['eat-drink', 'ice-cream'],
  bar: ['eat-drink', 'wine'],
  pub: ['eat-drink', 'beer'],
  nightclub: ['eat-drink', 'musical-notes'],
  brewery: ['eat-drink', 'beer'],
  'food-market': ['eat-drink', 'basket'],
  beach: ['beaches-coast', 'sunny'],
  'beach-access': ['beaches-coast', 'sunny'],
  'sunset-point': ['beaches-coast', 'partly-sunny'],
  'coastal-viewpoint': ['beaches-coast', 'eye'],
  waterfront: ['beaches-coast', 'boat'],
  waterfall: ['nature-outdoors', 'water'],
  trail: ['nature-outdoors', 'trail-sign'],
  viewpoint: ['nature-outdoors', 'eye'],
  spring: ['nature-outdoors', 'water'],
  riverfront: ['nature-outdoors', 'boat'],
  'island-boat-access': ['nature-outdoors', 'boat'],
  'nature-reserve': ['nature-outdoors', 'leaf'],
  fort: ['sightseeing-heritage', 'flag'],
  museum: ['sightseeing-heritage', 'library'],
  'heritage-site': ['sightseeing-heritage', 'business'],
  lighthouse: ['sightseeing-heritage', 'flashlight'],
  'historic-precinct': ['sightseeing-heritage', 'home'],
  'public-monument': ['sightseeing-heritage', 'ribbon'],
  gallery: ['sightseeing-heritage', 'color-palette'],
  market: ['culture-local-life', 'basket'],
  'village-attraction': ['culture-local-life', 'home'],
  'local-experience': ['culture-local-life', 'color-palette'],
  'festival-venue': ['culture-local-life', 'musical-notes'],
  'community-attraction': ['culture-local-life', 'ribbon'],
  'water-sports': ['activities-experiences', 'boat'],
  'boat-trip': ['activities-experiences', 'boat'],
  'guided-tour': ['activities-experiences', 'walk'],
  workshop: ['activities-experiences', 'color-palette'],
  'spice-farm': ['activities-experiences', 'leaf'],
  'adventure-activity': ['activities-experiences', 'bicycle'],
  'food-experience': ['activities-experiences', 'restaurant'],
  hostel: ['stay', 'bed'],
  homestay: ['stay', 'home'],
  guesthouse: ['stay', 'bed'],
  hotel: ['stay', 'bed'],
  resort: ['stay', 'bed'],
  campsite: ['stay', 'leaf'],
};

export function categoryLook(categorySlug: string | null | undefined) {
  const [group, icon] = CATEGORY[categorySlug ?? ''] ?? (['stay', 'location'] as [Group, IconName]);
  return { icon, ...PALETTE[group] };
}

/**
 * Stand-in artwork for a place that has no rights-cleared photo yet: a tinted tile with the
 * category's icon. Honest (it is obviously not a photo of the place) and still easy to scan.
 */
export function CategoryArt({
  categorySlug,
  size = 40,
  style,
}: {
  categorySlug: string | null | undefined;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const look = categoryLook(categorySlug);
  return (
    <View
      style={[styles.tile, { backgroundColor: look.background }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.ring,
          {
            width: size * 1.9,
            height: size * 1.9,
            borderRadius: size,
            borderColor: look.foreground,
          },
        ]}
      />
      <Ionicons name={icon(look.icon)} size={size} color={look.foreground} />
    </View>
  );
}

const icon = (name: IconName) => name;

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  ring: { position: 'absolute', borderWidth: 1, opacity: 0.18 },
});
