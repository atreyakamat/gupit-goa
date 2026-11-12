/**
 * Structured logging with a pluggable crash reporter.
 *
 * DEVELOPMENT STUB: no crash-reporting provider is wired up yet (it needs an account and
 * a DSN). Until `setCrashReporter` is called, errors only go to the device console.
 * Payloads must stay privacy-safe: never pass coordinates, tokens or message text.
 */
export interface CrashReporter {
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
}

let reporter: CrashReporter | null = null;

export function setCrashReporter(next: CrashReporter | null): void {
  reporter = next;
}

type Context = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE = /lat|lng|coord|token|password|secret|message/i;

function scrub(context: Context | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value == null || SENSITIVE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export const logger = {
  info(event: string, context?: Context): void {
    if (__DEV__) console.log(`[info] ${event}`, scrub(context));
  },
  warn(event: string, context?: Context): void {
    console.warn(`[warn] ${event}`, scrub(context));
  },
  error(event: string, error: unknown, context?: Context): void {
    const safe = scrub(context);
    console.error(`[error] ${event}`, error instanceof Error ? error.message : String(error), safe);
    reporter?.captureException(error, { event, ...safe });
  },
};
