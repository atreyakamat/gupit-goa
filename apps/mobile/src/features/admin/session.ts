import { isBackendConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import { useAppStore } from '@/store/app';

/**
 * Reviewer accounts are created by hand in Supabase Auth and allowlisted in `public.admins`.
 * There is no public sign-up. The server re-checks the allowlist on every admin call; this
 * flag only decides whether the admin entry point is shown.
 */
export async function refreshAdminFlag(): Promise<boolean> {
  if (!isBackendConfigured) return false;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      useAppStore.getState().setAdmin(false);
      return false;
    }
    const { data: isAdmin, error } = await supabase.rpc('am_i_admin');
    if (error) throw error;
    useAppStore.getState().setAdmin(isAdmin === true);
    return isAdmin === true;
  } catch (error) {
    logger.warn('admin.flag_check_failed', { reason: String(error) });
    return false;
  }
}

export async function signInReviewer(
  email: string,
  password: string,
): Promise<'ok' | 'not_admin' | 'invalid'> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return 'invalid';
  if (await refreshAdminFlag()) return 'ok';
  await supabase.auth.signOut();
  return 'not_admin';
}

export async function signOutReviewer(): Promise<void> {
  await getSupabase().auth.signOut();
  useAppStore.getState().setAdmin(false);
}
