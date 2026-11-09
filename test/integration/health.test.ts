import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';

describe('GET /v1/health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  it('returns ok and the version', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: t.config.appVersion });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('is not rate limited', async () => {
    const small = await buildTestApp({ env: { RATE_LIMIT_MAX: '1' } });
    try {
      for (let i = 0; i < 5; i++) {
        const res = await small.app.inject({ method: 'GET', url: '/v1/health' });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await small.close();
    }
  });
});
