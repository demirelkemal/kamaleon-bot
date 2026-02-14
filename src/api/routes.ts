import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { HttpError } from './errors';
import type { CoreRepository } from '../repositories/coreRepository';
import { createFakepayPayment } from '../fakepay/service';
import type { FakepayWebhookPayload, FakepayWebhookStatus } from '../fakepay/types';
import { config } from '../config';
import { signFakepayPayload, verifyFakepaySignature } from '../fakepay/signature';
import { cancelAndDeleteUser, ensureUserProvisionedByOrderId, ensureUserProvisionedByTelegramId } from '../services/provisioningService';
import { logger } from '../logger';
import { verifyBearerToken } from '../security/auth';
import { pushPaymentSucceeded } from '../services/telegramPushService';

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

const completeQuerySchema = z.object({
  result: z.enum(['succeeded', 'failed'])
});

const webhookPayloadSchema = z.object({
  eventId: z.string().uuid(),
  providerPaymentId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed']),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  metadata: z.object({
    orderId: z.string().min(1)
  })
});

function paymentStatusToLabel(status: FakepayWebhookStatus): string {
  return status === 'succeeded' ? 'Оплата успешно отправлена в webhook' : 'Оплата завершена ошибкой';
}

export function createApiRouter(repository: CoreRepository): Router {
  const router = Router();

  router.get('/plans', async (_req, res, next) => {
    try {
      const plans = await repository.getActivePlans();
      res.status(200).json({ plans });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/telegram', async (req, res, next) => {
    try {
      const payload = telegramBodySchema.parse(req.body);
      const user = await repository.upsertTelegramUser(payload.telegramId);
      res.status(200).json({ user: { id: user.id, telegramId: user.telegramId.toString() } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscription', async (req, res, next) => {
    try {
      const query = subscriptionQuerySchema.parse(req.query);
      const subscription = await repository.getSubscriptionByTelegramId(query.telegramId);
      res.status(200).json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.post('/fakepay/payments', async (req, res, next) => {
    try {
      const payload = fakepayPaymentSchema.parse(req.body);
      const payment = createFakepayPayment({ orderId: payload.orderId });
      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  });

  router.post('/orders', async (req, res, next) => {
    try {
      const payload = createOrderSchema.parse(req.body);

      const order = await repository.createPendingOrder(payload.telegramId, payload.planId);
      const payment = createFakepayPayment({ orderId: order.orderId });
      await repository.setOrderProviderPaymentId(order.orderId, payment.providerPaymentId);

      res.status(201).json({ orderId: order.orderId, paymentUrl: payment.confirmationUrl });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscription/renew', async (req, res, next) => {
    try {
      const payload = renewSchema.parse(req.body);
      const order = await repository.createRenewOrder(payload.telegramId);
      const payment = createFakepayPayment({ orderId: order.orderId });
      await repository.setOrderProviderPaymentId(order.orderId, payment.providerPaymentId);
      res.status(201).json({ orderId: order.orderId, paymentUrl: payment.confirmationUrl });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscription/cancel', async (req, res, next) => {
    try {
      const payload = cancelSchema.parse(req.body);
      const result = await cancelAndDeleteUser(payload.telegramId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/vpn/config', async (req, res, next) => {
    try {
      const query = subscriptionQuerySchema.parse(req.query);
      const configData = await repository.getVpnConfig(query.telegramId);
      if (configData.status === 'ready' && configData.vlessUri) {
        const qrCodeDataUrl = await QRCode.toDataURL(configData.vlessUri, { width: 512, errorCorrectionLevel: 'M' });
        res.status(200).json({ ...configData, qrCodeDataUrl });
        return;
      }
      res.status(200).json(configData);
    } catch (error) {
      next(error);
    }
  });

  router.get('/orders/:id', async (req, res, next) => {
    try {
      const id = z.string().min(1).parse(req.params.id);
      const order = await repository.getOrderById(id);
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

export function createAdminRouter(): Router {
  const router = Router();

  router.post('/provision', async (req, res, next) => {
    try {
      const authHeader = req.header('authorization') ?? '';
      if (!verifyBearerToken(authHeader, config.adminToken)) {
        throw new HttpError(401, 'Unauthorized');
      }

      const query = subscriptionQuerySchema.parse(req.query);
      await ensureUserProvisionedByTelegramId(query.telegramId);
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createWebhookRouter(repository: CoreRepository): Router {
  const router = Router();

  router.post('/fakepay', async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      if (!rawBody) {
        throw new HttpError(400, 'Raw body is required');
      }

      const signature = req.header('x-fakepay-signature');
      if (!verifyFakepaySignature(rawBody, config.fakepayWebhookSecret, signature)) {
        throw new HttpError(401, 'Invalid webhook signature');
      }

      const payload = webhookPayloadSchema.parse(JSON.parse(rawBody));
      const result = await repository.applyWebhookEvent(payload, rawBody);

      if (result.status === 'succeeded' && !result.idempotent) {
        try {
          await ensureUserProvisionedByOrderId(result.orderId);
        } catch (provisionError) {
          logger.error({ provisionError, orderId: result.orderId }, 'Provisioning failed after successful payment');
          // Keep needsProvisioning=true for later retry via admin endpoint.
        }

        pushPaymentSucceeded(result.orderId).catch((pushError) => {
          logger.warn({ pushError, orderId: result.orderId }, 'Telegram push notification failed');
        });
      }

      res.status(200).json({ ok: true, idempotent: result.idempotent });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createFakepayRouter(repository: CoreRepository): Router {
  const router = Router();

  router.get('/checkout/:providerPaymentId', async (req, res, next) => {
    try {
      const providerPaymentId = z.string().uuid().parse(req.params.providerPaymentId);
      const order = await repository.getOrderByProviderPaymentId(providerPaymentId);
      if (!order) {
        throw new HttpError(404, 'Payment not found');
      }

      const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>FakePay Checkout</title>
  </head>
  <body style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px;">
    <h1 style="margin-bottom: 8px;">FakePay Checkout (тестовая оплата)</h1>
    <p style="margin-top:0;color:#555;">Это демонстрационная страница: нажатие кнопки отправляет webhook в backend.</p>

    <div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:10px;padding:14px;margin:16px 0;">
      <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${order.id}</code></p>
      <p style="margin:4px 0;"><strong>Provider Payment ID:</strong> <code>${providerPaymentId}</code></p>
      <p style="margin:4px 0;"><strong>Сумма:</strong> ${(order.amountCents / 100).toFixed(2)} ${order.currency}</p>
    </div>

    <form method="POST" action="/fakepay/complete/${providerPaymentId}?result=succeeded" style="margin-bottom:12px;">
      <button type="submit" style="padding:10px 16px;border-radius:8px;border:0;background:#1f883d;color:#fff;cursor:pointer;">Оплатить успешно</button>
    </form>

    <form method="POST" action="/fakepay/complete/${providerPaymentId}?result=failed">
      <button type="submit" style="padding:10px 16px;border-radius:8px;border:0;background:#cf222e;color:#fff;cursor:pointer;">Завершить с ошибкой</button>
    </form>

    <p style="margin-top:16px;color:#666;">После успешной оплаты вернитесь в Telegram и нажмите «Получить QR/Инструкции».</p>
  </body>
</html>`;

      res.status(200).setHeader('content-type', 'text/html; charset=utf-8').send(html);
    } catch (error) {
      next(error);
    }
  });

  router.post('/complete/:providerPaymentId', async (req, res, next) => {
    try {
      const providerPaymentId = z.string().uuid().parse(req.params.providerPaymentId);
      const query = completeQuerySchema.parse(req.query);

      const order = await repository.getOrderByProviderPaymentId(providerPaymentId);
      if (!order) {
        throw new HttpError(404, 'Payment not found');
      }

      const payload: FakepayWebhookPayload = {
        eventId: randomUUID(),
        providerPaymentId,
        status: query.result,
        amount: order.amountCents,
        currency: order.currency,
        metadata: { orderId: order.id }
      };

      const rawBody = JSON.stringify(payload);
      const signature = signFakepayPayload(rawBody, config.fakepayWebhookSecret);

      const webhookResponse = await fetch(`${config.backendApiBaseUrl}/api/webhooks/fakepay`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fakepay-signature': signature
        },
        body: rawBody
      });

      const responseText = await webhookResponse.text();
      if (!webhookResponse.ok) {
        throw new HttpError(502, `Webhook delivery failed: ${webhookResponse.status} ${responseText}`);
      }

      res.status(200).send(paymentStatusToLabel(query.result));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
