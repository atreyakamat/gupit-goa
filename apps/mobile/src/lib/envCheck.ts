/**
 * Refuses keys that must never be compiled into a mobile app.
 * Pure (no React Native imports) so it can be unit-tested.
 */
export function describePrivilegedKey(key: string): string | null {
  if (key.startsWith('sb_secret_')) return 'a Supabase secret key';
  const parts = key.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const payload = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
      if (payload.role === 'service_role') return 'a Supabase service-role key';
    } catch {
      // Not a JWT we can read. Nothing to object to.
    }
  }
  return null;
}

export interface PublicEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  mapStyleUrl: string | null;
}

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function readPublicEnv(raw: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  mapStyleUrl?: string;
}): PublicEnv {
  const supabaseUrl = clean(raw.supabaseUrl);
  const supabaseAnonKey = clean(raw.supabaseAnonKey);
  const mapStyleUrl = clean(raw.mapStyleUrl);

  if (supabaseAnonKey) {
    const problem = describePrivilegedKey(supabaseAnonKey);
    if (problem) {
      throw new Error(
        `EXPO_PUBLIC_SUPABASE_ANON_KEY is ${problem}. Privileged keys must never be shipped in the app. Use the anon/publishable key.`,
      );
    }
  }
  if (
    supabaseUrl &&
    !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(supabaseUrl)
  ) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_URL must be an https URL (http is allowed only for a local stack).',
    );
  }
  if (mapStyleUrl && /tile\.openstreetmap\.org/.test(mapStyleUrl)) {
    throw new Error(
      'The public OpenStreetMap tile server is not a production tile backend. Use a tile provider.',
    );
  }
  return { supabaseUrl, supabaseAnonKey, mapStyleUrl };
}
