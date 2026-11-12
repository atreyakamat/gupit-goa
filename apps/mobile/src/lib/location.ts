import type { LatLng } from '@gupit/shared';
import * as Location from 'expo-location';
import { useAppStore } from '@/store/app';

export type PositionResult =
  | { status: 'granted'; position: LatLng }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable' };

/**
 * One foreground location fix, requested only when the user asks for a location feature.
 * No background permission, no watching, no history. The result lives in memory.
 */
export async function getPositionOnce(): Promise<PositionResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    useAppStore.getState().setPosition(null, 'denied');
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }
  try {
    const fix =
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })) ??
      (await Location.getLastKnownPositionAsync());
    if (!fix) return { status: 'unavailable' };
    const position = { lat: fix.coords.latitude, lng: fix.coords.longitude };
    useAppStore.getState().setPosition(position, 'granted');
    return { status: 'granted', position };
  } catch {
    useAppStore.getState().setPosition(null, 'granted');
    return { status: 'unavailable' };
  }
}

export async function hasLocationPermission(): Promise<boolean> {
  return (await Location.getForegroundPermissionsAsync()).granted;
}
