import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Screen } from '@/components/ui';
import { useAppStore } from '@/store/app';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

function Item({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={styles.flex}>
        <AppText variant="subheading">{label}</AppText>
        {detail ? (
          <AppText variant="caption" color={colors.inkMuted}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
    </Pressable>
  );
}

export default function More() {
  const router = useRouter();
  const isAdmin = useAppStore((s) => s.isAdmin);
  return (
    <Screen scroll>
      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        More
      </AppText>
      <View style={styles.group}>
        <Item
          icon="shield-checkmark-outline"
          label="Privacy"
          detail="What the app uses, and what it never keeps"
          onPress={() => router.push('/privacy')}
        />
        <Item
          icon="information-circle-outline"
          label="About and verification"
          detail="How places are checked and what crowd levels mean"
          onPress={() => router.push('/about')}
        />
        <Item
          icon="storefront-outline"
          label="Link partner device"
          detail="For partner businesses, with a code from our team"
          onPress={() => router.push('/partner-link')}
        />
        {isAdmin ? (
          <Item
            icon="construct-outline"
            label="Review and admin"
            detail="Candidates, places, partners and reports"
            onPress={() => router.push('/admin')}
          />
        ) : (
          <Item
            icon="key-outline"
            label="Team sign-in"
            detail="Reviewers only. Browsing never needs an account."
            onPress={() => router.push('/team-sign-in')}
          />
        )}
      </View>
      <AppText variant="caption" color={colors.inkMuted} style={styles.version}>
        Gupit Goa {Constants.expoConfig?.version ?? ''} · Map data from OpenStreetMap contributors
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: spacing.sm },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: touchTarget + 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  version: { textAlign: 'center' },
});
