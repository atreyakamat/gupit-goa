import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useOnline } from '@/lib/hooks';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from './ui';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={16} color={colors.ink} />
      <AppText variant="caption" style={styles.text}>
        You are offline. Saved and recently viewed places still open. Crowd levels are not shown.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1 },
});
