import { OrderStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../api/errors';
import type { CoreRepository } from './types';
import type { ApplyWebhookEventResult } from './types';

export type WebhookRepository = Pick<CoreRepository, 'applyWebhookEvent'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrismaInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === null) {
    return true;
  }

  const primitiveType = typeof value;
  if (primitiveType === 'string' || primitiveType === 'number' || primitiveType === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isPrismaInputJsonValue);
  }

  if (isRecord(value)) {
    for (const entryValue of Object.values(value)) {
      if (!isPrismaInputJsonValue(entryValue)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function parseRawPayload(rawPayload: string): Prisma.InputJsonValue {
  const parsed: unknown = JSON.parse(rawPayload);
  if (!isPrismaInputJsonValue(parsed)) {
    throw new Error('Invalid webhook payload JSON');
  }
  return parsed;
}

export function createWebhookRepository(prisma: PrismaClient): WebhookRepository {
  return {
    async applyWebhookEvent(payload, rawPayload): Promise<ApplyWebhookEventResult> {
      const parsedPayload = parseRawPayload(rawPayload);

      return prisma.$transaction<ApplyWebhookEventResult>(async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: payload.metadata.orderId,
            providerPaymentId: payload.providerPaymentId
          },
          include: { plan: true }
        });

        if (!order) {
          throw new HttpError(404, 'Order not found for payment');
        }

        try {
          await tx.paymentEvent.create({
            data: {
              eventId: payload.eventId,
              providerPaymentId: payload.providerPaymentId,
              status: payload.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
              amountCents: payload.amount,
              currency: payload.currency,
              payload: parsedPayload,
              orderId: order.id
            }
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { idempotent: true, orderId: order.id, status: payload.status };
          }
          throw error;
        }

        if (payload.status === 'failed') {
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.FAILED }
          });
          return { idempotent: false, orderId: order.id, status: 'failed' };
        }

        if (order.status !== OrderStatus.PAID) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PAID,
              paidAt: new Date()
            }
          });
        }

        const now = new Date();
        const activeSubscription = await tx.subscription.findFirst({
          where: {
            userId: order.userId,
            status: SubscriptionStatus.ACTIVE,
            expiresAt: { gt: now }
          },
          orderBy: { expiresAt: 'desc' }
        });

        if (activeSubscription) {
          const newExpires = new Date(activeSubscription.expiresAt);
          newExpires.setUTCDate(newExpires.getUTCDate() + order.plan.durationDays);

          await tx.subscription.update({
            where: { id: activeSubscription.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              planId: order.planId,
              expiresAt: newExpires,
              needsProvisioning: true,
              lastProvisionedAt: null
            }
          });

          return { idempotent: false, orderId: order.id, status: 'succeeded' };
        }

        const expiresAt = new Date(now);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + order.plan.durationDays);

        await tx.subscription.create({
          data: {
            userId: order.userId,
            planId: order.planId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: now,
            expiresAt,
            needsProvisioning: true,
            lastProvisionedAt: null
          }
        });

        return { idempotent: false, orderId: order.id, status: 'succeeded' };
      });
    }
  };
}
