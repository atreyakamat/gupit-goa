import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { isPreviewMode } from '@/lib/env';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from './ui';

/**
 * Shown on every screen that displays places when the build has no backend. It makes
 * sure nobody mistakes the bundled sample entries or example crowd levels for real data.
 */
export function PreviewBanner() {
  if (!isPreviewMode) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="flask-outline" size={16} color={colors.ink} />
      <AppText variant="caption" style={styles.text}>
        Preview data. Sample places and example crowd levels, not verified listings.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E1ECFB',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1 },
});
