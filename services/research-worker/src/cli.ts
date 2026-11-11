import { REGIONS, type Region } from '@gupit/shared';
import { createAnthropicExtractor, createStubExtractor } from './adapters/llm';
import { createPageFetcher } from './adapters/pageFetcher';
import { createBraveSearchProvider, createStubSearchProvider } from './adapters/search';
import { loadEnv, userAgentFor } from './config';
import { planDiscoveryJobs } from './discovery/queryPlanner';
import { createNominatimGeocoder, createNoopGeocoder } from './geocoding/geocoder';
import { runWorker } from './jobs/runner';
import { createSupabaseRepository } from './repository';
import type { DomainRule } from './types';

const HELP = `Gupit Goa research worker

Usage: npm run worker -- <command> [options]

  plan [--region north|central|south|inland] [--limit N] [--dry-run]
        Queue this week's discovery searches (idempotent: safe to re-run).
  run [--max-jobs N]
        Process up to N queued jobs, then exit. Schedule this; it does not loop forever.
  help

The worker only creates candidates for human review. It cannot publish a place.`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  if (command === 'plan') {
    const region = option(args, 'region');
    if (region && !(REGIONS as readonly string[]).includes(region))
      throw new Error(`Unknown region: ${region}`);
    const limit = option(args, 'limit');
    const jobs = planDiscoveryJobs({
      regions: region ? [region as Region] : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    if (args.includes('--dry-run')) {
      for (const job of jobs) console.log(`${job.region}\t${job.category_slug}\t${job.query}`);
      console.log(`${jobs.length} jobs (dry run, nothing queued)`);
      return;
    }
    const env = loadEnv();
    const repo = createSupabaseRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    let queued = 0;
    for (let i = 0; i < jobs.length; i += 100)
      queued += await repo.enqueueJobs(jobs.slice(i, i + 100));
    console.log(
      `Planned ${jobs.length} jobs; ${queued} newly queued (the rest were already queued this week).`,
    );
    return;
  }

  if (command === 'run') {
    const env = loadEnv();
    const repo = createSupabaseRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const userAgent = userAgentFor(env);
    let domainRules: Record<string, DomainRule> = (await repo.getConfig()).domainRules;

    if (env.SEARCH_PROVIDER === 'stub' || env.LLM_PROVIDER === 'stub') {
      console.warn(
        'Running with a development stub (search and/or model). No real candidates will be produced.',
      );
    }
    const summary = await runWorker(
      {
        repo: {
          ...repo,
          // Keep the fetcher's domain rules in step with the admin's latest settings.
          getConfig: async () => {
            const config = await repo.getConfig();
            domainRules = config.domainRules;
            return config;
          },
        },
        search:
          env.SEARCH_PROVIDER === 'brave'
            ? createBraveSearchProvider(env.SEARCH_PROVIDER_API_KEY!)
            : createStubSearchProvider(),
        fetcher: createPageFetcher({ userAgent, getDomainRules: () => domainRules }),
        extractor:
          env.LLM_PROVIDER === 'anthropic'
            ? createAnthropicExtractor({ apiKey: env.LLM_PROVIDER_API_KEY!, model: env.LLM_MODEL! })
            : createStubExtractor(),
        geocoder:
          env.GEOCODER === 'nominatim'
            ? createNominatimGeocoder({
                baseUrl: env.GEOCODER_BASE_URL,
                userAgent,
                apiKey: env.GEOCODER_API_KEY,
              })
            : createNoopGeocoder(),
        maxPagesPerJob: env.MAX_PAGES_PER_JOB,
      },
      {
        workerId: env.WORKER_ID,
        maxJobs: Number(option(args, 'max-jobs') ?? env.MAX_JOBS_PER_RUN),
      },
    );
    console.log(
      `Done. completed=${summary.completed} retried=${summary.retried} failed=${summary.failed}`,
    );
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
