import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';

describe('Error handling', () => {
  const app = createApp();

  it('returns 401 for unauthenticated request to unknown API route', async () => {
    const res = await request(app).get('/api/v1/unknown');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown non-API route', async () => {
    const res = await request(app).get('/totally-unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
});
