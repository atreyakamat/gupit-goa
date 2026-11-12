import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Screen } from '@/components/ui';
import { getLocalStore } from '@/lib/db';
import { colors, radius, spacing } from '@/theme/tokens';

const POINTS: {
  icon: 'map-outline' | 'people-outline' | 'shield-checkmark-outline';
  text: string;
}[] = [
  { icon: 'map-outline', text: 'Cafés, beaches, forts, nightlife and local finds across Goa.' },
  {
    icon: 'people-outline',
    text: 'Honest crowd levels from people who are there, and a quieter option nearby.',
  },
  {
    icon: 'shield-checkmark-outline',
    text: 'Every place is checked by a person, with access and safety notes.',
  },
];

export default function Welcome() {
  const router = useRouter();
  const client = useQueryClient();

  const start = async () => {
    try {
      await (await getLocalStore()).setSetting('onboarded', '1');
      client.setQueryData(['setting', 'onboarded'], true);
    } catch {
      // Not being able to remember this is no reason to block the app.
    }
    router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.root}>
        <View style={styles.mark}>
          <Ionicons name="location" size={40} color={colors.onPrimary} />
        </View>
        <AppText variant="title" accessibilityRole="header">
          Gupit Goa
        </AppText>
        <AppText variant="subheading" color={colors.inkMuted}>
          Good places in Goa, from iconic stops to quieter local finds.
        </AppText>
        <View style={styles.points}>
          {POINTS.map((point) => (
            <View key={point.icon} style={styles.point}>
              <Ionicons name={point.icon} size={22} color={colors.primary} />
              <AppText style={styles.pointText}>{point.text}</AppText>
            </View>
          ))}
        </View>
        <View style={styles.footer}>
          <Button label="Explore Goa" icon="compass-outline" onPress={() => void start()} />
          <AppText variant="caption" color={colors.inkMuted} style={styles.note}>
            No account needed. We only ask for your location if you tap Near me, and it is never
            tracked or stored.
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', gap: spacing.md },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  points: { gap: spacing.md, marginTop: spacing.lg },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pointText: { flex: 1 },
  footer: { marginTop: spacing.xl, gap: spacing.md },
  note: { textAlign: 'center' },
});
