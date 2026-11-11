import { readPublicEnv } from './envCheck';

// EXPO_PUBLIC_* must be referenced statically so the bundler can inline them.
export const env = readPublicEnv({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
});

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const isMapConfigured = Boolean(env.mapStyleUrl);
