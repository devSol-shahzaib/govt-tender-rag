import { describe, expect, it } from 'vitest';
import { isRetryable, withRetry } from './retry.js';

const noWait = { sleep: () => Promise.resolve() };

describe('isRetryable', () => {
  it.each([408, 409, 429, 500, 502, 503])('retries %i', (status) => {
    expect(isRetryable({ statusCode: status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry %i', (status) => {
    // Retrying a rejected key or a malformed request only turns a clear failure into
    // a slow one, and spends quota doing it.
    expect(isRetryable({ statusCode: status })).toBe(false);
  });

  it('retries a network fault, which arrives without a status', () => {
    expect(isRetryable(Object.assign(new Error('fetch failed'), { name: 'TypeError' }))).toBe(true);
  });

  it('does not retry something that is not an error object', () => {
    expect(isRetryable('boom')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns on the first attempt when nothing fails', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), noWait);

    expect(result).toEqual({ value: 'ok', attempts: 1 });
  });

  it('counts the attempt that finally succeeded', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(Object.assign(new Error('429'), { statusCode: 429 }));
        return Promise.resolve('ok');
      },
      { ...noWait, maxAttempts: 5 },
    );

    expect(result).toEqual({ value: 'ok', attempts: 3 });
  });

  it('stops at maxAttempts and rethrows the last error', async () => {
    let calls = 0;
    const attempt = withRetry(
      () => {
        calls += 1;
        return Promise.reject(Object.assign(new Error('still down'), { statusCode: 503 }));
      },
      { ...noWait, maxAttempts: 3 },
    );

    await expect(attempt).rejects.toThrow('still down');
    expect(calls).toBe(3);
  });

  it('backs off for longer on each attempt', async () => {
    const waits: number[] = [];
    let calls = 0;

    await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(Object.assign(new Error('429'), { statusCode: 429 }));
        return Promise.resolve('ok');
      },
      {
        maxAttempts: 4,
        baseDelayMs: 100,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );

    expect(waits).toHaveLength(2);
    // Jitter is added on top, so assert growth rather than exact values.
    expect(waits[1]).toBeGreaterThan(waits[0] ?? 0);
  });
});
