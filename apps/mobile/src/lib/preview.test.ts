import {
  EMPTY_FILTERS,
  alternativesSchema,
  describeCrowd,
  socialPostSchema,
  spotCardSchema,
  spotDetailSchema,
} from '@gupit/shared';
import { describe, expect, it } from 'vitest';
import { createPreviewApi } from './preview';

const api = createPreviewApi();
const PANAJI = { lat: 15.4909, lng: 73.8278 };

describe('preview data', () => {
  it('matches the same response contracts as the live backend', async () => {
    const cards = await api.searchSpots({ query: null, filters: EMPTY_FILTERS });
    expect(cards.length).toBeGreaterThan(10);
    for (const card of cards) {
      expect(spotCardSchema.safeParse(card).success).toBe(true);
      const detail = await api.getSpotDetail(card.slug);
      expect(spotDetailSchema.safeParse(detail).success).toBe(true);
      expect(alternativesSchema.safeParse(await api.getAlternatives(card.id)).success).toBe(true);
      for (const post of await api.getSocialPosts(card.id))
        expect(socialPostSchema.safeParse(post).success).toBe(true);
    }
  });

  it('never claims a practical fact or a verification it does not have', async () => {
    for (const card of await api.searchSpots({ query: null, filters: EMPTY_FILTERS })) {
      const detail = (await api.getSpotDetail(card.slug))!;
      expect(detail.opening_hours).toBeNull();
      expect(detail.price_band).toBeNull();
      expect(detail.last_verified_at).toBeNull();
      expect(detail.location_precision).toBe('approximate');
      expect(detail.media).toEqual([]);
      // Invented businesses are labelled as samples and carry no contact number.
      if (detail.category.group_slug === 'eat-drink')
        expect(detail.name.startsWith('Sample: ')).toBe(true);
      expect(detail.partner?.whatsapp_number ?? '').toBe('');
    }
  });

  it('filters, searches and sorts by distance like the real API', async () => {
    const forts = await api.searchSpots({ query: 'forts', filters: EMPTY_FILTERS });
    expect(forts.every((c) => c.category_slug === 'fort')).toBe(true);
    expect(forts.length).toBe(4);
    expect((await api.searchSpots({ query: 'cafés', filters: EMPTY_FILTERS })).length).toBe(3);
    expect((await api.searchSpots({ query: 'zzzz', filters: EMPTY_FILTERS })).length).toBe(0);

    const south = await api.searchSpots({
      query: null,
      filters: { ...EMPTY_FILTERS, regions: ['south'] },
    });
    expect(south.every((c) => c.region === 'south')).toBe(true);
    const beaches = await api.searchSpots({
      query: null,
      filters: { ...EMPTY_FILTERS, categorySlugs: ['beaches-coast'] },
    });
    expect(beaches.every((c) => c.group_slug === 'beaches-coast')).toBe(true);
    const partners = await api.searchSpots({
      query: null,
      filters: { ...EMPTY_FILTERS, partnerOnly: true },
    });
    expect(partners.map((c) => c.is_partner)).toEqual([true]);

    const near = await api.nearbySpots({ origin: PANAJI, radiusM: 5000, filters: EMPTY_FILTERS });
    expect(near.length).toBeGreaterThan(2);
    const distances = near.map((c) => c.distance_m ?? 0);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(Math.max(...distances)).toBeLessThanOrEqual(5000);

    const box = await api.spotsInBbox({
      west: 73.9,
      south: 14.9,
      east: 74.1,
      north: 15.2,
      filters: EMPTY_FILTERS,
    });
    expect(box.map((c) => c.slug).sort()).toEqual(['cabo-de-rama-fort', 'palolem-beach']);
  });

  it('example live crowd levels are fresh, and Try instead follows the real rules', async () => {
    const busy = (await api.getSpotDetail('chapora-fort'))!;
    expect(describeCrowd(busy.crowd, new Date())).toMatchObject({ kind: 'live', level: 3 });
    const alternatives = await api.getAlternatives(busy.id);
    expect(alternatives.crowd_comparison_available).toBe(true);
    expect(alternatives.alternatives[0]).toMatchObject({
      slug: 'reis-magos-fort',
      reason: 'quieter',
    });
    expect(alternatives.alternatives.every((a) => a.distance_m <= 15_000)).toBe(true);

    const noData = await api.getAlternatives('preview-palolem-beach');
    expect(noData.crowd_comparison_available).toBe(false);
  });

  it('refuses to pretend anything was sent', async () => {
    await expect(
      api.submitCrowdReport({ spotId: 'preview-chapora-fort', level: 3, position: PANAJI }),
    ).rejects.toThrow(/preview_mode/);
    await expect(
      api.submitProblem({ spotId: 'preview-chapora-fort', type: 'other', message: null }),
    ).rejects.toThrow(/preview_mode/);
    expect(
      await api.trackEvents({ events: [], sessionId: 's', platform: 'android', appVersion: '0' }),
    ).toBe(0);
  });
});
