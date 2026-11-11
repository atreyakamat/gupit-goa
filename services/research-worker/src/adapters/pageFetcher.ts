import * as cheerio from 'cheerio';
import { classifyUrl, hostOf } from '../policy/domains';
import { isAllowedByRobots } from '../policy/robots';
import type { DomainRule, FetchedPage, FetchOutcome, PageFetcher } from '../types';

const MAX_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;

/** Turns HTML into the visible text plus a little metadata. Pure, so it is unit-tested. */
export function extractPage(url: string, html: string): FetchedPage {
  const $ = cheerio.load(html);
  const meta = (selector: string) => $(selector).attr('content')?.trim() || null;
  $('script, style, noscript, svg, iframe, nav, footer, header, form, aside').remove();
  const root = $('article').first().length
    ? $('article').first()
    : $('main').first().length
      ? $('main').first()
      : $('body');
  const text = root
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  const published =
    meta('meta[property="article:published_time"]') ??
    $('time[datetime]').first().attr('datetime') ??
    null;
  return {
    url,
    host: hostOf(url) ?? '',
    title: meta('meta[property="og:title"]') ?? ($('title').first().text().trim() || null),
    siteName: meta('meta[property="og:site_name"]'),
    author: meta('meta[name="author"]'),
    publishedAt: published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null,
    text,
  };
}

export interface FetcherOptions {
  userAgent: string;
  getDomainRules: () => Readonly<Record<string, DomainRule>>;
  fetchImpl?: typeof fetch;
  minDelayPerHostMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * The only component that requests third-party pages. It:
 *   - refuses blocked and lead-only domains before any network call,
 *   - obeys robots.txt,
 *   - sends no cookies or credentials and never follows a login wall,
 *   - identifies itself honestly and spaces out requests per host,
 *   - treats 401/403/429 as "access restricted" and stops, with no retry tricks.
 */
export function createPageFetcher(options: FetcherOptions): PageFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const minDelay = options.minDelayPerHostMs ?? 2500;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const robotsCache = new Map<string, string | null>();
  const lastRequestAt = new Map<string, number>();

  async function politeFetch(url: string, host: string): Promise<Response> {
    const wait = (lastRequestAt.get(host) ?? 0) + minDelay - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, now());
    return fetchImpl(url, {
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': options.userAgent, accept: 'text/html,application/xhtml+xml' },
    });
  }

  async function robotsFor(origin: string, host: string): Promise<string | null> {
    if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
    let body: string | null = null;
    try {
      const response = await politeFetch(`${origin}/robots.txt`, host);
      if (response.ok) body = (await response.text()).slice(0, 200_000);
      // A site that hides robots.txt behind an auth wall is telling us to stay out.
      else if (response.status === 401 || response.status === 403)
        body = 'User-agent: *\nDisallow: /';
    } catch {
      body = null;
    }
    robotsCache.set(origin, body);
    return body;
  }

  return {
    async fetch(url: string): Promise<FetchOutcome> {
      const rule = classifyUrl(url, options.getDomainRules());
      if (rule === 'block') return { ok: false, reason: 'policy_block' };
      if (rule === 'lead_only') return { ok: false, reason: 'lead_only' };

      const parsed = new URL(url);
      const host = hostOf(url)!;
      const robots = await robotsFor(parsed.origin, host);
      if (
        robots &&
        !isAllowedByRobots(robots, parsed.pathname + parsed.search, options.userAgent)
      ) {
        return { ok: false, reason: 'robots_disallow' };
      }

      let response: Response;
      try {
        response = await politeFetch(url, host);
      } catch (error) {
        return { ok: false, reason: 'network_error', detail: String(error) };
      }
      // A redirect may land on a different site: re-check the policy for where we ended up.
      if (response.url && classifyUrl(response.url, options.getDomainRules()) !== 'allow') {
        return { ok: false, reason: 'policy_block', detail: 'redirected to a restricted domain' };
      }
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return { ok: false, reason: 'access_restricted', detail: String(response.status) };
      }
      if (!response.ok) return { ok: false, reason: 'http_error', detail: String(response.status) };
      if (!/text\/html|application\/xhtml/.test(response.headers.get('content-type') ?? '')) {
        return { ok: false, reason: 'not_html' };
      }
      const html = await response.text();
      if (html.length > MAX_BYTES) return { ok: false, reason: 'too_large' };
      return { ok: true, page: extractPage(response.url || url, html) };
    },
  };
}
