import {
  CROWD_FILTERS,
  DISCOVERY_LABELS,
  PRICE_BANDS,
  REGIONS,
  type CrowdFilter,
  type DiscoveryLabel,
  type PriceBand,
  type Region,
} from './constants';

export interface SpotFilters {
  categorySlugs: string[];
  regions: Region[];
  labels: DiscoveryLabel[];
  crowd: CrowdFilter[];
  priceBands: PriceBand[];
  attributes: string[];
  partnerOnly: boolean;
  /** Only applied when the user's location is available. */
  radiusKm: number | null;
}

export const RADIUS_OPTIONS_KM = [2, 5, 10, 25, 50] as const;

export const EMPTY_FILTERS: SpotFilters = {
  categorySlugs: [],
  regions: [],
  labels: [],
  crowd: [],
  priceBands: [],
  attributes: [],
  partnerOnly: false,
  radiusKm: null,
};

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function countActiveFilters(f: SpotFilters): number {
  return (
    f.categorySlugs.length +
    f.regions.length +
    f.labels.length +
    f.crowd.length +
    f.priceBands.length +
    f.attributes.length +
    (f.partnerOnly ? 1 : 0) +
    (f.radiusKm != null ? 1 : 0)
  );
}

/** The jsonb payload the RPCs expect. Empty groups are omitted so cache keys stay stable. */
export function toRpcFilters(f: SpotFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.categorySlugs.length) out.category_slugs = [...f.categorySlugs].sort();
  if (f.regions.length) out.regions = [...f.regions].sort();
  if (f.labels.length) out.labels = [...f.labels].sort();
  if (f.crowd.length) out.crowd = [...f.crowd].sort();
  if (f.priceBands.length) out.price_bands = [...f.priceBands].sort();
  if (f.attributes.length) out.attributes = [...f.attributes].sort();
  if (f.partnerOnly) out.partner_only = true;
  return out;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (v): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v),
          ),
        ),
      ]
    : [];

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter((v): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,60}$/.test(v)),
        ),
      ].slice(0, max)
    : [];

/** Sanitises filters that came from storage or a deep link. Unknown values are dropped. */
export function parseFilters(input: unknown): SpotFilters {
  if (typeof input !== 'object' || input === null) return { ...EMPTY_FILTERS };
  const raw = input as Record<string, unknown>;
  const radius =
    typeof raw.radiusKm === 'number' && raw.radiusKm > 0 && raw.radiusKm <= 100
      ? raw.radiusKm
      : null;
  return {
    categorySlugs: strings(raw.categorySlugs, 20),
    regions: pick(raw.regions, REGIONS),
    labels: pick(raw.labels, DISCOVERY_LABELS),
    crowd: pick(raw.crowd, CROWD_FILTERS),
    priceBands: pick(raw.priceBands, PRICE_BANDS),
    attributes: strings(raw.attributes, 10),
    partnerOnly: raw.partnerOnly === true,
    radiusKm: radius,
  };
}
