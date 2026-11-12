/** Deliberately simple: the real check is whether the code email arrives. */
export function isValidEmail(input: string): boolean {
  const email = input.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Codes are 6 to 10 digits depending on project settings; people paste them with spaces. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

/** Maps an auth or network failure to a sentence a person can act on. */
export function describeAuthError(error: unknown): string {
  const e = (error ?? {}) as { status?: number; code?: string; message?: string };
  const text = `${e.code ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (e.status === 429 || text.includes('rate_limit') || text.includes('rate limit')) {
    return 'Too many tries. Please wait a few minutes, then try again.';
  }
  if (text.includes('otp') || text.includes('token') || text.includes('expired')) {
    return 'That code is not right or has expired. Check it, or send a new code.';
  }
  if (text.includes('reviewer_account')) {
    return 'Review team accounts are managed by the team and cannot be deleted here.';
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('timeout')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
