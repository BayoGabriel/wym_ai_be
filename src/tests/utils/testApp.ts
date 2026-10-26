import request from 'supertest';
import createApp from '../../app';

export function makeAgent() {
  const app = createApp();
  return request(app);
}
