import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  buildDirectionsUrls,
  buildShareMessage,
  buildWhatsAppUrl,
  cardCrowdLabel,
  countActiveFilters,
  crowdRejectionText,
  describeCrowd,
  extractedCandidateSchema,
  formatDistance,
  haversineMetres,
  isWithinGoa,
  normaliseWhatsAppNumber,
  parseFilters,
  spotCardSchema,
  toRpcFilters,
  toggle,
} from './index';

const now = new Date('2026-11-11T12:00:00Z');
const iso = (minutesFromNow: number) =>
  new Date(now.getTime() + minutesFromNow * 60_000).toISOString();

describe('describeCrowd', () => {
  it('shows a live level with its evidence', () => {
    const d = describeCrowd(
      {
        status: 'live',
        level: 3,
        report_count: 4,
        latest_report_at: iso(-12),
        valid_until: iso(40),
      },
      now,
    );
    expect(d).toMatchObject({ kind: 'live', level: 3, label: 'Busy now' });
    expect(d.detail).toBe('Based on 4 recent on-site reports, latest 12 min ago.');
  });

  it('never presents an expired live status as current', () => {
    const d = describeCrowd(
      {
        status: 'live',
        level: 3,
        report_count: 3,
        latest_report_at: iso(-130),
        valid_until: iso(-1),
      },
      now,
    );
    expect(d.kind).toBe('unavailable');
  });

  it('treats a live status without an expiry as unavailable', () => {
    expect(describeCrowd({ status: 'live', level: 2, report_count: 3 }, now).kind).toBe(
      'unavailable',
    );
  });

  it('reports mixed evidence without a level', () => {
    const d = describeCrowd(
      { status: 'mixed', level: null, report_count: 3, valid_until: iso(10) },
      now,
    );
    expect(d).toMatchObject({ kind: 'mixed', label: 'Mixed reports' });
  });

  it('labels guides as guides, not live data', () => {
    const editorial = describeCrowd(
      { status: 'guide', level: 3, guide_source: 'editorial', note: 'Evenings fill up.' },
      now,
    );
    expect(editorial.label).toBe('Usually busy around this time');
    expect(editorial.detail).toContain('Not live data');
    const history = describeCrowd(
      { status: 'guide', level: 1, guide_source: 'history', sample_size: 12 },
      now,
    );
    expect(history.detail).toContain('past reports');
  });

  it('falls back to unavailable for missing or unknown input', () => {
    expect(describeCrowd(null, now).kind).toBe('unavailable');
    expect(describeCrowd({ status: 'unavailable' }, now).kind).toBe('unavailable');
  });
});

describe('cardCrowdLabel', () => {
  const t0 = now.getTime();
  it('shows a chip only for fresh live data', () => {
    expect(cardCrowdLabel({ crowd_status: 'live', crowd_level: 1 }, t0, t0 + 60_000)).toBe('Quiet');
    expect(
      cardCrowdLabel({ crowd_status: 'live', crowd_level: 1 }, t0, t0 + 11 * 60_000),
    ).toBeNull();
    expect(cardCrowdLabel({ crowd_status: 'mixed', crowd_level: null }, t0, t0)).toBeNull();
    expect(cardCrowdLabel({ crowd_status: null, crowd_level: null }, t0, t0)).toBeNull();
  });
});

describe('crowdRejectionText', () => {
  it('explains each server reason in plain words', () => {
    expect(crowdRejectionText('too_far')).toContain('300 m');
    expect(crowdRejectionText('already_reported', 1500)).toContain('25 min');
    expect(crowdRejectionText('something_new')).toContain('could not be sent');
  });
});

describe('links', () => {
  it('normalises Indian and international WhatsApp numbers', () => {
    expect(normaliseWhatsAppNumber('98765 43210')).toBe('919876543210');
    expect(normaliseWhatsAppNumber('098765 43210')).toBe('919876543210');
    expect(normaliseWhatsAppNumber('+91 98765-43210')).toBe('919876543210');
    expect(normaliseWhatsAppNumber('0044 20 7946 0958')).toBe('442079460958');
    expect(normaliseWhatsAppNumber('12345')).toBeNull();
    expect(normaliseWhatsAppNumber('not a number')).toBeNull();
  });

  it('builds a wa.me link with an encoded message', () => {
    expect(buildWhatsAppUrl('9876543210', 'Hi & hello')).toBe(
      'https://wa.me/919876543210?text=Hi%20%26%20hello',
    );
    expect(buildWhatsAppUrl('nope')).toBeNull();
  });

  it('builds platform directions links with a universal fallback', () => {
    const target = { lat: 15.4909, lng: 73.8278, name: 'Café A' };
    expect(buildDirectionsUrls(target, 'ios').primary).toBe(
      'http://maps.apple.com/?daddr=15.490900,73.827800&q=Caf%C3%A9%20A',
    );
    expect(buildDirectionsUrls(target, 'android').primary).toBe(
      'geo:0,0?q=15.490900,73.827800(Caf%C3%A9%20A)',
    );
    expect(buildDirectionsUrls(target, 'android').fallback).toContain(
      'destination=15.490900,73.827800',
    );
  });

  it('share text works without any web page for the place', () => {
    const text = buildShareMessage({
      name: 'Old Fort',
      locality: 'Reis Magos',
      short_description: 'River views.',
      lat: 15.5,
      lng: 73.8,
    });
    expect(text.split('\n')).toEqual([
      'Old Fort, Reis Magos (Goa)',
      'River views.',
      'Map: https://www.google.com/maps/search/?api=1&query=15.500000,73.800000',
      'Found on Gupit Goa',
    ]);
    expect(
      buildShareMessage({
        name: 'X',
        locality: null,
        short_description: null,
        lat: 15.5,
        lng: 73.8,
      }).split('\n'),
    ).toHaveLength(3);
  });
});

describe('filters', () => {
  it('serialises only active groups, sorted for stable cache keys', () => {
    expect(toRpcFilters(EMPTY_FILTERS)).toEqual({});
    expect(
      toRpcFilters({
        ...EMPTY_FILTERS,
        categorySlugs: ['fort', 'cafe'],
        regions: ['south'],
        partnerOnly: true,
        radiusKm: 5,
      }),
    ).toEqual({ category_slugs: ['cafe', 'fort'], regions: ['south'], partner_only: true });
  });

  it('counts and toggles', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(
      countActiveFilters({ ...EMPTY_FILTERS, labels: ['iconic', 'popular'], radiusKm: 10 }),
    ).toBe(3);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('drops unknown or malformed values from stored filters', () => {
    expect(
      parseFilters({
        regions: ['north', 'mars'],
        labels: 'iconic',
        crowd: ['busy', 'busy'],
        categorySlugs: ['cafe', 'DROP TABLE'],
        radiusKm: 5000,
        partnerOnly: 'yes',
      }),
    ).toEqual({ ...EMPTY_FILTERS, regions: ['north'], crowd: ['busy'], categorySlugs: ['cafe'] });
    expect(parseFilters(null)).toEqual(EMPTY_FILTERS);
  });
});

describe('geo', () => {
  it('measures and formats distance', () => {
    const d = haversineMetres(
      { lat: 15.4909, lng: 73.8278 },
      { lat: 15.4909 + 300 / 111_200, lng: 73.8278 },
    );
    expect(d).toBeGreaterThan(295);
    expect(d).toBeLessThan(305);
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(446)).toBe('450 m');
    expect(formatDistance(2340)).toBe('2.3 km');
    expect(formatDistance(18400)).toBe('18 km');
    expect(formatDistance(null)).toBeNull();
  });

  it('knows roughly where Goa is', () => {
    expect(isWithinGoa({ lat: 15.49, lng: 73.82 })).toBe(true);
    expect(isWithinGoa({ lat: 19.07, lng: 72.87 })).toBe(false);
    expect(isWithinGoa({ lat: Number.NaN, lng: 73 })).toBe(false);
  });
});

describe('schemas', () => {
  it('rejects a card with a fabricated crowd level', () => {
    const card = {
      id: '1',
      slug: 's',
      name: 'n',
      category_slug: 'cafe',
      category_label: 'Café',
      group_slug: 'eat-drink',
      locality: null,
      region: 'north',
      discovery_labels: [],
      lat: 15.5,
      lng: 73.8,
      thumb_path: null,
      is_partner: false,
      partner_label: null,
      crowd_status: null,
      crowd_level: null,
      distance_m: null,
      needs_recheck: false,
      temporarily_unavailable: false,
      last_verified_at: null,
    };
    expect(spotCardSchema.safeParse(card).success).toBe(true);
    expect(spotCardSchema.safeParse({ ...card, crowd_level: 7 }).success).toBe(false);
  });

  it('extraction keeps unsupported facts as null rather than accepting empty strings', () => {
    const base = {
      name: 'Casa Azul',
      aliases: [],
      category_slug: 'cafe',
      secondary_category_slugs: [],
      locality: 'Assagao',
      region: 'north',
      address_text: null,
      stated_lat: null,
      stated_lng: null,
      description_draft: null,
      best_time: null,
      visit_duration: null,
      price_band: null,
      access_notes: null,
      parking_info: null,
      opening_hours_text: null,
      contact_phone: null,
      website_url: null,
      crowd_notes: null,
      safety_notes: null,
      respect_notes: null,
      positioning: [],
      positioning_reason: null,
      risk_notes: [],
      evidence_excerpt: null,
      claims_supported: [],
    };
    expect(extractedCandidateSchema.safeParse(base).success).toBe(true);
    expect(extractedCandidateSchema.safeParse({ ...base, opening_hours_text: '' }).success).toBe(
      false,
    );
    expect(extractedCandidateSchema.safeParse({ ...base, region: 'west' }).success).toBe(false);
    expect(extractedCandidateSchema.safeParse({ ...base, stated_lat: 200 }).success).toBe(false);
  });
});
