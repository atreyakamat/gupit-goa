import { readPublicEnv } from './envCheck';

// EXPO_PUBLIC_* must be referenced statically so the bundler can inline them.
export const env = readPublicEnv({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
});

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

/**
 * With no backend configured the app runs on bundled sample places, clearly labelled as a
 * preview, so a fresh build opens to something usable. Nothing is sent anywhere.
 */
export const isPreviewMode = !isBackendConfigured;

/**
 * OpenFreeMap's public instance: OpenStreetMap vector tiles, no API key, no sign-up,
 * commercial use allowed. It is offered as-is, so for a large launch consider self-hosting
 * it or setting EXPO_PUBLIC_MAP_STYLE_URL to a provider with an SLA.
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const mapStyleUrl = env.mapStyleUrl ?? DEFAULT_MAP_STYLE_URL;
