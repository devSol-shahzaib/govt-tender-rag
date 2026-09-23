import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig, resetConfig } from './config/env.js';

/**
 * Compatibility check required by the F001 spec.
 *
 * D013 picked Express 5 ahead of the Express 4 proven in the portfolio project.
 * helmet, cors and pino-http are all middleware written against Express's API, so
 * this asserts each one is actually running rather than silently no-opping on the
 * new major. A route returning 200 proves far less than it looks.
 */
const CLIENT_ORIGIN = 'http://localhost:3000';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  resetConfig();
  loadConfig({ CLIENT_ORIGIN });
  app = createApp();
});

describe('Express 5 middleware stack', () => {
  it('runs helmet, so security headers are set', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toBeTruthy();
  });

  it('runs pino-http, so every response carries a request id', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('runs cors, allowing the configured client origin with credentials', async () => {
    const response = await request(app).get('/api/health').set('Origin', CLIENT_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(CLIENT_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers a preflight, which is what every cross-origin call sends first', async () => {
    const response = await request(app)
      .options('/api/health')
      .set('Origin', CLIENT_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(CLIENT_ORIGIN);
  });

  it('never echoes a foreign origin back as allowed', async () => {
    const foreign = 'https://not-our-client.example';
    const response = await request(app).get('/api/health').set('Origin', foreign);

    // cors configured with a string origin always emits that fixed value rather than
    // reflecting the caller's, so the header is present here. What matters is that it
    // is not the foreign origin: the browser compares the two and blocks a mismatch.
    // A config that reflected the request origin would defeat CORS entirely.
    expect(response.headers['access-control-allow-origin']).not.toBe(foreign);
    expect(response.headers['access-control-allow-origin']).toBe(CLIENT_ORIGIN);
  });
});
