import type { LatLng } from './geo';

export const APP_SCHEME = 'gupitgoa';

/**
 * Returns digits only in international format (no "+"), or null when the input cannot be a
 * phone number. Ten-digit Indian mobile numbers get the default country code.
 */
export function normaliseWhatsAppNumber(input: string, defaultCountryCode = '91'): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export function buildWhatsAppUrl(number: string, text?: string): string | null {
  const normalised = normaliseWhatsAppNumber(number);
  if (!normalised) return null;
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${normalised}${query}`;
}

export function partnerEnquiryText(spotName: string): string {
  return `Hi, I found ${spotName} on Gupit Goa and would like to know more.`;
}

const coord = (n: number) => n.toFixed(6);

/** Opens the platform map app at the pin. The universal URL works anywhere as a fallback. */
export function buildDirectionsUrls(
  target: LatLng & { name: string },
  platform: 'ios' | 'android',
): { primary: string; fallback: string } {
  const ll = `${coord(target.lat)},${coord(target.lng)}`;
  const label = encodeURIComponent(target.name);
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
  const primary =
    platform === 'ios'
      ? `http://maps.apple.com/?daddr=${ll}&q=${label}`
      : `geo:0,0?q=${ll}(${label})`;
  return { primary, fallback };
}

export function buildSpotDeepLink(slug: string): string {
  return `${APP_SCHEME}://spot/${encodeURIComponent(slug)}`;
}

export interface ShareableSpot extends LatLng {
  name: string;
  locality: string | null;
  short_description: string | null;
}

/**
 * Plain-text share. There is no web page for a place in this release, so the message
 * stands on its own: name, where it is, one line about it and a map link.
 */
export function buildShareMessage(spot: ShareableSpot): string {
  const lines = [spot.locality ? `${spot.name}, ${spot.locality} (Goa)` : `${spot.name} (Goa)`];
  if (spot.short_description) lines.push(spot.short_description);
  lines.push(
    `Map: https://www.google.com/maps/search/?api=1&query=${coord(spot.lat)},${coord(spot.lng)}`,
  );
  lines.push('Found on Gupit Goa');
  return lines.join('\n');
}

const INSTAGRAM_POST = /^https:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/;

/**
 * Accepts a pasted Instagram post or reel link and returns it without tracking parameters,
 * or null if it is not a post link. Profile, story and non-Instagram links are rejected.
 */
export function normaliseInstagramPostUrl(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/^http:\/\//i, 'https://');
  const withHost = trimmed.replace(/^https:\/\/(m\.)?instagram\.com/i, 'https://www.instagram.com');
  const withSlash = withHost.endsWith('/') ? withHost : `${withHost}/`;
  return INSTAGRAM_POST.test(withSlash) ? withSlash : null;
}

/** "@Some.Creator " -> "some.creator". Null if it cannot be an Instagram handle. */
export function normaliseInstagramHandle(input: string): string | null {
  const handle = input.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

/** Splits a credit line into plain text and tappable @handles: "Photo by @goa.frames". */
export function splitCreditLine(credit: string): { text: string; handle: string | null }[] {
  const parts: { text: string; handle: string | null }[] = [];
  let last = 0;
  for (const match of credit.matchAll(/@([A-Za-z0-9._]{1,30})/g)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: credit.slice(last, start), handle: null });
    const handle = match[1]!.replace(/\.+$/, '');
    parts.push({ text: `@${handle}`, handle: handle.toLowerCase() });
    last = start + 1 + handle.length;
  }
  if (last < credit.length) parts.push({ text: credit.slice(last), handle: null });
  return parts;
}
