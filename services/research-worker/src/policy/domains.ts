import type { DomainRule } from '../types';

/**
 * Sites the worker must never fetch, whatever the database rules say. These are a floor:
 * an admin can add rules, but cannot make the worker scrape these.
 *
 * lead_only: a person may save a link from the site as a lead (through the admin app).
 *            The worker itself never requests the page.
 * block:     never used as a source at all.
 */
export const BUILT_IN_RULES: Readonly<Record<string, DomainRule>> = {
  'instagram.com': 'lead_only',
  'facebook.com': 'lead_only',
  'fb.com': 'lead_only',
  'threads.net': 'lead_only',
  'threads.com': 'lead_only',
  'tiktok.com': 'lead_only',
  'youtube.com': 'lead_only',
  'youtu.be': 'lead_only',
  'x.com': 'lead_only',
  'twitter.com': 'lead_only',
  'linkedin.com': 'lead_only',
  'pinterest.com': 'lead_only',
  'reddit.com': 'lead_only',
};

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function lookup(host: string, rules: Readonly<Record<string, DomainRule>>): DomainRule | null {
  let best: { length: number; rule: DomainRule } | null = null;
  for (const [domain, rule] of Object.entries(rules)) {
    if (
      (host === domain || host.endsWith(`.${domain}`)) &&
      (!best || domain.length > best.length)
    ) {
      best = { length: domain.length, rule };
    }
  }
  return best?.rule ?? null;
}

const STRICTNESS: Record<DomainRule, number> = { allow: 0, lead_only: 1, block: 2 };

/**
 * The stricter of the built-in floor and the configured rule wins. Unknown hosts are
 * allowed, subject to robots.txt and the fetcher's other checks. Unparseable URLs are blocked.
 */
export function classifyUrl(
  url: string,
  configured: Readonly<Record<string, DomainRule>>,
): DomainRule {
  const host = hostOf(url);
  if (!host) return 'block';
  const floor = lookup(host, BUILT_IN_RULES) ?? 'allow';
  const rule = lookup(host, configured) ?? 'allow';
  return STRICTNESS[rule] >= STRICTNESS[floor] ? rule : floor;
}
