import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createInMemoryRepository } from './helpers/inMemoryRepository';

describe('health', () => {
  it('GET /health returns ok', async () => {
    const app = createApp(createInMemoryRepository());
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.text).toBe('ok');
  });
});
