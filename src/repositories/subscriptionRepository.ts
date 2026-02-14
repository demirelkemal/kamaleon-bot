import { SubscriptionStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { CoreRepository } from './types';
import { calculateDaysLeft } from './utils';

export type SubscriptionRepository = Pick<CoreRepository, 'getSubscriptionByTelegramId' | 'cancelSubscription' | 'getVpnConfig'>;

export function createSubscriptionRepository(prisma: PrismaClient): SubscriptionRepository {
  return {
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
    }
  };
}
