import {
  alternativesSchema,
  categorySchema,
  crowdStatusSchema,
  crowdSubmitResultSchema,
  spotCardSchema,
  spotDetailSchema,
  toRpcFilters,
  type Alternatives,
  type Category,
  type CrowdStatus,
  type CrowdSubmitResult,
  type LatLng,
  type PartnerSurface,
  type ProblemType,
  type SpotCard,
  type SpotDetail,
  type SpotFilters,
} from '@gupit/shared';
import { z } from 'zod';
import { getInstallationToken } from './installation';
import { getSupabase } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Calls an RPC and validates the response shape. A contract break fails loudly. */
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new ApiError(error.message, error.code);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(`Unexpected response from ${name}`, 'contract_mismatch');
  }
  return parsed.data;
}

const cards = z.array(spotCardSchema);

export const api = {
  listCategories(): Promise<Category[]> {
    return rpc('list_categories', {}, z.array(categorySchema));
  },

  nearbySpots(input: {
    origin: LatLng;
    radiusM: number;
    filters: SpotFilters;
    limit?: number;
    cursor?: number;
  }): Promise<SpotCard[]> {
    return rpc(
      'nearby_spots',
      {
        p_lat: input.origin.lat,
        p_lng: input.origin.lng,
        p_radius_m: input.radiusM,
        p_filters: toRpcFilters(input.filters),
        p_limit: input.limit ?? 30,
        p_cursor: input.cursor ?? 0,
      },
      cards,
    );
  },

  spotsInBbox(input: {
    west: number;
    south: number;
    east: number;
    north: number;
    filters: SpotFilters;
  }): Promise<SpotCard[]> {
    return rpc(
      'spots_in_bbox',
      {
        p_min_lat: input.south,
        p_min_lng: input.west,
        p_max_lat: input.north,
        p_max_lng: input.east,
        p_filters: toRpcFilters(input.filters),
      },
      cards,
    );
  },

  searchSpots(input: {
    query: string | null;
    filters: SpotFilters;
    origin?: LatLng | null;
    limit?: number;
    cursor?: number;
  }): Promise<SpotCard[]> {
    return rpc(
      'search_spots',
      {
        p_query: input.query,
        p_filters: toRpcFilters(input.filters),
        p_limit: input.limit ?? 30,
        p_cursor: input.cursor ?? 0,
        p_lat: input.origin?.lat ?? null,
        p_lng: input.origin?.lng ?? null,
      },
      cards,
    );
  },

  getSpotDetail(slug: string): Promise<SpotDetail | null> {
    return rpc('get_spot_detail', { p_slug: slug }, spotDetailSchema.nullable());
  },

  getCrowdStatus(spotId: string): Promise<CrowdStatus> {
    return rpc('get_crowd_status', { p_spot_id: spotId }, crowdStatusSchema);
  },

  /**
   * The coordinate is sent once so the server can check proximity. The server does not
   * store it, and the app does not keep it either.
   */
  async submitCrowdReport(input: {
    spotId: string;
    level: 1 | 2 | 3;
    position: LatLng;
  }): Promise<CrowdSubmitResult> {
    return rpc(
      'submit_crowd_report',
      {
        p_spot_id: input.spotId,
        p_level: input.level,
        p_lat: input.position.lat,
        p_lng: input.position.lng,
        p_installation_token: await getInstallationToken(),
      },
      crowdSubmitResultSchema,
    );
  },

  getAlternatives(spotId: string, radiusM?: number): Promise<Alternatives> {
    return rpc(
      'get_spot_alternatives',
      { p_spot_id: spotId, p_radius_m: radiusM ?? 15000, p_limit: 3 },
      alternativesSchema,
    );
  },

  async submitProblem(input: {
    spotId: string;
    type: ProblemType;
    message: string | null;
  }): Promise<{ accepted: boolean; reason?: string | null }> {
    return rpc(
      'submit_spot_problem',
      {
        p_spot_id: input.spotId,
        p_type: input.type,
        p_message: input.message,
        p_installation_token: await getInstallationToken(),
      },
      z.object({ accepted: z.boolean(), reason: z.string().nullish() }),
    );
  },

  trackPartnerEnquiry(input: {
    partnerId: string;
    spotId: string;
    surface: PartnerSurface;
    sessionId: string;
  }): Promise<{ ok: boolean }> {
    return rpc(
      'track_partner_enquiry',
      {
        p_partner_id: input.partnerId,
        p_spot_id: input.spotId,
        p_source_surface: input.surface,
        p_session_id: input.sessionId,
      },
      z.object({ ok: z.boolean() }),
    );
  },

  trackEvents(input: {
    events: { name: string; props: Record<string, unknown> }[];
    sessionId: string;
    platform: string;
    appVersion: string;
  }): Promise<number> {
    return rpc(
      'track_events',
      {
        p_events: input.events,
        p_session_id: input.sessionId,
        p_platform: input.platform,
        p_app_version: input.appVersion,
      },
      z.number(),
    );
  },

  async linkPartnerDevice(
    code: string,
  ): Promise<{ linked: boolean; business_name?: string | null }> {
    return rpc(
      'link_partner_device',
      { p_claim_code: code, p_installation_token: await getInstallationToken() },
      z.object({ linked: z.boolean(), business_name: z.string().nullish() }),
    );
  },
};

/** Public URL for an object in the listing-photo bucket. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return getSupabase().storage.from('spot-media').getPublicUrl(path).data.publicUrl;
}
