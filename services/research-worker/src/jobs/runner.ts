import { ProviderError } from '../adapters/search';
import type { Repository } from '../types';
import { processDiscoveryJob, type PipelineDeps } from './processDiscovery';

/** 5, 10, 20, 40 minutes ... capped at 6 hours. */
export function backoffSeconds(attempt: number): number {
  return Math.min(300 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60);
}

export interface RunOptions {
  workerId: string;
  maxJobs: number;
}

export interface RunSummary {
  completed: number;
  failed: number;
  retried: number;
}

/**
 * Processes a bounded number of queued jobs, then stops. There is no open-ended crawl.
 * Adapter kill switches are honoured twice: the database will not hand out a disabled
 * adapter's jobs, and the config is re-read before every job.
 */
export async function runWorker(deps: PipelineDeps, options: RunOptions): Promise<RunSummary> {
  const repo: Repository = deps.repo;
  const summary: RunSummary = { completed: 0, failed: 0, retried: 0 };
  await repo.heartbeat(options.workerId, 'running', { max_jobs: options.maxJobs });

  for (let i = 0; i < options.maxJobs; i += 1) {
    const config = await repo.getConfig();
    const job = await repo.claimJob(options.workerId);
    if (!job) break;

    try {
      if (config.adapters[job.source_adapter] === false) {
        await repo.finishJob(job.id, { ok: false, errorCode: 'adapter_disabled' });
        summary.failed += 1;
        continue;
      }
      if (job.job_type !== 'discovery') {
        await repo.logEvent(job.id, 'warn', 'unsupported_job_type', job.job_type);
        await repo.finishJob(job.id, { ok: false, errorCode: 'unsupported_job_type' });
        summary.failed += 1;
        continue;
      }
      const cost = await processDiscoveryJob(job, deps, config);
      await repo.finishJob(job.id, { ok: true, cost });
      summary.completed += 1;
    } catch (error) {
      const provider = error instanceof ProviderError ? error : null;
      const code = provider ? `provider_${provider.code}` : 'internal_error';
      const retryable = provider ? provider.retryable : true;
      const willRetry = retryable && job.attempt_count < job.max_attempts;
      await repo.logEvent(
        job.id,
        'error',
        code,
        error instanceof Error ? error.message : String(error),
        { attempt: job.attempt_count, will_retry: willRetry },
      );
      await repo.finishJob(job.id, {
        ok: false,
        errorCode: code,
        retryInSeconds: retryable ? backoffSeconds(job.attempt_count) : undefined,
      });
      if (willRetry) summary.retried += 1;
      else summary.failed += 1;
      // Quota and auth problems affect every job: stop this run instead of burning attempts.
      if (provider && (provider.code === 'quota_exhausted' || provider.code === 'unauthorized'))
        break;
    }
  }

  await repo.heartbeat(options.workerId, 'idle', { ...summary });
  return summary;
}
