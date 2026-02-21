import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app';
import { createInMemoryRepository } from './helpers/inMemoryRepository';
import { signFakepayPayload } from '../fakepay/signature';
import { config } from '../config';

function expectString(value: unknown, name: string): string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, name: string): number {
  expect(typeof value).toBe('number');
  if (typeof value !== 'number') {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

describe('FakePay webhook', () => {
  it('returns 401 for invalid signature', async () => {
    const app = createApp(createInMemoryRepository());
    const payload = {
      eventId: randomUUID(),
      providerPaymentId: randomUUID(),
      status: 'succeeded',
      amount: 100,
      currency: 'RUB',
      metadata: { orderId: 'order-1' }
    };

    const response = await request(app)
      .post('/api/webhooks/fakepay')
      .set('content-type', 'application/json')
      .set('x-fakepay-signature', 'bad-signature')
      .send(JSON.stringify(payload));

    expect([400, 401]).toContain(response.status);
  });

  it('does not extend subscription twice for the same eventId', async () => {
    const app = createApp(createInMemoryRepository());

    const createOrderResponse = await request(app)
      .post('/api/orders')
      .set('content-type', 'application/json')
      .send({ telegramId: '123', planId: 'plan-30' });

    expect(createOrderResponse.status).toBe(201);
    const orderId = expectString(createOrderResponse.body.orderId, 'orderId');

    const orderResponse = await request(app).get(`/api/orders/${orderId}`);
    expect(orderResponse.status).toBe(200);

    const eventId = randomUUID();
    const payload = {
      eventId,
      providerPaymentId: expectString(orderResponse.body.order.providerPaymentId, 'providerPaymentId'),
      status: 'succeeded',
      amount: expectNumber(orderResponse.body.order.amountCents, 'amountCents'),
      currency: expectString(orderResponse.body.order.currency, 'currency'),
      metadata: { orderId }
    };

    const rawPayload = JSON.stringify(payload);
    const signature = signFakepayPayload(rawPayload, config.fakepayWebhookSecret);

    const first = await request(app)
      .post('/api/webhooks/fakepay')
      .set('content-type', 'application/json')
      .set('x-fakepay-signature', signature)
      .send(rawPayload);

    const second = await request(app)
      .post('/api/webhooks/fakepay')
      .set('content-type', 'application/json')
      .set('x-fakepay-signature', signature)
      .send(rawPayload);

    expect(first.status).toBe(200);
    expect(first.body.idempotent).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);

    const subscription = await request(app).get('/api/subscription?telegramId=123');
    expect(subscription.status).toBe(200);
    expect(subscription.body.status).toBe('active');
    expect(subscription.body.daysLeft).toBeGreaterThanOrEqual(30);
    expect(subscription.body.daysLeft).toBeLessThan(60);
  });
});
