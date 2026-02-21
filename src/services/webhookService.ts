import { z } from 'zod';
import { HttpError } from '../api/errors';
import { verifyFakepaySignature } from '../fakepay/signature';
import { config } from '../config';
import { ensureUserProvisionedByOrderId } from './provisioningService';
import { pushPaymentSucceeded } from './telegramPushService';
import { logger } from '../logger';
import type { CoreRepository } from '../repositories/coreRepository';

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

export class WebhookService {
  constructor(private readonly repository: CoreRepository) {}

  async handleFakepay(rawBody: string, signature: string | undefined): Promise<{ ok: true; idempotent: boolean }> {
    if (!rawBody) {
      throw new HttpError(400, 'Raw body is required');
    }

    if (!verifyFakepaySignature(rawBody, config.fakepayWebhookSecret, signature)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }

    const payload = webhookPayloadSchema.parse(JSON.parse(rawBody));
    const result = await this.repository.applyWebhookEvent(payload, rawBody);

    if (result.status === 'succeeded' && !result.idempotent) {
      try {
        await ensureUserProvisionedByOrderId(result.orderId);
      } catch (provisionError) {
        logger.error({ provisionError, orderId: result.orderId }, 'Provisioning failed after successful payment');
      }

      pushPaymentSucceeded(result.orderId).catch((pushError) => {
        logger.warn({ pushError, orderId: result.orderId }, 'Telegram push notification failed');
      });
    }

    return { ok: true, idempotent: result.idempotent };
  }
}
