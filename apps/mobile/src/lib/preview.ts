import {
  haversineMetres,
  toRpcFilters,
  type Alternative,
  type Category,
  type CrowdStatus,
  type LatLng,
  type SocialPost,
  type SpotCard,
  type SpotDetail,
  type SpotFilters,
} from '@gupit/shared';
import type { Api } from './api';

/**
 * PREVIEW DATA. Used only when the build has no backend configured.
 *
 * These entries exist so a fresh build opens to a working app. They are NOT verified
 * listings: well-known landmarks carry approximate pins and no practical facts, business
 * entries are invented and named "Sample", and the crowd levels are examples. The app shows
 * a "Preview data" banner wherever they appear. None of this is ever written to a backend.
 */

class PreviewOnlyError extends Error {
  constructor() {
    super('preview_mode');
    this.name = 'PreviewOnlyError';
  }
}

interface Group {
  slug: string;
  label: string;
  children: [slug: string, label: string][];
}

const GROUPS: Group[] = [
  {
    slug: 'eat-drink',
    label: 'Eat & drink',
    children: [
      ['cafe', 'Café'],
      ['restaurant', 'Restaurant'],
      ['bar', 'Bar'],
    ],
  },
  {
    slug: 'beaches-coast',
    label: 'Beaches & coast',
    children: [
      ['beach', 'Beach'],
      ['coastal-viewpoint', 'Coastal viewpoint'],
    ],
  },
  { slug: 'nature-outdoors', label: 'Nature & outdoors', children: [['waterfall', 'Waterfall']] },
  {
    slug: 'sightseeing-heritage',
    label: 'Sightseeing & heritage',
    children: [
      ['fort', 'Fort'],
      ['heritage-site', 'Heritage site'],
      ['historic-precinct', 'Historic neighbourhood'],
    ],
  },
  { slug: 'culture-local-life', label: 'Culture & local life', children: [['market', 'Market']] },
];

const CATEGORIES: Category[] = GROUPS.flatMap((group, g) => [
  { id: group.slug, parent_slug: null, slug: group.slug, label: group.label, sort_order: g },
  ...group.children.map(([slug, label], c) => ({
    id: slug,
    parent_slug: group.slug,
    slug,
    label,
    sort_order: c,
  })),
]);

type CrowdPreset = 'busy' | 'moderate' | 'quiet' | 'guide' | 'none';

interface Seed {
  slug: string;
  name: string;
  category: string;
  locality: string;
  region: SpotDetail['region'];
  lat: number;
  lng: number;
  labels: string[];
  about: string;
  crowd?: CrowdPreset;
  tags?: string[];
  safety?: string[];
  respect?: string[];
  access?: string;
  partner?: boolean;
  posts?: { handle: string; note: string }[];
}

const SEEDS: Seed[] = [
  {
    slug: 'fort-aguada',
    name: 'Fort Aguada',
    category: 'fort',
    locality: 'Candolim',
    region: 'north',
    lat: 15.4925,
    lng: 73.7737,
    labels: ['iconic'],
    about: 'Hilltop fort and lighthouse above the mouth of the Mandovi.',
    crowd: 'guide',
    tags: ['sunset', 'views'],
    respect: ['follow_posted_rules', 'carry_rubbish_back'],
    posts: [{ handle: 'sample.creator', note: 'Golden-hour walk along the ramparts.' }],
  },
  {
    slug: 'chapora-fort',
    name: 'Chapora Fort',
    category: 'fort',
    locality: 'Vagator',
    region: 'north',
    lat: 15.6059,
    lng: 73.7364,
    labels: ['iconic', 'popular'],
    about: 'Ruined hill fort with wide views over Vagator and the Chapora river.',
    crowd: 'busy',
    tags: ['sunset', 'views'],
    safety: ['steep_access', 'poor_lighting'],
    respect: ['carry_rubbish_back'],
  },
  {
    slug: 'reis-magos-fort',
    name: 'Reis Magos Fort',
    category: 'fort',
    locality: 'Reis Magos',
    region: 'north',
    lat: 15.4969,
    lng: 73.809,
    labels: ['lesser_known'],
    about: 'Restored riverside fort facing Panaji across the Mandovi.',
    crowd: 'quiet',
    tags: ['quiet', 'views'],
    respect: ['follow_posted_rules'],
  },
  {
    slug: 'cabo-de-rama-fort',
    name: 'Cabo de Rama Fort',
    category: 'fort',
    locality: 'Canacona',
    region: 'south',
    lat: 15.0886,
    lng: 73.9193,
    labels: ['lesser_known'],
    about: 'Clifftop fort on a quiet headland in the south.',
    tags: ['quiet', 'sunset'],
    safety: ['steep_access', 'no_mobile_signal'],
  },
  {
    slug: 'basilica-of-bom-jesus',
    name: 'Basilica of Bom Jesus',
    category: 'heritage-site',
    locality: 'Old Goa',
    region: 'central',
    lat: 15.5009,
    lng: 73.9116,
    labels: ['iconic'],
    about: 'Landmark church in the heritage precinct of Old Goa.',
    crowd: 'moderate',
    respect: ['dress_modestly', 'keep_noise_low', 'follow_posted_rules'],
  },
  {
    slug: 'fontainhas',
    name: 'Fontainhas',
    category: 'historic-precinct',
    locality: 'Panaji',
    region: 'central',
    lat: 15.4975,
    lng: 73.8327,
    labels: ['popular'],
    about: 'Old quarter of Panaji, known for its painted houses and narrow lanes.',
    tags: ['walk', 'photography'],
    respect: ['respect_residents', 'keep_noise_low'],
    posts: [{ handle: 'sample.creator', note: 'A slow morning walk through the lanes.' }],
  },
  {
    slug: 'dona-paula-viewpoint',
    name: 'Dona Paula Viewpoint',
    category: 'coastal-viewpoint',
    locality: 'Dona Paula',
    region: 'central',
    lat: 15.453,
    lng: 73.804,
    labels: ['popular'],
    about: 'Headland viewpoint where the Zuari meets the sea.',
    tags: ['sunset', 'family-friendly'],
  },
  {
    slug: 'miramar-beach',
    name: 'Miramar Beach',
    category: 'beach',
    locality: 'Panaji',
    region: 'central',
    lat: 15.4827,
    lng: 73.8073,
    labels: ['popular'],
    about: 'City beach at the edge of Panaji, busiest in the evening.',
    tags: ['family-friendly', 'sunset'],
    safety: ['rip_currents'],
  },
  {
    slug: 'anjuna-beach',
    name: 'Anjuna Beach',
    category: 'beach',
    locality: 'Anjuna',
    region: 'north',
    lat: 15.5736,
    lng: 73.7407,
    labels: ['popular'],
    about: 'Rocky, lively stretch of the north coast.',
    crowd: 'busy',
    safety: ['slippery_rocks', 'rip_currents'],
    respect: ['carry_rubbish_back'],
  },
  {
    slug: 'arambol-beach',
    name: 'Arambol Beach',
    category: 'beach',
    locality: 'Arambol',
    region: 'north',
    lat: 15.6869,
    lng: 73.704,
    labels: ['popular'],
    about: 'Long, wide beach in the far north.',
    crowd: 'quiet',
    tags: ['quiet', 'sunset'],
    safety: ['no_lifeguard'],
  },
  {
    slug: 'palolem-beach',
    name: 'Palolem Beach',
    category: 'beach',
    locality: 'Canacona',
    region: 'south',
    lat: 15.01,
    lng: 74.0232,
    labels: ['iconic'],
    about: 'Sheltered crescent bay in the south.',
    tags: ['family-friendly'],
  },
  {
    slug: 'colva-beach',
    name: 'Colva Beach',
    category: 'beach',
    locality: 'Colva',
    region: 'south',
    lat: 15.2793,
    lng: 73.922,
    labels: ['popular'],
    about: 'Broad sandy beach near Margao.',
    tags: ['family-friendly'],
  },
  {
    slug: 'dudhsagar-falls',
    name: 'Dudhsagar Falls',
    category: 'waterfall',
    locality: 'Mollem',
    region: 'inland',
    lat: 15.3144,
    lng: 74.3143,
    labels: ['iconic'],
    about: 'Tall, tiered waterfall inside a protected forest.',
    access: 'permit_required',
    safety: ['monsoon_hazard', 'slippery_rocks', 'permit_required', 'no_mobile_signal'],
    respect: ['follow_posted_rules', 'carry_rubbish_back'],
  },
  {
    slug: 'mapusa-market',
    name: 'Mapusa Market',
    category: 'market',
    locality: 'Mapusa',
    region: 'north',
    lat: 15.5916,
    lng: 73.8087,
    labels: ['local_favourite'],
    about: 'Working town market for produce, spices and everyday goods.',
    crowd: 'guide',
    safety: ['limited_parking'],
    respect: ['respect_residents'],
  },
  {
    slug: 'sample-courtyard-cafe',
    name: 'Sample: Courtyard Café',
    category: 'cafe',
    locality: 'Assagao',
    region: 'north',
    lat: 15.5935,
    lng: 73.7712,
    labels: ['lesser_known'],
    about: 'Invented example of a partner café listing. Not a real business.',
    crowd: 'quiet',
    tags: ['quiet', 'breakfast'],
    access: 'business_premises',
    partner: true,
    posts: [{ handle: 'sample.creator', note: 'Example of a tagged creator post.' }],
  },
  {
    slug: 'sample-riverside-cafe',
    name: 'Sample: Riverside Café',
    category: 'cafe',
    locality: 'Panaji',
    region: 'central',
    lat: 15.4989,
    lng: 73.8278,
    labels: ['popular'],
    about: 'Invented example of a café listing. Not a real business.',
    crowd: 'busy',
    access: 'business_premises',
  },
  {
    slug: 'sample-lane-cafe',
    name: 'Sample: Lane Café',
    category: 'cafe',
    locality: 'Panaji',
    region: 'central',
    lat: 15.4962,
    lng: 73.8318,
    labels: ['local_favourite'],
    about: 'Invented example of a café listing. Not a real business.',
    tags: ['quiet'],
    access: 'business_premises',
  },
];

const categoryOf = (slug: string) => {
  const group = GROUPS.find((g) => g.children.some(([child]) => child === slug))!;
  const label = group.children.find(([child]) => child === slug)![1];
  return { slug, label, group_slug: group.slug, group_label: group.label };
};

const iso = (minutesFromNow: number) =>
  new Date(Date.now() + minutesFromNow * 60_000).toISOString();

/** Example crowd states, generated at call time so the "live" ones are never expired. */
function crowdFor(preset: CrowdPreset | undefined): CrowdStatus {
  switch (preset) {
    case 'busy':
      return {
        status: 'live',
        level: 3,
        label: 'Busy',
        report_count: 5,
        latest_report_at: iso(-9),
        valid_until: iso(55),
      };
    case 'moderate':
      return {
        status: 'live',
        level: 2,
        label: 'Moderate',
        report_count: 3,
        latest_report_at: iso(-24),
        valid_until: iso(40),
      };
    case 'quiet':
      return {
        status: 'live',
        level: 1,
        label: 'Quiet',
        report_count: 4,
        latest_report_at: iso(-15),
        valid_until: iso(70),
      };
    case 'guide':
      return {
        status: 'guide',
        level: 3,
        label: 'Busy',
        guide_source: 'editorial',
        note: 'Evenings and weekends fill up.',
      };
    default:
      return { status: 'unavailable' };
  }
}

function toDetail(seed: Seed): SpotDetail {
  return {
    id: `preview-${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    short_description: seed.about,
    description: null,
    category: categoryOf(seed.category),
    discovery_labels: seed.labels,
    region: seed.region,
    locality: seed.locality,
    address_text: null,
    lat: seed.lat,
    lng: seed.lng,
    location_precision: 'approximate',
    public_access_status: seed.access ?? 'verified_public',
    price_band: null,
    best_time: null,
    parking_info: null,
    opening_hours: null,
    safety_tags: seed.safety ?? [],
    respect_tags: seed.respect ?? [],
    safety_notes: null,
    respect_notes: null,
    access_notes: null,
    verified_attributes: [],
    needs_recheck: false,
    temporarily_unavailable: false,
    last_verified_at: null,
    last_visited_at: null,
    media: [],
    sources: [],
    partner: seed.partner
      ? {
          id: `preview-partner-${seed.slug}`,
          business_name: seed.name,
          label_text: 'Partner',
          whatsapp_number: '',
          website_url: null,
        }
      : null,
    crowd: crowdFor(seed.crowd),
  };
}

function toCard(seed: Seed, origin: LatLng | null): SpotCard {
  const category = categoryOf(seed.category);
  const crowd = crowdFor(seed.crowd);
  return {
    id: `preview-${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    category_slug: category.slug,
    category_label: category.label,
    group_slug: category.group_slug,
    locality: seed.locality,
    region: seed.region,
    discovery_labels: seed.labels,
    lat: seed.lat,
    lng: seed.lng,
    thumb_path: null,
    is_partner: Boolean(seed.partner),
    partner_label: seed.partner ? 'Partner' : null,
    crowd_status: crowd.status === 'live' ? 'live' : null,
    crowd_level: crowd.status === 'live' ? (crowd.level ?? null) : null,
    distance_m: origin ? haversineMetres(origin, seed) : null,
    needs_recheck: false,
    temporarily_unavailable: false,
    last_verified_at: null,
  };
}

const normalise = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STOP = new Set([
  'in',
  'at',
  'to',
  'do',
  'the',
  'and',
  'near',
  'nearby',
  'me',
  'goa',
  'things',
  'places',
  'best',
]);

function tokens(query: string | null): string[] {
  return normalise(query ?? '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOP.has(word))
    .map((word) =>
      word.length > 3
        ? word.replace(/(ches|shes)$/, (m) => m.slice(0, -2)).replace(/s$/, '')
        : word,
    );
}

function searchText(seed: Seed): string {
  const category = categoryOf(seed.category);
  return normalise(
    [
      seed.name,
      seed.locality,
      `${seed.region} goa`,
      category.label,
      category.slug,
      category.group_label,
      ...(seed.tags ?? []),
      ...seed.labels,
    ]
      .join(' ')
      .replace(/_/g, ' '),
  );
}

function matches(seed: Seed, filters: SpotFilters): boolean {
  const f = toRpcFilters(filters) as {
    category_slugs?: string[];
    regions?: string[];
    labels?: string[];
    crowd?: string[];
    price_bands?: string[];
    attributes?: string[];
    partner_only?: boolean;
  };
  const category = categoryOf(seed.category);
  if (
    f.category_slugs &&
    !f.category_slugs.includes(category.slug) &&
    !f.category_slugs.includes(category.group_slug)
  )
    return false;
  if (f.regions && !f.regions.includes(seed.region ?? '')) return false;
  if (f.labels && !seed.labels.some((label) => f.labels!.includes(label))) return false;
  if (f.price_bands?.length || f.attributes?.length) return false;
  if (f.partner_only && !seed.partner) return false;
  if (f.crowd) {
    const crowd = crowdFor(seed.crowd);
    const key =
      crowd.status === 'live'
        ? (['quiet', 'moderate', 'busy'] as const)[(crowd.level ?? 1) - 1]
        : 'unavailable';
    if (!f.crowd.includes(key!)) return false;
  }
  return true;
}

function list(
  filters: SpotFilters,
  origin: LatLng | null,
  predicate: (seed: Seed) => boolean = () => true,
): SpotCard[] {
  const cards = SEEDS.filter((seed) => matches(seed, filters) && predicate(seed)).map((seed) =>
    toCard(seed, origin),
  );
  return origin ? cards.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0)) : cards;
}

const seedById = (spotId: string) => SEEDS.find((seed) => `preview-${seed.slug}` === spotId);

export function createPreviewApi(): Api {
  return {
    async listCategories() {
      return CATEGORIES;
    },

    async nearbySpots({ origin, radiusM, filters, limit }) {
      return list(filters, origin)
        .filter((card) => (card.distance_m ?? 0) <= radiusM)
        .slice(0, limit ?? 30);
    },

    async spotsInBbox({ west, south, east, north, filters }) {
      return list(
        filters,
        null,
        (seed) => seed.lng >= west && seed.lng <= east && seed.lat >= south && seed.lat <= north,
      );
    },

    async searchSpots({ query, filters, origin, limit }) {
      const wanted = tokens(query);
      return list(filters, origin ?? null, (seed) => {
        const text = searchText(seed);
        return wanted.every((token) => text.includes(token));
      }).slice(0, limit ?? 30);
    },

    async getSpotDetail(slug) {
      const seed = SEEDS.find((s) => s.slug === slug);
      return seed ? toDetail(seed) : null;
    },

    async getCrowdStatus(spotId) {
      return crowdFor(seedById(spotId)?.crowd);
    },

    async getAlternatives(spotId, radiusM = 15_000) {
      const origin = seedById(spotId);
      if (!origin)
        return { crowd_comparison_available: false, radius_m: radiusM, alternatives: [] };
      const originCrowd = crowdFor(origin.crowd);
      const originLevel = originCrowd.status === 'live' ? (originCrowd.level ?? null) : null;
      const group = categoryOf(origin.category).group_slug;

      const alternatives: Alternative[] = SEEDS.filter(
        (seed) => seed.slug !== origin.slug && categoryOf(seed.category).group_slug === group,
      )
        .map((seed) => {
          const card = toCard(seed, origin);
          const quieter =
            originLevel != null && card.crowd_level != null && card.crowd_level < originLevel;
          const asBusy =
            originLevel != null && card.crowd_level != null && card.crowd_level >= originLevel;
          return { seed, card, quieter, asBusy };
        })
        .filter(({ card, asBusy }) => (card.distance_m ?? 0) <= radiusM && !asBusy)
        .sort(
          (a, b) =>
            Number(b.quieter) - Number(a.quieter) ||
            (a.card.distance_m ?? 0) - (b.card.distance_m ?? 0),
        )
        .slice(0, 3)
        .map(({ seed, card, quieter }) => ({
          id: card.id,
          slug: card.slug,
          name: card.name,
          category_slug: card.category_slug,
          category_label: card.category_label,
          locality: card.locality,
          region: card.region,
          discovery_labels: card.discovery_labels,
          lat: card.lat,
          lng: card.lng,
          thumb_path: null,
          distance_m: Math.round(card.distance_m ?? 0),
          crowd_status: card.crowd_status,
          crowd_level: card.crowd_level,
          same_category: seed.category === origin.category,
          reason: quieter ? 'quieter' : 'similar_nearby',
        }));

      return {
        origin_crowd_level: originLevel,
        crowd_comparison_available: alternatives.some((alt) => alt.reason === 'quieter'),
        radius_m: radiusM,
        alternatives,
      };
    },

    async getSocialPosts(spotId): Promise<SocialPost[]> {
      return (seedById(spotId)?.posts ?? []).map((post, index) => ({
        id: `${spotId}-post-${index}`,
        platform: 'instagram' as const,
        // A real, harmless page: preview posts are examples, not real creator content.
        url: 'https://www.instagram.com/explore/tags/goa/',
        creator_handle: post.handle,
        note: post.note,
      }));
    },

    // Nothing is sent anywhere in preview mode. Screens disable these actions; these guards
    // make sure of it.
    async submitCrowdReport() {
      throw new PreviewOnlyError();
    },
    async submitProblem() {
      throw new PreviewOnlyError();
    },
    async trackPartnerEnquiry() {
      return { ok: false };
    },
    async trackEvents() {
      return 0;
    },
    async linkPartnerDevice() {
      throw new PreviewOnlyError();
    },
  };
}
