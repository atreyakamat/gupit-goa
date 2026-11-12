import type { ConfidenceBreakdown } from '@gupit/shared';

/** Weights from the spec (section 7.5). They sum to 100. */
export const WEIGHTS = {
  source_quality: 25,
  corroboration: 20,
  identity: 10,
  location: 20,
  recency: 15,
  safety_access: 10,
} as const;

export interface ScoreInput {
  /** Best source quality among the evidence, 1 (weak lead) to 5 (official or authority). */
  bestSourceQuality: number;
  /** Distinct publishers (hosts) that mention the place. */
  independentSources: number;
  hasCategory: boolean;
  hasLocality: boolean;
  location: { kind: 'stated' } | { kind: 'geocoded'; confidence: number } | { kind: 'none' };
  /** ISO date of the newest evidence, if any page stated one. */
  newestEvidenceDate: string | null;
  hasAccessNotes: boolean;
  hasSafetyNotes: boolean;
  now?: Date;
}

/**
 * A readiness score for ordering the review queue. It is explainable (every dimension is
 * stored with a note) and it never publishes anything: a blocked flag overrides any score.
 */
export function scoreCandidate(input: ScoreInput): {
  total: number;
  breakdown: ConfidenceBreakdown;
} {
  const notes: string[] = [];
  const quality = Math.min(Math.max(input.bestSourceQuality, 1), 5);
  const source_quality = Math.round((quality / 5) * WEIGHTS.source_quality);
  notes.push(`Best source quality ${quality}/5.`);

  const corroboration =
    input.independentSources >= 3 ? WEIGHTS.corroboration : input.independentSources === 2 ? 14 : 4;
  notes.push(
    input.independentSources >= 2
      ? `${input.independentSources} independent publishers mention it.`
      : 'Only one publisher so far: needs a second source.',
  );

  const identity = (input.hasCategory ? 6 : 0) + (input.hasLocality ? 4 : 0);
  if (!input.hasCategory) notes.push('Category not established.');
  if (!input.hasLocality) notes.push('Locality not established.');

  let location = 0;
  if (input.location.kind === 'stated') {
    location = 16;
    notes.push('Coordinates stated by a source (still to be checked on a map).');
  } else if (input.location.kind === 'geocoded') {
    location = Math.round(Math.min(Math.max(input.location.confidence, 0), 1) * 14);
    notes.push(`Geocoded with confidence ${Math.round(input.location.confidence * 100)}%.`);
  } else {
    notes.push('No coordinates: a reviewer must place the pin.');
  }

  let recency = 5;
  if (input.newestEvidenceDate) {
    const ageDays =
      ((input.now ?? new Date()).getTime() - Date.parse(input.newestEvidenceDate)) / 86_400_000;
    recency = ageDays <= 365 ? WEIGHTS.recency : ageDays <= 730 ? 9 : 3;
    notes.push(
      ageDays <= 365
        ? 'Evidence from the last 12 months.'
        : ageDays <= 730
          ? 'Evidence is 1 to 2 years old.'
          : 'Evidence is over 2 years old.',
    );
  } else {
    notes.push('No publication date on the evidence.');
  }

  const safety_access = (input.hasAccessNotes ? 5 : 0) + (input.hasSafetyNotes ? 5 : 0);
  if (!input.hasAccessNotes) notes.push('No access information in the sources.');

  const total = source_quality + corroboration + identity + location + recency + safety_access;
  return {
    total,
    breakdown: { source_quality, corroboration, identity, location, recency, safety_access, notes },
  };
}
