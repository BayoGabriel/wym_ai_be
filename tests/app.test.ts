import request from 'supertest';
import { createApp } from '../src/app';
import { describe, it, expect } from 'vitest';

describe('App initialization', () => {
  const app = createApp();

  it('responds on root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'WymNet AI Backend');
  });
});
