import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'gupit.installation';
let cached: string | null = null;

/**
 * A random identifier for this app installation, used only so the server can rate-limit
 * crowd and problem reports. It is not a hardware or advertising ID, it is hashed with a
 * server-side secret before storage, and reinstalling the app resets it.
 */
export async function getInstallationToken(): Promise<string> {
  if (cached) return cached;
  let token = await SecureStore.getItemAsync(KEY);
  if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    token = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
    await SecureStore.setItemAsync(KEY, token);
  }
  cached = token;
  return token;
}
