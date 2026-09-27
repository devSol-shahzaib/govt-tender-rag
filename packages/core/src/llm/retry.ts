/**
 * Retries on failures that a later attempt could plausibly survive.
 *
 * Rate limits and transient server errors are worth retrying. A malformed request or
 * a rejected key is not: retrying those burns quota and turns a clear error into a
 * slow one.
 */
export function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { statusCode?: unknown; status?: unknown; name?: unknown };
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : candidate.status;

  if (typeof status === 'number') {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  // Network faults surface without a status.
  return candidate.name === 'TypeError' || candidate.name === 'AbortError';
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  /** Injected in tests so they do not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === maxAttempts) break;

      // Exponential backoff with jitter, so a burst of failures does not retry in
      // lockstep and reproduce the rate limit that caused it.
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      await sleep(backoff + Math.random() * baseDelayMs);
    }
  }

  throw lastError;
}
