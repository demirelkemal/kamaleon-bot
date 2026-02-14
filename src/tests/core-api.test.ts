import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createInMemoryRepository } from './helpers/inMemoryRepository';

describe('Core API', () => {
  it('GET /api/plans returns active plans', async () => {
    const app = createApp(createInMemoryRepository());
    const response = await request(app).get('/api/plans');

    expect(response.status).toBe(200);
    expect(response.body.plans).toHaveLength(3);
  });

  it('POST /api/users/telegram upserts user', async () => {
    const app = createApp(createInMemoryRepository());

    const response = await request(app)
      .post('/api/users/telegram')
      .send({ telegramId: '123' })
      .set('content-type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.user.telegramId).toBe('123');
  });

  it('GET /api/subscription returns expired without subscription', async () => {
    const app = createApp(createInMemoryRepository());

    const response = await request(app).get('/api/subscription?telegramId=123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'expired', daysLeft: 0, expiresAt: null, planId: null, planTitle: null });
  });
});
