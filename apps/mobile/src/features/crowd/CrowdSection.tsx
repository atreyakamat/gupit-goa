import {
  CROWD_LEVEL_TEXT,
  crowdRejectionText,
  describeCrowd,
  type CrowdLevel,
  type CrowdStatus,
} from '@gupit/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { AppText, Badge, Button, Card, Notice } from '@/components/ui';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/hooks';
import { getPositionOnce } from '@/lib/location';
import { colors, spacing } from '@/theme/tokens';

const tone = { 1: 'quiet', 2: 'moderate', 3: 'busy' } as const;
const icon = { 1: 'leaf-outline', 2: 'people-outline', 3: 'people' } as const;

/**
 * Crowd status for one place. The wording never claims more than the server reported:
 * a live level, mixed reports, a labelled guide, or "unavailable".
 */
export function CrowdSection({
  spotId,
  slug,
  crowd,
  onTryInstead,
}: {
  spotId: string;
  slug: string;
  crowd: CrowdStatus;
  onTryInstead: () => void;
}) {
  const online = useOnline();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<CrowdLevel | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Re-evaluate once a minute so a label expires while the screen stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const display = describeCrowd(online ? crowd : null, now);

  const submit = async (level: CrowdLevel) => {
    setSending(level);
    setMessage(null);
    try {
      const fix = await getPositionOnce();
      if (fix.status !== 'granted') {
        setMessage({
          ok: false,
          text:
            fix.status === 'denied'
              ? 'Reporting needs your location once, to confirm you are at the place. You can allow it in your phone settings.'
              : 'Your phone could not get a location just now. Try again in the open.',
        });
        return;
      }
      const result = await api.submitCrowdReport({ spotId, level, position: fix.position });
      if (result.accepted) {
        track('crowd_report_submitted', { level });
        setMessage({ ok: true, text: 'Thanks. Your report counts for the next two hours.' });
        await client.invalidateQueries({ queryKey: ['spot', slug] });
      } else {
        setMessage({
          ok: false,
          text: crowdRejectionText(result.reason, result.retry_after_seconds),
        });
      }
    } catch {
      setMessage({
        ok: false,
        text: 'The report could not be sent. Check your connection and try again.',
      });
    } finally {
      setSending(null);
    }
  };

  return (
    <Card>
      <View style={styles.header}>
        <AppText variant="subheading" accessibilityRole="header" style={styles.flex}>
          How busy is it?
        </AppText>
        {display.kind === 'live' ? (
          <Badge label={display.label} tone={tone[display.level]} icon={icon[display.level]} />
        ) : null}
        {display.kind === 'mixed' ? (
          <Badge label={display.label} tone="neutral" icon="help-circle-outline" />
        ) : null}
        {display.kind === 'guide' ? (
          <Badge label="Guide, not live" tone="neutral" icon="time-outline" />
        ) : null}
      </View>
      {display.kind === 'guide' ? <AppText>{display.label}</AppText> : null}
      {display.kind === 'unavailable' ? (
        <AppText>{online ? display.label : 'Crowd levels need a connection'}</AppText>
      ) : null}
      <AppText variant="caption" color={colors.inkMuted}>
        {online ? display.detail : 'Live crowd data is never shown from a saved copy.'}
      </AppText>
      <View style={styles.actions}>
        <Button
          label="I am here: report"
          kind="secondary"
          icon="megaphone-outline"
          disabled={!online}
          onPress={() => {
            setMessage(null);
            setOpen(true);
          }}
          style={styles.flex}
        />
        <Button
          label="Try instead"
          kind="ghost"
          icon="swap-horizontal-outline"
          onPress={onTryInstead}
        />
      </View>

      <Sheet visible={open} onClose={() => setOpen(false)} title="How busy is it right now?">
        <AppText>
          Reports only count from people who are at the place. We check your location once to
          confirm you are within about 300 m. The location is not stored.
        </AppText>
        {([1, 2, 3] as const).map((level) => (
          <Button
            key={level}
            label={CROWD_LEVEL_TEXT[level]}
            kind="secondary"
            icon={icon[level]}
            loading={sending === level}
            disabled={sending != null && sending !== level}
            onPress={() => void submit(level)}
          />
        ))}
        {message ? <Notice tone={message.ok ? 'info' : 'warning'}>{message.text}</Notice> : null}
        {message?.ok ? <Button label="Done" onPress={() => setOpen(false)} /> : null}
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
