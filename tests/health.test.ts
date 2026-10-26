import request from 'supertest';
import { createApp } from '../src/app';
import { describe, it, expect } from 'vitest';

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('returns ok status', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(['up', 'down']).toContain(res.body.db);
  });
});
