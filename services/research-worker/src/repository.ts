import { createClient } from '@supabase/supabase-js';
import type { CandidateUpsert, PlannedJob, Repository, ResearchJob, WorkerConfig } from './types';

/**
 * Supabase-backed repository. It uses the service-role key, which must only ever exist in
 * this server process's environment. Every call goes through a `worker_*` RPC; none of them
 * can create or publish a spot.
 */
export function createSupabaseRepository(url: string, serviceRoleKey: string): Repository {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name} failed: ${error.message}`);
    return data as T;
  }

  return {
    async getConfig(): Promise<WorkerConfig> {
      const raw = await rpc<{
        adapters: Record<string, boolean>;
        domain_rules: WorkerConfig['domainRules'];
        category_slugs: string[];
      }>('worker_get_config');
      return {
        adapters: raw.adapters,
        domainRules: raw.domain_rules,
        categorySlugs: raw.category_slugs,
      };
    },
    enqueueJobs: (jobs: PlannedJob[]) => rpc<number>('worker_enqueue_jobs', { p_jobs: jobs }),
    claimJob: (workerId) => rpc<ResearchJob | null>('worker_claim_job', { p_worker_id: workerId }),
    async finishJob(jobId, result) {
      await rpc('worker_finish_job', {
        p_job_id: jobId,
        p_ok: result.ok,
        p_error_code: result.errorCode ?? null,
        p_cost: result.cost ?? null,
        p_retry_in_seconds: result.retryInSeconds ?? null,
      });
    },
    async upsertCandidate(candidate: CandidateUpsert) {
      const result = await rpc<{ id: string; was_new: boolean; closed: boolean }>(
        'worker_upsert_candidate',
        { p_data: candidate },
      );
      return { id: result.id, wasNew: result.was_new, closed: result.closed };
    },
    async logEvent(jobId, level, code, message, details) {
      await rpc('worker_log_event', {
        p_job_id: jobId,
        p_level: level,
        p_code: code,
        p_message: message ?? null,
        p_details: details ?? {},
      });
    },
    async heartbeat(workerId, status, details) {
      await rpc('worker_heartbeat', {
        p_worker_id: workerId,
        p_status: status,
        p_details: details ?? {},
      });
    },
  };
}
