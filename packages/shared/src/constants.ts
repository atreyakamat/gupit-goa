/** Product rules and vocabularies shared by the app, the worker and the tests. */

export const REGIONS = ['north', 'central', 'south', 'inland'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  north: 'North Goa',
  central: 'Central Goa',
  south: 'South Goa',
  inland: 'Inland Goa',
};

export const DISCOVERY_LABELS = ['iconic', 'popular', 'lesser_known', 'local_favourite'] as const;
export type DiscoveryLabel = (typeof DISCOVERY_LABELS)[number];

export const DISCOVERY_LABEL_TEXT: Record<DiscoveryLabel, string> = {
  iconic: 'Iconic',
  popular: 'Popular',
  lesser_known: 'Lesser-known',
  local_favourite: 'Local favourite',
};

export const PRICE_BANDS = ['free', 'budget', 'mid', 'premium'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export const PRICE_BAND_TEXT: Record<PriceBand, string> = {
  free: 'Free',
  budget: 'Budget',
  mid: 'Mid-range',
  premium: 'Premium',
};

/**
 * Crowd rules. The database enforces these; the values here are for copy and client-side
 * expiry only. Changing them here does not change the server.
 */
export const CROWD_RULES = {
  proximityMetres: 300,
  minDistinctReports: 3,
  windowMinutes: 120,
  perPlaceCooldownMinutes: 60,
  alternativesRadiusMetres: 15_000,
} as const;

export const CROWD_LEVELS = [1, 2, 3] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

export const CROWD_LEVEL_TEXT: Record<CrowdLevel, string> = {
  1: 'Quiet',
  2: 'Moderate',
  3: 'Busy',
};

export const CROWD_FILTERS = ['quiet', 'moderate', 'busy', 'unavailable'] as const;
export type CrowdFilter = (typeof CROWD_FILTERS)[number];

export const SAFETY_TAGS: Record<string, string> = {
  rip_currents: 'Rip currents or strong waves',
  no_lifeguard: 'No lifeguard',
  slippery_rocks: 'Slippery rocks',
  steep_access: 'Steep or uneven access',
  poor_lighting: 'Poor lighting after dark',
  no_mobile_signal: 'No reliable mobile signal',
  monsoon_hazard: 'Seasonal closure or monsoon hazard',
  limited_parking: 'Limited parking',
  permit_required: 'Restricted access or permit required',
};

export const RESPECT_TAGS: Record<string, string> = {
  carry_rubbish_back: 'Take your rubbish back with you',
  keep_noise_low: 'Keep noise low',
  respect_residents: 'Respect residents and local customs',
  follow_posted_rules: 'Follow posted rules and site instructions',
  dress_modestly: 'Dress modestly',
  no_drones: 'No drones',
};

export const VERIFIED_ATTRIBUTES: Record<string, string> = {
  family_suitable: 'Family-suitable',
  step_free_access: 'Step-free access',
  wifi: 'Wi-Fi',
  pet_friendly: 'Pet-friendly',
};

export const PROBLEM_TYPES = [
  'closed',
  'unsafe',
  'wrong_pin',
  'wrong_hours',
  'private_access',
  'other',
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const PROBLEM_TYPE_TEXT: Record<ProblemType, string> = {
  closed: 'It is closed',
  unsafe: 'It is unsafe',
  wrong_pin: 'The map pin is wrong',
  wrong_hours: 'The hours are wrong',
  private_access: 'It is private or access is restricted',
  other: 'Something else',
};

export const ANALYTICS_EVENTS = [
  'app_opened',
  'explore_viewed',
  'map_viewed',
  'list_viewed',
  'filter_applied',
  'search_submitted',
  'spot_opened',
  'spot_saved',
  'spot_unsaved',
  'directions_opened',
  'share_opened',
  'crowd_report_submitted',
  'alternatives_opened',
  'partner_profile_opened',
  'problem_report_submitted',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Keys that must never be sent to analytics. The server strips them as well. */
export const ANALYTICS_FORBIDDEN_KEYS = [
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'location',
  'message',
  'text',
  'query',
  'installation_token',
] as const;

/** Goa and a small margin. Used to sanity-check pins before they reach the server. */
export const GOA_BOUNDS = { minLat: 14.7, maxLat: 15.95, minLng: 73.5, maxLng: 74.5 } as const;
export const GOA_CENTER = { lat: 15.4, lng: 74.0 } as const;

export const PARTNER_SURFACES = ['spot_detail', 'map_card', 'list_card', 'search'] as const;
export type PartnerSurface = (typeof PARTNER_SURFACES)[number];
