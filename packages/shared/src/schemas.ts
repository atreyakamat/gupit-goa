import { z } from 'zod';
import { DISCOVERY_LABELS, PRICE_BANDS, REGIONS } from './constants';

/**
 * Shapes returned by the public RPCs. The app parses every response with these, so a
 * backend change that breaks the contract fails loudly instead of rendering wrong data.
 */

const crowdLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const spotCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category_slug: z.string(),
  category_label: z.string(),
  group_slug: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.enum(REGIONS).nullable(),
  discovery_labels: z.array(z.string()),
  lat: z.number(),
  lng: z.number(),
  thumb_path: z.string().nullable(),
  is_partner: z.boolean(),
  partner_label: z.string().nullable(),
  crowd_status: z.string().nullable(),
  crowd_level: crowdLevel.nullable(),
  distance_m: z.number().nullable(),
  needs_recheck: z.boolean(),
  temporarily_unavailable: z.boolean(),
  last_verified_at: z.string().nullable(),
});
export type SpotCard = z.infer<typeof spotCardSchema>;

export const crowdStatusSchema = z.object({
  status: z.enum(['live', 'mixed', 'guide', 'unavailable']),
  level: crowdLevel.nullish(),
  label: z.string().nullish(),
  report_count: z.number().nullish(),
  latest_report_at: z.string().nullish(),
  valid_until: z.string().nullish(),
  guide_source: z.enum(['history', 'editorial']).nullish(),
  sample_size: z.number().nullish(),
  note: z.string().nullish(),
});
export type CrowdStatus = z.infer<typeof crowdStatusSchema>;

export const spotDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  short_description: z.string().nullable(),
  description: z.string().nullable(),
  category: z.object({
    slug: z.string(),
    label: z.string(),
    group_slug: z.string().nullable(),
    group_label: z.string().nullable(),
  }),
  discovery_labels: z.array(z.string()),
  region: z.enum(REGIONS).nullable(),
  locality: z.string().nullable(),
  address_text: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  location_precision: z.enum(['exact', 'approximate', 'needs_review']),
  public_access_status: z.string(),
  price_band: z.enum(PRICE_BANDS).nullable(),
  best_time: z.string().nullable(),
  parking_info: z.string().nullable(),
  opening_hours: z
    .object({ text: z.string().nullish(), verified_at: z.string().nullish() })
    .nullable(),
  safety_tags: z.array(z.string()),
  respect_tags: z.array(z.string()),
  safety_notes: z.string().nullable(),
  respect_notes: z.string().nullable(),
  access_notes: z.string().nullable(),
  verified_attributes: z.array(z.string()),
  needs_recheck: z.boolean(),
  temporarily_unavailable: z.boolean(),
  last_verified_at: z.string().nullable(),
  last_visited_at: z.string().nullable(),
  media: z.array(
    z.object({
      id: z.string(),
      storage_path: z.string(),
      thumb_path: z.string().nullable(),
      alt_text: z.string().nullable(),
      credit_line: z.string().nullable(),
    }),
  ),
  sources: z.array(
    z.object({
      title: z.string().nullable(),
      publisher: z.string().nullable(),
      url: z.string().nullable(),
      attribution: z.string().nullable(),
    }),
  ),
  partner: z
    .object({
      id: z.string(),
      business_name: z.string(),
      label_text: z.string(),
      whatsapp_number: z.string(),
      website_url: z.string().nullable(),
    })
    .nullable(),
  crowd: crowdStatusSchema,
});
export type SpotDetail = z.infer<typeof spotDetailSchema>;

export const alternativeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category_slug: z.string(),
  category_label: z.string(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  discovery_labels: z.array(z.string()),
  lat: z.number(),
  lng: z.number(),
  thumb_path: z.string().nullable(),
  distance_m: z.number(),
  crowd_status: z.string().nullable(),
  crowd_level: crowdLevel.nullable(),
  same_category: z.boolean(),
  reason: z.enum(['quieter', 'similar_nearby']),
});
export type Alternative = z.infer<typeof alternativeSchema>;

export const alternativesSchema = z.object({
  origin_crowd_level: crowdLevel.nullish(),
  crowd_comparison_available: z.boolean(),
  radius_m: z.number().nullish(),
  alternatives: z.array(alternativeSchema),
});
export type Alternatives = z.infer<typeof alternativesSchema>;

export const crowdSubmitResultSchema = z.object({
  accepted: z.boolean(),
  reason: z
    .enum(['too_far', 'partner_device', 'already_reported', 'rate_limited', 'spot_unavailable'])
    .nullish(),
  retry_after_seconds: z.number().nullish(),
  crowd: crowdStatusSchema.nullish(),
});
export type CrowdSubmitResult = z.infer<typeof crowdSubmitResultSchema>;

export const categorySchema = z.object({
  id: z.string(),
  parent_slug: z.string().nullable(),
  slug: z.string(),
  label: z.string(),
  sort_order: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

// ---------------------------------------------------------------------------
// Research candidate extraction (worker output, reviewed in the admin screens).
// Bump EXTRACTION_SCHEMA_VERSION whenever a field is added, removed or changes meaning.
// ---------------------------------------------------------------------------
export const EXTRACTION_SCHEMA_VERSION = '1';

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const extractedCandidateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(8),
  category_slug: z.string().nullable(),
  secondary_category_slugs: z.array(z.string()).max(4),
  locality: optionalText(120),
  region: z.enum(REGIONS).nullable(),
  address_text: optionalText(300),
  /** Only when the source itself states coordinates. Never inferred from a locality. */
  stated_lat: z.number().min(-90).max(90).nullable(),
  stated_lng: z.number().min(-180).max(180).nullable(),
  description_draft: optionalText(280),
  best_time: optionalText(200),
  visit_duration: optionalText(120),
  price_band: z.enum(PRICE_BANDS).nullable(),
  access_notes: optionalText(400),
  parking_info: optionalText(300),
  opening_hours_text: optionalText(300),
  contact_phone: optionalText(40),
  website_url: optionalText(300),
  crowd_notes: optionalText(300),
  safety_notes: optionalText(400),
  respect_notes: optionalText(300),
  positioning: z.array(z.enum(DISCOVERY_LABELS)).max(2),
  positioning_reason: optionalText(300),
  risk_notes: z.array(z.string().trim().min(1).max(300)).max(8),
  /** Short phrase from the source that supports the place's existence. Not a copied passage. */
  evidence_excerpt: optionalText(280),
  /** Which fields the source actually supports. */
  claims_supported: z.array(z.string()).max(20),
});
export type ExtractedCandidate = z.infer<typeof extractedCandidateSchema>;

export const extractionResultSchema = z.object({
  candidates: z.array(extractedCandidateSchema).max(25),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const riskFlagSchema = z.object({
  code: z.string(),
  severity: z.enum(['block', 'warn']),
  source: z.enum(['deterministic', 'llm', 'human']),
  note: z.string().nullish(),
  created_at: z.string().nullish(),
  resolved_at: z.string().nullish(),
  resolved_by: z.string().nullish(),
  resolution_note: z.string().nullish(),
});
export type RiskFlag = z.infer<typeof riskFlagSchema>;

export const confidenceBreakdownSchema = z.object({
  source_quality: z.number(),
  corroboration: z.number(),
  identity: z.number(),
  location: z.number(),
  recency: z.number(),
  safety_access: z.number(),
  notes: z.array(z.string()),
});
export type ConfidenceBreakdown = z.infer<typeof confidenceBreakdownSchema>;
