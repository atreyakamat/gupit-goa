import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { env, isBackendConfigured } from './env';
import { secureStorage } from './secureStorage';

export class BackendNotConfiguredError extends Error {
  constructor() {
    super(
      'The app is not connected to a backend. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
    this.name = 'BackendNotConfiguredError';
  }
}

let client: SupabaseClient | null = null;

/** The anon-key client. Guests never sign in; only reviewers hold a session. */
export function getSupabase(): SupabaseClient {
  if (!isBackendConfigured) throw new BackendNotConfiguredError();
  if (!client) {
    client = createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
      auth: {
        storage: secureStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void client?.auth.startAutoRefresh();
      else void client?.auth.stopAutoRefresh();
    });
  }
  return client;
}
