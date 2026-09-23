import { describe, expect, it } from 'vitest';
import { readHealth } from './health';

function respondWith(body: unknown, ok = true, status = 200): typeof fetch {
  return (() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
}

describe('readHealth', () => {
  it('reports the status the server sent', async () => {
    const result = await readHealth(respondWith({ status: 'ok' }));

    expect(result).toEqual({ reachable: true, status: 'ok' });
  });

  it('reports a failing status code rather than claiming the API is healthy', async () => {
    const result = await readHealth(respondWith({}, false, 503));

    expect(result).toEqual({ reachable: false, reason: 'API responded 503' });
  });

  it('does not invent a status when the body is missing one', async () => {
    const result = await readHealth(respondWith({ unexpected: true }));

    expect(result).toEqual({ reachable: false, reason: 'API response had no status field' });
  });

  it('degrades to an honest message when the server is unreachable', async () => {
    const refuses = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;

    // Must not throw: a dead API has to render as a stated failure, never as a crash
    // and never as a healthy server.
    await expect(readHealth(refuses)).resolves.toEqual({
      reachable: false,
      reason: 'API unreachable',
    });
  });
});
