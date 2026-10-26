import request from 'supertest';
import createApp from '../../src/app';

export function makeAgent() {
  const app = createApp();
  return request(app);
}
