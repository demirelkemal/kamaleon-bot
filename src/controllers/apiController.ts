import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../api/errors';
import type { CoreRepository } from '../repositories/coreRepository';
import { CoreApiService } from '../services/coreApiService';

const telegramBodySchema = z.object({
  telegramId: z.coerce.bigint()
});

const subscriptionQuerySchema = z.object({
  telegramId: z.coerce.bigint()
});

const createOrderSchema = z.object({
  telegramId: z.coerce.bigint(),
  planId: z.string().min(1)
});

const renewSchema = z.object({
  telegramId: z.coerce.bigint()
});

const cancelSchema = z.object({
  telegramId: z.coerce.bigint()
});

const fakepayPaymentSchema = z.object({
  orderId: z.string().min(1)
});

export function createApiController(repository: CoreRepository): Router {
  const router = Router();
  const service = new CoreApiService(repository);

  router.get('/plans', async (_req, res, next) => {
    try {
      const plans = await service.getPlans();
      res.status(200).json({ plans });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/telegram', async (req, res, next) => {
    try {
      const payload = telegramBodySchema.parse(req.body);
      const user = await service.upsertTelegramUser(payload.telegramId);
      res.status(200).json({ user: { id: user.id, telegramId: user.telegramId.toString() } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscription', async (req, res, next) => {
    try {
      const query = subscriptionQuerySchema.parse(req.query);
      const subscription = await service.subscriptions.getSubscription(query.telegramId);
      res.status(200).json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.post('/fakepay/payments', async (req, res, next) => {
    try {
      const payload = fakepayPaymentSchema.parse(req.body);
      const payment = await service.fakepay.createPayment(payload.orderId);
      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  });

  router.post('/orders', async (req, res, next) => {
    try {
      const payload = createOrderSchema.parse(req.body);
      const order = await service.orders.createOrder(payload.telegramId, payload.planId);
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscription/renew', async (req, res, next) => {
    try {
      const payload = renewSchema.parse(req.body);
      const order = await service.orders.createRenewOrder(payload.telegramId);
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscription/cancel', async (req, res, next) => {
    try {
      const payload = cancelSchema.parse(req.body);
      const result = await service.subscriptions.cancel(payload.telegramId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/vpn/config', async (req, res, next) => {
    try {
      const query = subscriptionQuerySchema.parse(req.query);
      const configData = await service.subscriptions.getVpnConfig(query.telegramId);
      res.status(200).json(configData);
    } catch (error) {
      next(error);
    }
  });

  router.get('/orders/:id', async (req, res, next) => {
    try {
      const id = z.string().min(1).parse(req.params.id);
      const order = await service.orders.getOrderById(id);
      if (!order) {
        throw new HttpError(404, 'Order not found');
      }
      res.status(200).json({ order });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
