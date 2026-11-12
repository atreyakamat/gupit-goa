import { z } from 'zod';
import { refreshAdminFlag } from '@/features/admin/session';
import { api, rpc } from '@/lib/api';
import { getLocalStore } from '@/lib/db';
import { isBackendConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import { useAppStore } from '@/store/app';
import { syncSavedPlaces, type SavedRef, type SyncResult } from './sync';

/**
 * Optional accounts. Signing in does one thing: it backs saved places up so they follow
 * the person to another phone. Nothing else in the app changes, and nothing needs it.
 *
 * Sign-in is a one-time code sent by email, so the app never handles a password.
 */

const remoteRows = z.array(
  z.object({ list_name: z.string(), spot_id: z.string(), slug: z.string() }),
);
const toWire = (items: SavedRef[]) =>
  items.map((item) => ({ list_name: item.listName, spot_id: item.spotId }));

/** Reads the stored session, if any, into app state. Safe to call at any time. */
export async function refreshAccount(): Promise<string | null> {
  if (!isBackendConfigured) return null;
  try {
    const { data } = await getSupabase().auth.getSession();
    const email = data.session?.user.email ?? null;
    useAppStore.getState().setAccountEmail(email);
    return email;
  } catch (error) {
    logger.warn('account.session_check_failed', { reason: String(error) });
    return null;
  }
}

export async function requestSignInCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifySignInCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code,
    type: 'email',
  });
  if (error) throw error;
  await refreshAccount();
  await refreshAdminFlag();
}

let running: Promise<SyncResult | null> | null = null;

/** Backs up and restores saved places. Does nothing for guests. One run at a time. */
export function syncAccount(): Promise<SyncResult | null> {
  running ??= (async () => {
    try {
      if (!useAppStore.getState().accountEmail) return null;
      const result = await syncSavedPlaces({
        store: await getLocalStore(),
        remote: {
          sync: async (add, remove) => {
            const rows = await rpc(
              'sync_saved_spots',
              { p_add: toWire(add), p_remove: toWire(remove) },
              remoteRows,
            );
            return rows.map((r) => ({ listName: r.list_name, spotId: r.spot_id, slug: r.slug }));
          },
        },
        fetchDetail: (slug) => api.getSpotDetail(slug),
      });
      useAppStore.getState().setLastSync({ at: Date.now(), ok: true });
      return result;
    } catch (error) {
      logger.warn('account.sync_failed', { reason: String(error) });
      useAppStore.getState().setLastSync({ at: Date.now(), ok: false });
      throw error;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Fire-and-forget sync after a save or removal. Failures are retried on the next run. */
export function syncAccountSoon(): void {
  if (!useAppStore.getState().accountEmail) return;
  void syncAccount().catch(() => undefined);
}

/** Signs out on this phone. Saved places stay on the phone and in the backup. */
export async function signOutAccount(): Promise<void> {
  await getSupabase().auth.signOut({ scope: 'local' });
  useAppStore.getState().setAccountEmail(null);
  useAppStore.getState().setAdmin(false);
  useAppStore.getState().setLastSync(null);
}

/** Deletes the account and its backup on the server. Saved places stay on this phone. */
export async function deleteAccount(): Promise<void> {
  await rpc('delete_my_account', {}, z.unknown());
  await getSupabase()
    .auth.signOut({ scope: 'local' })
    .catch(() => undefined);
  await (await getLocalStore()).clearAllRemovals();
  useAppStore.getState().setAccountEmail(null);
  useAppStore.getState().setAdmin(false);
  useAppStore.getState().setLastSync(null);
}
