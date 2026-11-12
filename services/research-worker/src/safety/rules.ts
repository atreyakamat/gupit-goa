import type { ExtractedCandidate, RiskFlag } from '@gupit/shared';

interface DeterministicRule {
  code: string;
  severity: 'block' | 'warn';
  pattern: RegExp;
  note: string;
}

/**
 * Deterministic screens for places that should not be promoted (spec 6.4). A match adds a
 * flag that blocks approval until a human reviewer resolves it with a written note.
 * The model cannot remove or downgrade these flags; it can only add warnings of its own.
 */
export const DETERMINISTIC_RULES: readonly DeterministicRule[] = [
  {
    code: 'sensitive_ecology',
    severity: 'block',
    pattern:
      /turtle (nesting|hatch)|olive ridley|nesting (site|beach|ground)|hatchery|protected habitat|eco[- ]?sensitive|wildlife sanctuary core|breeding ground/i,
    note: 'Mentions a nesting site or protected habitat.',
  },
  {
    code: 'private_property',
    severity: 'block',
    pattern:
      /private (property|land|estate|beach|villa|residence)|trespass|jump(ing)? (the|a|over) (fence|gate|wall)|someone'?s (house|home|backyard)|residential (lane|colony|compound)|no entry sign/i,
    note: 'Suggests private property or unauthorised access.',
  },
  {
    code: 'restricted_access',
    severity: 'block',
    pattern:
      /restricted (area|zone|access)|prohibited area|naval (area|base|land)|defen[cs]e land|army (area|land)|entry (is )?(banned|prohibited|not allowed)|closed to (the )?public|forest department (permission|permit)/i,
    note: 'Suggests a restricted or permit-only area.',
  },
  {
    code: 'unsafe_access',
    severity: 'block',
    pattern:
      /cliff[- ]?jump|dangerous (path|trek|climb|route|swim|current)|drown(ed|ing)s?|people have died|fatal|abandoned (quarry|mine)|quarry (lake|swim)|no (proper )?(path|trail|road) to|risk(y)? (descent|climb)|undertow|rip ?current/i,
    note: 'Mentions dangerous access or water.',
  },
  {
    code: 'community_objection',
    severity: 'block',
    pattern:
      /locals? (do not|don'?t|doesn'?t) want|villagers? (object|oppose|protest|banned)|asked (tourists|visitors) (not to|to stay away)|keep (it|this) (a )?secret|don'?t tell anyone|gatekeep/i,
    note: 'Suggests residents do not want this place promoted, or it is presented as a secret.',
  },
  {
    code: 'seasonal_hazard',
    severity: 'warn',
    pattern:
      /closed (during|in) (the )?monsoon|monsoon (closure|ban)|only accessible (in|during)|low tide only|high tide/i,
    note: 'Seasonal or tide-dependent access.',
  },
];

/** Categories where a visit or an authority source is required before publishing. */
export const STRICT_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  'beach',
  'beach-access',
  'coastal-viewpoint',
  'waterfall',
  'trail',
  'viewpoint',
  'spring',
  'riverfront',
  'island-boat-access',
  'nature-reserve',
  'water-sports',
  'boat-trip',
  'adventure-activity',
]);

/**
 * Builds the risk flags for a candidate from (a) deterministic patterns over everything the
 * extractor returned plus the page context, and (b) the model's own risk notes as warnings.
 */
export function screenCandidate(candidate: ExtractedCandidate, pageContext: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const haystack = [
    candidate.name,
    candidate.description_draft,
    candidate.access_notes,
    candidate.safety_notes,
    candidate.respect_notes,
    candidate.crowd_notes,
    candidate.positioning_reason,
    ...candidate.risk_notes,
    excerptAround(pageContext, candidate.name),
  ]
    .filter(Boolean)
    .join('\n');

  for (const rule of DETERMINISTIC_RULES) {
    const match = rule.pattern.exec(haystack);
    if (match)
      flags.push({
        code: rule.code,
        severity: rule.severity,
        source: 'deterministic',
        note: `${rule.note} Matched: "${match[0]}".`,
      });
  }

  for (const note of candidate.risk_notes) {
    flags.push({ code: 'model_risk_note', severity: 'warn', source: 'llm', note });
  }

  if (candidate.category_slug && STRICT_CATEGORY_SLUGS.has(candidate.category_slug)) {
    flags.push({
      code: 'needs_visit_or_authority',
      severity: 'warn',
      source: 'deterministic',
      note: 'Nature, water or trail place: publish only after a team visit or an authority source plus a second check.',
    });
  }
  return flags;
}

/** The text near each mention of the place, so one risky sentence elsewhere on a list page does not flag everything. */
export function excerptAround(text: string, name: string, radius = 400): string {
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < 3; i += 1) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    parts.push(text.slice(Math.max(0, at - radius), at + needle.length + radius));
    from = at + needle.length;
  }
  return parts.join('\n');
}

export const hasBlockingFlag = (flags: RiskFlag[]) =>
  flags.some((f) => f.severity === 'block' && !f.resolved_at);
