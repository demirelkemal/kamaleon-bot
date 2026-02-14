import { OrderStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../api/errors';
import type { FakepayWebhookPayload } from '../fakepay/types';

export type PlanDto = {
  id: string;
  code: string;
  name: string;
  durationDays: number;
  priceCents: number;
};

export type UserDto = {
  id: string;
  telegramId: bigint;
};

export type OrderDto = {
  id: string;
  status: 'pending_payment' | 'paid' | 'failed';
  providerPaymentId: string | null;
  amountCents: number;
  currency: string;
  planId: string;
  userId: string;
};

export type SubscriptionView = {
  status: 'active' | 'expired' | 'blocked';
  daysLeft: number;
  expiresAt: string | null;
  planId: string | null;
  planTitle: string | null;
};

export type VpnConfigView = {
  status: 'ready' | 'not_provisioned';
  vlessUri: string | null;
  subscriptionUrl: string | null;
};

export type CoreRepository = {
  getActivePlans: () => Promise<PlanDto[]>;
  upsertTelegramUser: (telegramId: bigint) => Promise<UserDto>;
  getSubscriptionByTelegramId: (telegramId: bigint) => Promise<SubscriptionView>;
  createPendingOrder: (telegramId: bigint, planId: string) => Promise<{ orderId: string; amountCents: number; currency: string }>;
  createRenewOrder: (telegramId: bigint) => Promise<{ orderId: string; amountCents: number; currency: string }>;
  cancelSubscription: (telegramId: bigint) => Promise<{ status: 'blocked' | 'expired' }>;
  getVpnConfig: (telegramId: bigint) => Promise<VpnConfigView>;
  setOrderProviderPaymentId: (orderId: string, providerPaymentId: string) => Promise<void>;
  getOrderById: (orderId: string) => Promise<OrderDto | null>;
  getOrderByProviderPaymentId: (providerPaymentId: string) => Promise<OrderDto | null>;
  applyWebhookEvent: (payload: FakepayWebhookPayload, rawPayload: string) => Promise<{ idempotent: boolean; orderId: string; status: 'succeeded' | 'failed' }>;
};

function toApiOrderStatus(status: OrderStatus): OrderDto['status'] {
  if (status === OrderStatus.PAID) return 'paid';
  if (status === OrderStatus.FAILED) return 'failed';
  return 'pending_payment';
}

function calculateDaysLeft(expiresAt: Date, now = new Date()): number {
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export const prismaCoreRepository: CoreRepository = {
  async getActivePlans() {
    return prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { durationDays: 'asc' },
      select: { id: true, code: true, name: true, durationDays: true, priceCents: true }
    });
  },

  async upsertTelegramUser(telegramId: bigint) {
    return prisma.user.upsert({
      where: { telegramId },
      update: {},
      create: { telegramId },
      select: { id: true, telegramId: true }
    });
  },

  async getSubscriptionByTelegramId(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: {
        subscriptions: {
          orderBy: { expiresAt: 'desc' },
          take: 1,
          select: { status: true, expiresAt: true, planId: true, plan: { select: { name: true } } }
        }
      }
    });

    const subscription = user?.subscriptions[0];
    if (!subscription) {
      return { status: 'expired', daysLeft: 0, expiresAt: null, planId: null, planTitle: null };
    }

    if (subscription.status === 'BLOCKED') {
      return {
        status: 'blocked',
        daysLeft: 0,
        expiresAt: subscription.expiresAt.toISOString(),
        planId: subscription.planId,
        planTitle: subscription.plan?.name ?? null
      };
    }

    const daysLeft = calculateDaysLeft(subscription.expiresAt);
    if (subscription.status !== SubscriptionStatus.ACTIVE || daysLeft === 0) {
      return {
        status: 'expired',
        daysLeft: 0,
        expiresAt: subscription.expiresAt.toISOString(),
        planId: subscription.planId,
        planTitle: subscription.plan?.name ?? null
      };
    }

    return {
      status: 'active',
      daysLeft,
      expiresAt: subscription.expiresAt.toISOString(),
      planId: subscription.planId,
      planTitle: subscription.plan?.name ?? null
    };
  },

  async createPendingOrder(telegramId: bigint, planId: string) {
    return prisma.$transaction(async (tx) => {
      const [user, plan] = await Promise.all([
        tx.user.upsert({
          where: { telegramId },
          update: {},
          create: { telegramId },
          select: { id: true }
        }),
        tx.plan.findFirst({ where: { id: planId, isActive: true }, select: { id: true, priceCents: true } })
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

  async cancelSubscription(telegramId: bigint) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { telegramId },
        update: {},
        create: { telegramId },
        select: { id: true }
      });

      const subscription = await tx.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { expiresAt: 'desc' }
      });

      if (!subscription) {
        return { status: 'expired' as const };
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'BLOCKED', needsProvisioning: false }
      });

      return { status: 'blocked' as const };
    });
  },

  async getVpnConfig(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: {
        vpnAccount: true,
        subscriptions: {
          where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user || user.subscriptions.length === 0 || !user.vpnAccount || user.vpnAccount.deletedAt || !user.vpnAccount.vlessUri) {
      return { status: 'not_provisioned', vlessUri: null, subscriptionUrl: null };
    }

    return { status: 'ready', vlessUri: user.vpnAccount.vlessUri, subscriptionUrl: user.vpnAccount.subscriptionUrl };
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
  },

  async applyWebhookEvent(payload: FakepayWebhookPayload, rawPayload: string) {
    return prisma.$transaction(async (tx) => {
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
            payload: JSON.parse(rawPayload) as Prisma.InputJsonValue,
            orderId: order.id
          }
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
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
