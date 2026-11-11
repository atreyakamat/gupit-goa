import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { AppText, Button } from '@/components/ui';
import { getPositionOnce, hasLocationPermission } from '@/lib/location';
import { useAppStore } from '@/store/app';
import { colors } from '@/theme/tokens';

type Step = 'idle' | 'explain' | 'denied' | 'unavailable';

/**
 * "Near me" flow. Location is asked for only when the user taps a location feature, the
 * reason is explained before the system prompt, and declining never blocks the app.
 */
export function useNearMe(onPosition?: () => void) {
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);

  const locate = useCallback(async () => {
    setBusy(true);
    const result = await getPositionOnce();
    setBusy(false);
    if (result.status === 'granted') {
      setStep('idle');
      onPosition?.();
    } else {
      setStep(result.status === 'denied' ? 'denied' : 'unavailable');
    }
  }, [onPosition]);

  const start = useCallback(async () => {
    if (await hasLocationPermission()) await locate();
    else setStep('explain');
  }, [locate]);

  const clear = useCallback(
    () => useAppStore.getState().setPosition(null, useAppStore.getState().permission),
    [],
  );

  const sheet = (
    <Sheet
      visible={step !== 'idle'}
      onClose={() => setStep('idle')}
      title={
        step === 'explain'
          ? 'See places near you'
          : step === 'denied'
            ? 'Location is off'
            : 'Could not find you'
      }
    >
      {step === 'explain' ? (
        <>
          <AppText>
            Gupit Goa will check where you are once, to sort places by distance. It does not track
            you in the background and does not keep a history of where you have been.
          </AppText>
          <Button
            label="Use my location"
            icon="locate-outline"
            onPress={() => void locate()}
            loading={busy}
          />
          <Button label="Not now" kind="ghost" onPress={() => setStep('idle')} />
        </>
      ) : step === 'denied' ? (
        <>
          <AppText>
            That is fine. You can still browse all of Goa, pick an area in Filters, and search by
            place or locality. To turn location on later, allow it in your phone settings.
          </AppText>
          <Button
            label="Open settings"
            kind="secondary"
            icon="settings-outline"
            onPress={() => void Linking.openSettings()}
          />
          <Button label="Keep browsing" kind="ghost" onPress={() => setStep('idle')} />
        </>
      ) : (
        <>
          <AppText color={colors.ink}>
            Your phone could not get a location just now. Try again outdoors, or browse by area.
          </AppText>
          <Button label="Try again" icon="refresh" onPress={() => void locate()} loading={busy} />
        </>
      )}
    </Sheet>
  );

  return { start, clear, busy, sheet };
}
