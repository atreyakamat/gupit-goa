import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore-backed storage for the (admin-only) auth session.
 * SecureStore values are size-limited on some devices, and a session can exceed that,
 * so values are split into chunks under one logical key.
 */
const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${base}.n`));
    if (!Number.isInteger(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(`${base}.${i}`);
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    const previous = Number(await SecureStore.getItemAsync(`${base}.n`)) || 0;
    const count = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(`${base}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(`${base}.n`, String(count));
    for (let i = count; i < previous; i += 1) {
      await SecureStore.deleteItemAsync(`${base}.${i}`);
    }
  },

  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${base}.n`)) || 0;
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(`${base}.${i}`);
    }
    await SecureStore.deleteItemAsync(`${base}.n`);
  },
};
