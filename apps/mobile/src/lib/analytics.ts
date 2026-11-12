import { ANALYTICS_FORBIDDEN_KEYS, type AnalyticsEventName } from '@gupit/shared';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { api } from './api';
import { getLocalStore } from './db';
import { isBackendConfigured } from './env';
import { logger } from './logger';

// A new random id each launch. It is not tied to the device or the installation token.
const sessionId = Crypto.randomUUID();
export const getSessionId = () => sessionId;

type Props = Record<string, string | number | boolean | null>;

/**
 * Records a privacy-safe product event. Events are queued on the device and sent in
 * batches, so they survive being offline. Coordinates, search text and message text are
 * dropped here and again on the server.
 */
export function track(name: AnalyticsEventName, props: Props = {}): void {
  const safe: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (!(ANALYTICS_FORBIDDEN_KEYS as readonly string[]).includes(key)) safe[key] = value;
  }
  void getLocalStore()
    .then((store) => store.enqueueEvent(name, safe))
    .catch((error) => logger.warn('analytics.enqueue_failed', { reason: String(error) }));
}

let flushing = false;

export async function flushEvents(): Promise<void> {
  if (flushing || !isBackendConfigured) return;
  flushing = true;
  try {
    const store = await getLocalStore();
    const batch = await store.peekEvents(50);
    if (batch.length === 0) return;
    await api.trackEvents({
      events: batch.map((e) => ({ name: e.name, props: e.props })),
      sessionId,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? '0',
    });
    await store.deleteEventsThrough(batch[batch.length - 1]!.id);
  } catch {
    // Offline or backend unavailable: keep the queue and try again later.
  } finally {
    flushing = false;
  }
}
