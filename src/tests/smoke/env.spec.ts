import { describe, it, expect } from 'vitest';

// Importing env will validate process.env using Zod
import { env } from '../../config/env';

describe('Environment validation', () => {
  it('has required variables with defaults', () => {
    expect(env.NODE_ENV).toBeDefined();
    expect(env.PORT).toBeGreaterThan(0);
    expect(typeof env.DATABASE_URL).toBe('string');
  });
});
