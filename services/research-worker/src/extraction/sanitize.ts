import { extractedCandidateSchema, isWithinGoa, type ExtractedCandidate } from '@gupit/shared';

export interface SanitizeResult {
  candidates: ExtractedCandidate[];
  /** Why items were dropped or altered. Logged so prompt and parser drift is visible. */
  issues: string[];
}

/** Model output sometimes uses "" or "unknown" where it should use null. Normalise before validating. */
function nullifyBlanks(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ||
      /^(unknown|n\/a|none|null|not (stated|mentioned|available))$/i.test(trimmed)
      ? null
      : trimmed;
  }
  if (Array.isArray(value)) return value.map(nullifyBlanks).filter((v) => v !== null);
  return value;
}

/**
 * Validates untrusted extractor output one candidate at a time. Anything that fails the
 * schema is dropped rather than repaired, unknown category slugs become null, and
 * coordinates that are missing a half or fall outside Goa are removed.
 */
export function sanitizeExtraction(
  raw: unknown,
  allowedCategorySlugs: readonly string[],
): SanitizeResult {
  const issues: string[] = [];
  const list = (raw as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return { candidates: [], issues: ['output_has_no_candidates_array'] };

  const candidates: ExtractedCandidate[] = [];
  for (const [index, item] of list.slice(0, 25).entries()) {
    if (typeof item !== 'object' || item === null) {
      issues.push(`candidate_${index}_not_an_object`);
      continue;
    }
    const cleaned = Object.fromEntries(
      Object.entries(item).map(([key, value]) => [key, nullifyBlanks(value)]),
    );
    const parsed = extractedCandidateSchema.safeParse(cleaned);
    if (!parsed.success) {
      issues.push(
        `candidate_${index}_invalid:${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}`,
      );
      continue;
    }
    const candidate = { ...parsed.data };
    if (candidate.category_slug && !allowedCategorySlugs.includes(candidate.category_slug)) {
      issues.push(`candidate_${index}_unknown_category:${candidate.category_slug}`);
      candidate.category_slug = null;
    }
    candidate.secondary_category_slugs = candidate.secondary_category_slugs.filter((slug) =>
      allowedCategorySlugs.includes(slug),
    );
    const hasBoth = candidate.stated_lat != null && candidate.stated_lng != null;
    if (!hasBoth || !isWithinGoa({ lat: candidate.stated_lat!, lng: candidate.stated_lng! })) {
      if (candidate.stated_lat != null || candidate.stated_lng != null)
        issues.push(`candidate_${index}_coordinates_discarded`);
      candidate.stated_lat = null;
      candidate.stated_lng = null;
    }
    if (candidate.website_url && !/^https?:\/\//i.test(candidate.website_url))
      candidate.website_url = null;
    candidates.push(candidate);
  }
  return { candidates, issues };
}
