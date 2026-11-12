import type { LatLng, SpotCard, SpotDetail, SpotFilters } from '@gupit/shared';
import { toRpcFilters } from '@gupit/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { api } from './api';
import { syncAccountSoon } from '@/features/account/session';
import { getLocalStore, type CachedSpot, type SavedList } from './db';

export function useOnline(): boolean {
  const state = useNetworkState();
  // Unknown counts as online: only a definite "no" shows the offline banner.
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: api.listCategories,
    staleTime: 24 * 60 * 60_000,
  });
}

export interface CardsResult {
  cards: SpotCard[];
  fetchedAt: number;
}

/** List mode: everything matching the filters, nearest first when a location is known. */
export function useBrowseCards(input: {
  query: string | null;
  filters: SpotFilters;
  origin: LatLng | null;
  enabled?: boolean;
}) {
  const { query, filters, origin } = input;
  const radiusM = origin && filters.radiusKm ? filters.radiusKm * 1000 : null;
  return useQuery<CardsResult>({
    queryKey: [
      'cards',
      'browse',
      query,
      toRpcFilters(filters),
      radiusM,
      origin ? [origin.lat.toFixed(3), origin.lng.toFixed(3)] : null,
    ],
    queryFn: async () => {
      const cards =
        origin && radiusM && !query
          ? await api.nearbySpots({ origin, radiusM, filters, limit: 50 })
          : await api.searchSpots({ query, filters, origin, limit: 50 });
      const within =
        radiusM == null
          ? cards
          : cards.filter((c) => c.distance_m == null || c.distance_m <= radiusM);
      return { cards: within, fetchedAt: Date.now() };
    },
    enabled: input.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const round = (n: number) => Math.round(n * 200) / 200;

/** Map mode: pins for the visible area only, capped by the server. */
export function useViewportCards(bounds: Bounds | null, filters: SpotFilters) {
  const key = bounds
    ? [round(bounds.west), round(bounds.south), round(bounds.east), round(bounds.north)]
    : null;
  return useQuery<CardsResult>({
    queryKey: ['cards', 'bbox', key, toRpcFilters(filters)],
    queryFn: async () => ({
      cards: await api.spotsInBbox({ ...bounds!, filters }),
      fetchedAt: Date.now(),
    }),
    enabled: bounds != null && bounds.north > bounds.south && bounds.east > bounds.west,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export interface DetailResult {
  detail: SpotDetail;
  /** True when this came from the device because the network request failed. */
  fromCache: boolean;
  cachedAt: number;
}

/**
 * Place detail: network first, and every success refreshes the on-device snapshot.
 * If the network fails, the last snapshot is returned and flagged, so saved and recently
 * viewed places stay readable offline. Crowd data in a snapshot expires on its own.
 */
export function useSpotDetail(slug: string) {
  return useQuery<DetailResult | null>({
    queryKey: ['spot', slug],
    queryFn: async () => {
      const store = await getLocalStore();
      try {
        const detail = await api.getSpotDetail(slug);
        if (!detail) return null;
        await store.cacheSpot(detail);
        void store.pruneCache();
        return { detail, fromCache: false, cachedAt: Date.now() };
      } catch (error) {
        const cached = await store.getCachedSpot(slug);
        if (cached) return { detail: cached.detail, fromCache: true, cachedAt: cached.cachedAt };
        throw error;
      }
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useAlternatives(spotId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['alternatives', spotId],
    queryFn: () => api.getAlternatives(spotId!),
    enabled: enabled && Boolean(spotId),
    staleTime: 60_000,
  });
}

// -- Saved lists (on the device; backed up only when signed in) ----------------

export function useSavedLists() {
  return useQuery<SavedList[]>({
    queryKey: ['saved', 'lists'],
    queryFn: async () => (await getLocalStore()).listLists(),
  });
}

export function useSavedListSpots(listId: string) {
  return useQuery<CachedSpot[]>({
    queryKey: ['saved', 'list', listId],
    queryFn: async () => (await getLocalStore()).listSpots(listId),
  });
}

export function useListIdsContaining(spotId: string | undefined) {
  return useQuery<string[]>({
    queryKey: ['saved', 'containing', spotId],
    queryFn: async () => (await getLocalStore()).listIdsContaining(spotId!),
    enabled: Boolean(spotId),
  });
}

export function useSavedMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['saved'] });
  // Changes that the account backup needs to hear about. A no-op for guests.
  const changed = () => {
    syncAccountSoon();
    return refresh();
  };
  return {
    createList: useMutation({
      mutationFn: async (name: string) => (await getLocalStore()).createList(name),
      onSuccess: refresh,
    }),
    renameList: useMutation({
      mutationFn: async (input: { id: string; name: string }) =>
        (await getLocalStore()).renameList(input.id, input.name),
      onSuccess: refresh,
    }),
    deleteList: useMutation({
      mutationFn: async (id: string) => (await getLocalStore()).deleteList(id),
      onSuccess: changed,
    }),
    save: useMutation({
      mutationFn: async (input: { listId: string | null; detail: SpotDetail }) => {
        const store = await getLocalStore();
        const listId = input.listId ?? (await store.ensureDefaultList()).id;
        await store.saveSpot(listId, input.detail);
        return listId;
      },
      onSuccess: changed,
    }),
    unsave: useMutation({
      mutationFn: async (input: { listId: string; spotId: string }) =>
        (await getLocalStore()).unsaveSpot(input.listId, input.spotId),
      onSuccess: changed,
    }),
  };
}

export function useSocialPosts(spotId: string | undefined) {
  return useQuery({
    queryKey: ['social-posts', spotId],
    queryFn: () => api.getSocialPosts(spotId!),
    enabled: Boolean(spotId),
    staleTime: 10 * 60_000,
  });
}
