import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig, resetConfig } from '../../config/env.js';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  resetConfig();
  loadConfig({ CLIENT_ORIGIN: 'http://localhost:3000' });
  app = createApp();
});

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a request id a user can quote', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an incoming request id so a trace survives the hop from the client', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('x-request-id', 'client-supplied-id');

    expect(response.headers['x-request-id']).toBe('client-supplied-id');
  });
});

describe('unknown routes', () => {
  it('returns the standard error envelope, not an express HTML page', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: 'Route not found' });
  });
});
