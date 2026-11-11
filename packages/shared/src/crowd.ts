import { CROWD_LEVEL_TEXT, type CrowdLevel } from './constants';
import type { CrowdStatus } from './schemas';

export type CrowdDisplay =
  | { kind: 'live'; level: CrowdLevel; label: string; detail: string }
  | { kind: 'mixed'; label: string; detail: string }
  | { kind: 'guide'; level: CrowdLevel; label: string; detail: string }
  | { kind: 'unavailable'; label: string; detail: string };

const UNAVAILABLE: CrowdDisplay = {
  kind: 'unavailable',
  label: 'Crowd status unavailable',
  detail: 'Not enough recent on-site reports to say.',
};

export function minutesAgo(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((now.getTime() - then) / 60_000));
}

export function agoText(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hr ago' : `${hours} hr ago`;
}

/**
 * Turns the server's crowd payload into what the UI may claim.
 *
 * A live or mixed status is only as good as its newest three reports. Once `valid_until`
 * has passed (for example on a cached page opened later), it is shown as unavailable:
 * a stale label is never presented as current.
 */
export function describeCrowd(crowd: CrowdStatus | null | undefined, now: Date): CrowdDisplay {
  if (!crowd) return UNAVAILABLE;

  if (crowd.status === 'live' || crowd.status === 'mixed') {
    const validUntil = crowd.valid_until ? Date.parse(crowd.valid_until) : NaN;
    if (Number.isNaN(validUntil) || validUntil <= now.getTime()) return UNAVAILABLE;
    const count = crowd.report_count ?? 0;
    const latest = agoText(minutesAgo(crowd.latest_report_at, now));
    const basis = `Based on ${count} recent on-site reports${latest ? `, latest ${latest}` : ''}.`;
    if (crowd.status === 'mixed' || crowd.level == null) {
      return { kind: 'mixed', label: 'Mixed reports', detail: basis };
    }
    return {
      kind: 'live',
      level: crowd.level,
      label: `${CROWD_LEVEL_TEXT[crowd.level]} now`,
      detail: basis,
    };
  }

  if (crowd.status === 'guide' && crowd.level != null) {
    return {
      kind: 'guide',
      level: crowd.level,
      label: `Usually ${CROWD_LEVEL_TEXT[crowd.level].toLowerCase()} around this time`,
      detail:
        crowd.guide_source === 'history'
          ? 'A guide from past reports. Not live data.'
          : `${crowd.note ? `${crowd.note} ` : ''}Editorial guidance. Not live data.`,
    };
  }

  return UNAVAILABLE;
}

/** List and map cards carry no expiry, so a crowd chip is dropped once the fetch is this old. */
export const CARD_CROWD_MAX_AGE_MS = 10 * 60_000;

export function cardCrowdLabel(
  card: { crowd_status: string | null; crowd_level: CrowdLevel | null },
  fetchedAtMs: number,
  nowMs: number,
): string | null {
  if (card.crowd_status !== 'live' || card.crowd_level == null) return null;
  if (nowMs - fetchedAtMs > CARD_CROWD_MAX_AGE_MS) return null;
  return CROWD_LEVEL_TEXT[card.crowd_level];
}

export function crowdRejectionText(
  reason: string | null | undefined,
  retryAfterSeconds?: number | null,
): string {
  switch (reason) {
    case 'too_far':
      return 'You need to be at the place (within about 300 m) to report how busy it is.';
    case 'already_reported': {
      const mins = retryAfterSeconds ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : null;
      return mins
        ? `You have already reported for this place. You can report again in about ${mins} min.`
        : 'You have already reported for this place in the last hour.';
    }
    case 'partner_device':
      return 'This device is linked to this business, so it cannot report crowd levels here.';
    case 'rate_limited':
      return 'Too many reports from this device in the last hour. Please try again later.';
    case 'spot_unavailable':
      return 'This place is not accepting reports right now.';
    default:
      return 'The report could not be sent. Please try again.';
  }
}
