import { OrderStatus, SubscriptionStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../api/errors';
import type { CoreRepository } from './types';
import { toApiOrderStatus } from './utils';

export type OrderRepository = Pick<
  CoreRepository,
  'createPendingOrder' | 'createRenewOrder' | 'setOrderProviderPaymentId' | 'getOrderById' | 'getOrderByProviderPaymentId'
>;

export function createOrderRepository(prisma: PrismaClient): OrderRepository {
  return {
    async createPendingOrder(telegramId: bigint, planId: string) {
      return prisma.$transaction(async (tx) => {
        const [user, plan] = await Promise.all([
          tx.user.upsert({
            where: { telegramId },
            update: {},
            create: { telegramId },
            select: { id: true }
          }),
          tx.plan.findFirst({
            where: {
              isActive: true,
              OR: [{ id: planId }, { code: planId }]
            },
            select: { id: true, priceCents: true }
          })
        ]);

        if (!plan) {
          throw new HttpError(404, 'Plan not found');
        }

        const order = await tx.order.create({
          data: {
            userId: user.id,
            planId: plan.id,
            status: OrderStatus.PENDING_PAYMENT,
            amountCents: plan.priceCents,
            currency: 'RUB'
          },
          select: { id: true, amountCents: true, currency: true }
        });

        return { orderId: order.id, amountCents: order.amountCents, currency: order.currency };
      });
    },

    async createRenewOrder(telegramId: bigint) {
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { telegramId },
          update: {},
          create: { telegramId },
          select: { id: true }
        });

        const active = await tx.subscription.findFirst({
          where: { userId: user.id, status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() }, planId: { not: null } },
          orderBy: { expiresAt: 'desc' },
          select: { planId: true }
        });

        if (!active?.planId) {
          throw new HttpError(404, 'No active subscription to renew');
        }

        const plan = await tx.plan.findFirst({ where: { id: active.planId, isActive: true }, select: { id: true, priceCents: true } });
        if (!plan) {
          throw new HttpError(404, 'Plan not found for renewal');
        }

        const order = await tx.order.create({
          data: {
            userId: user.id,
            planId: plan.id,
            status: OrderStatus.PENDING_PAYMENT,
            amountCents: plan.priceCents,
            currency: 'RUB'
          },
          select: { id: true, amountCents: true, currency: true }
        });

        return { orderId: order.id, amountCents: order.amountCents, currency: order.currency };
      });
    },

    async setOrderProviderPaymentId(orderId: string, providerPaymentId: string) {
      await prisma.order.update({
        where: { id: orderId },
        data: { providerPaymentId }
      });
    },

    async getOrderById(orderId: string) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          providerPaymentId: true,
          amountCents: true,
          currency: true,
          planId: true,
          userId: true
        }
      });

      if (!order) return null;

      return {
        id: order.id,
        status: toApiOrderStatus(order.status),
        providerPaymentId: order.providerPaymentId,
        amountCents: order.amountCents,
        currency: order.currency,
        planId: order.planId,
        userId: order.userId
      };
    },

    async getOrderByProviderPaymentId(providerPaymentId: string) {
      const order = await prisma.order.findUnique({
        where: { providerPaymentId },
        select: {
          id: true,
          status: true,
          providerPaymentId: true,
          amountCents: true,
          currency: true,
          planId: true,
          userId: true
        }
      });

      if (!order) return null;

      return {
        id: order.id,
        status: toApiOrderStatus(order.status),
        providerPaymentId: order.providerPaymentId,
        amountCents: order.amountCents,
        currency: order.currency,
        planId: order.planId,
        userId: order.userId
      };
    }
  };
}
