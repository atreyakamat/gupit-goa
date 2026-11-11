import type { Region } from '@gupit/shared';
import type { PlannedJob } from '../types';

/**
 * Query matrix: every region and locality against every category group, with both
 * "popular" and "lesser-known" phrasings. Popular and iconic coverage is a first-class
 * goal, so the planner never searches only for hidden gems.
 */
export const LOCALITIES: Record<Region, string[]> = {
  north: [
    'Anjuna',
    'Assagao',
    'Vagator',
    'Siolim',
    'Morjim',
    'Mandrem',
    'Arambol',
    'Calangute',
    'Candolim',
    'Baga',
    'Mapusa',
    'Aldona',
  ],
  central: [
    'Panaji',
    'Fontainhas',
    'Miramar',
    'Dona Paula',
    'Old Goa',
    'Porvorim',
    'Ribandar',
    'Divar',
  ],
  south: [
    'Margao',
    'Colva',
    'Benaulim',
    'Varca',
    'Cavelossim',
    'Palolem',
    'Agonda',
    'Canacona',
    'Bogmalo',
    'Loutolim',
  ],
  inland: ['Ponda', 'Mollem', 'Netravali', 'Sanguem', 'Bicholim', 'Valpoi', 'Chorla', 'Quepem'],
};

export const REGION_PHRASE: Record<Region, string> = {
  north: 'North Goa',
  central: 'Panaji Goa',
  south: 'South Goa',
  inland: 'inland Goa',
};

interface Topic {
  categorySlug: string;
  /** Used with a locality: "<term> in <locality> Goa". */
  localTerms: string[];
  /** Used with a region: the placeholder {region} is replaced. */
  regionTemplates: string[];
  /** Topics that are mostly a region-level question (few per locality). */
  regionOnly?: boolean;
}

export const TOPICS: Topic[] = [
  {
    categorySlug: 'cafe',
    localTerms: ['cafes', 'quiet cafes'],
    regionTemplates: ['best cafes in {region}', 'lesser known cafes in {region}'],
  },
  {
    categorySlug: 'restaurant',
    localTerms: ['restaurants', 'local Goan food'],
    regionTemplates: ['popular restaurants in {region}', 'beach shacks in {region}'],
  },
  {
    categorySlug: 'bar',
    localTerms: ['bars and pubs'],
    regionTemplates: ['bars and pubs in {region}', 'breweries and taprooms in {region}'],
  },
  {
    categorySlug: 'nightclub',
    localTerms: ['nightclubs'],
    regionTemplates: ['nightclubs in {region}'],
    regionOnly: true,
  },
  {
    categorySlug: 'beach',
    localTerms: ['beaches near'],
    regionTemplates: ['popular beaches in {region}', 'quiet beaches {region} public access'],
  },
  {
    categorySlug: 'sunset-point',
    localTerms: ['sunset points near'],
    regionTemplates: ['sunset points and viewpoints in {region}'],
    regionOnly: true,
  },
  {
    categorySlug: 'fort',
    localTerms: ['forts and heritage near'],
    regionTemplates: ['forts and heritage places in {region}', 'museums and galleries in {region}'],
    regionOnly: true,
  },
  {
    categorySlug: 'waterfall',
    localTerms: ['waterfalls near'],
    regionTemplates: ['waterfalls and trails in {region} safe access'],
    regionOnly: true,
  },
  {
    categorySlug: 'market',
    localTerms: ['markets'],
    regionTemplates: ['markets and local experiences in {region}'],
    regionOnly: true,
  },
  {
    categorySlug: 'guided-tour',
    localTerms: ['things to do'],
    regionTemplates: ['family activities in {region}', 'tours and experiences in {region}'],
    regionOnly: true,
  },
];

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const keyOf = (query: string, period: string) =>
  `discovery:${query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}:${period}`;

export interface PlanOptions {
  regions?: Region[];
  categorySlugs?: string[];
  /** Period token inside the idempotency key. The same query is queued at most once per period. */
  now?: Date;
  limit?: number;
}

/**
 * Deterministic and bounded. Re-running in the same ISO week produces identical
 * idempotency keys, so nothing is queued twice.
 */
export function planDiscoveryJobs(options: PlanOptions = {}): PlannedJob[] {
  const period = isoWeek(options.now ?? new Date());
  const regions = options.regions ?? (Object.keys(LOCALITIES) as Region[]);
  const topics = TOPICS.filter(
    (t) => !options.categorySlugs || options.categorySlugs.includes(t.categorySlug),
  );
  const jobs = new Map<string, PlannedJob>();

  const add = (query: string, region: Region, categorySlug: string) => {
    const idempotency_key = keyOf(query, period);
    if (!jobs.has(idempotency_key)) {
      jobs.set(idempotency_key, {
        job_type: 'discovery',
        query,
        region,
        category_slug: categorySlug,
        source_adapter: 'web_search',
        idempotency_key,
      });
    }
  };

  for (const region of regions) {
    for (const topic of topics) {
      for (const template of topic.regionTemplates)
        add(template.replace('{region}', REGION_PHRASE[region]), region, topic.categorySlug);
      if (topic.regionOnly) continue;
      for (const locality of LOCALITIES[region]) {
        for (const term of topic.localTerms) {
          add(
            term.endsWith(' near') ? `${term} ${locality} Goa` : `${term} in ${locality} Goa`,
            region,
            topic.categorySlug,
          );
        }
      }
    }
  }
  const all = [...jobs.values()];
  return options.limit ? all.slice(0, options.limit) : all;
}
