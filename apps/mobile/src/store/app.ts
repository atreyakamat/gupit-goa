import { EMPTY_FILTERS, type LatLng, type SpotFilters } from '@gupit/shared';
import { create } from 'zustand';

export type LocationPermission = 'unknown' | 'granted' | 'denied';

interface AppState {
  filters: SpotFilters;
  setFilters: (next: SpotFilters) => void;
  resetFilters: () => void;

  viewMode: 'map' | 'list';
  setViewMode: (mode: 'map' | 'list') => void;

  /**
   * The most recent one-off location fix. Held in memory only: it is never written to
   * disk, never sent to analytics, and is gone when the app closes.
   */
  position: LatLng | null;
  permission: LocationPermission;
  setPosition: (position: LatLng | null, permission: LocationPermission) => void;

  isAdmin: boolean;
  setAdmin: (value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  filters: EMPTY_FILTERS,
  setFilters: (filters) => set({ filters }),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),

  viewMode: 'list',
  setViewMode: (viewMode) => set({ viewMode }),

  position: null,
  permission: 'unknown',
  setPosition: (position, permission) => set({ position, permission }),

  isAdmin: false,
  setAdmin: (isAdmin) => set({ isAdmin }),
}));
