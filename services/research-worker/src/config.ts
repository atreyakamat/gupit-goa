import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SEARCH_PROVIDER: z.enum(['stub', 'brave']).default('stub'),
  SEARCH_PROVIDER_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['stub', 'anthropic']).default('stub'),
  LLM_PROVIDER_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  GEOCODER: z.enum(['none', 'nominatim']).default('none'),
  GEOCODER_BASE_URL: z.url().default('https://nominatim.openstreetmap.org'),
  GEOCODER_API_KEY: z.string().optional(),
  /** Sent as the User-Agent. Must say who is fetching and how to reach them. */
  RESEARCH_CONTACT: z.string().min(5),
  WORKER_ID: z.string().default('research-worker-1'),
  MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(10).default(4),
  MAX_JOBS_PER_RUN: z.coerce.number().int().min(1).max(50).default(5),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Research worker environment is not valid. ${problems}`);
  }
  const env = parsed.data;
  if (env.SEARCH_PROVIDER !== 'stub' && !env.SEARCH_PROVIDER_API_KEY)
    throw new Error('SEARCH_PROVIDER_API_KEY is required for this search provider.');
  if (env.LLM_PROVIDER !== 'stub' && (!env.LLM_PROVIDER_API_KEY || !env.LLM_MODEL))
    throw new Error('LLM_PROVIDER_API_KEY and LLM_MODEL are required for this model provider.');
  return env;
}

export const userAgentFor = (env: Pick<Env, 'RESEARCH_CONTACT'>) =>
  `GupitGoaResearch/0.1 (+${env.RESEARCH_CONTACT})`;
