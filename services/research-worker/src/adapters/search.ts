import type { SearchHit, SearchProvider } from '../types';

export class ProviderError extends Error {
  constructor(
    readonly code: 'quota_exhausted' | 'unauthorized' | 'unavailable' | 'bad_response',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * DEVELOPMENT STUB. Returns no results and makes no network calls. It exists so the
 * pipeline runs end to end without a search account; it never invents places.
 */
export function createStubSearchProvider(): SearchProvider {
  return {
    name: 'stub',
    async search() {
      return [];
    },
  };
}

/** Brave Search API (https://api.search.brave.com). Requires SEARCH_PROVIDER_API_KEY. */
export function createBraveSearchProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): SearchProvider {
  return {
    name: 'brave',
    async search(query, limit) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)));
      url.searchParams.set('country', 'in');
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: 'application/json', 'x-subscription-token': apiKey },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new ProviderError('unavailable', `Search request failed: ${String(error)}`, true);
      }
      if (response.status === 429)
        throw new ProviderError('quota_exhausted', 'Search quota or rate limit reached', true);
      if (response.status === 401 || response.status === 403)
        throw new ProviderError('unauthorized', 'Search API key rejected', false);
      if (!response.ok)
        throw new ProviderError(
          'unavailable',
          `Search returned ${response.status}`,
          response.status >= 500,
        );
      const body = (await response.json()) as {
        web?: { results?: { url?: unknown; title?: unknown; description?: unknown }[] };
      };
      const results = body.web?.results;
      if (!Array.isArray(results)) return [];
      const hits: SearchHit[] = [];
      for (const item of results) {
        if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;
        hits.push({
          url: item.url,
          title: item.title,
          snippet: typeof item.description === 'string' ? item.description : null,
        });
      }
      return hits.slice(0, limit);
    },
  };
}
