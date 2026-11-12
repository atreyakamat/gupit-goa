import { haversineMetres, type LatLng } from '@gupit/shared';

/** Lower-case, accent-free, punctuation-free. "Café Bodega!" -> "cafe bodega". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const GENERIC = new Set([
  'the',
  'goa',
  'cafe',
  'restaurant',
  'bar',
  'pub',
  'beach',
  'fort',
  'and',
  'by',
  'at',
]);

/** The distinctive part of a name, used for comparison (not for display). */
function coreTokens(name: string): string[] {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  const core = tokens.filter((t) => !GENERIC.has(t));
  return core.length ? core : tokens;
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const padded = ` ${text} `;
  for (let i = 0; i < padded.length - 1; i += 1) {
    const gram = padded.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient on character bigrams of the distinctive name tokens. 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const left = coreTokens(a).join(' ');
  const right = coreTokens(b).join(' ');
  if (!left || !right) return 0;
  if (left === right) return 1;
  const ga = bigrams(left);
  const gb = bigrams(right);
  let overlap = 0;
  let total = 0;
  for (const [gram, count] of ga) {
    overlap += Math.min(count, gb.get(gram) ?? 0);
    total += count;
  }
  for (const count of gb.values()) total += count;
  return (2 * overlap) / total;
}

export interface Identity {
  name: string;
  locality: string | null;
  position: LatLng | null;
}

/**
 * Two records are likely the same place only when the names are close AND there is a
 * second, independent signal: the same locality, or pins within 200 m. A matching name
 * alone is never enough (plenty of unrelated places share a name).
 */
export function isLikelyDuplicate(a: Identity, b: Identity): boolean {
  if (nameSimilarity(a.name, b.name) < 0.82) return false;
  const sameLocality = Boolean(
    a.locality && b.locality && normalizeName(a.locality) === normalizeName(b.locality),
  );
  const near = Boolean(a.position && b.position && haversineMetres(a.position, b.position) <= 200);
  return sameLocality || near;
}

/** Stable idempotency key for a candidate: retries and re-discoveries land on the same row. */
export function dedupeKey(name: string, locality: string | null): string {
  const slug = (text: string) => normalizeName(text).replace(/ /g, '-');
  return `${slug(name)}|${locality ? slug(locality) : 'unknown-locality'}`;
}
