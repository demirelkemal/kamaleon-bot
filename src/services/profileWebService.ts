import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { SubscriptionStatus } from '@prisma/client';
import { HttpError } from '../api/errors';
import { config } from '../config';
import { logger } from '../logger';
import { prisma } from '../db/prisma';
import { cancelAndDeleteUser, ensureUserProvisionedByTelegramId } from './provisioningService';
import { OrderService } from './orderService';
import { prismaCoreRepository } from '../repositories/coreRepository';

const ACCESS_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const TOKEN_REUSE_GRACE_MS = 30 * 1000;

export const PROFILE_SESSION_COOKIE = 'kam_profile_session';

type ProfileStatus = 'active' | 'expired' | 'blocked';

export type CreateProfileLinkResult = {
  url: string;
  expiresAt: Date;
};

export type ProfilePageData = {
  telegramId: string;
  status: ProfileStatus;
  planName: string | null;
  expiresAt: string | null;
  daysLeft: number;
  hasAnySubscription: boolean;
  needsSetup: boolean;
};

export type SetupPageData = {
  planName: string | null;
  expiresAt: string;
  vlessUri: string | null;
  qrCodeDataUrl: string | null;
};

export type ProfileCleanupResult = {
  deletedTokens: number;
  deletedSessions: number;
};

function calculateDaysLeft(expiresAt: Date): number {
  const diff = expiresAt.getTime() - Date.now();
  if (diff <= 0) {
    return 0;
  }
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function formatIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function botOpenUrl(): string {
  if (config.botUsername) {
    return `https://t.me/${config.botUsername}`;
  }
  return 'https://t.me';
}

export class ProfileWebService {
  private readonly orderService = new OrderService(prismaCoreRepository);

  getBotOpenUrl(): string {
    return botOpenUrl();
  }

  async createAccessLink(telegramId: bigint): Promise<CreateProfileLinkResult> {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { telegramId },
        update: {},
        create: { telegramId },
        select: { id: true }
      });

      await tx.profileAccessToken.updateMany({
        where: {
          telegramId,
          consumedAt: null,
          expiresAt: { gt: now }
        },
        data: { consumedAt: now }
      });

      await tx.profileAccessToken.create({
        data: {
          token,
          telegramId,
          expiresAt
        }
      });
    });

    return {
      url: `${config.appBaseUrl}/profile/access/${token}`,
      expiresAt
    };
  }

  async consumeAccessToken(token: string): Promise<{ ok: true; sessionKey: string } | { ok: false }> {
    const now = new Date();
    const accessToken = await prisma.profileAccessToken.findUnique({
      where: { token },
      select: { id: true, telegramId: true, expiresAt: true, consumedAt: true }
    });

    if (!accessToken || accessToken.expiresAt <= now) {
      return { ok: false };
    }

    if (accessToken.consumedAt) {
      const consumedAgo = now.getTime() - accessToken.consumedAt.getTime();
      if (consumedAgo > TOKEN_REUSE_GRACE_MS) {
        return { ok: false };
      }

      const existingSession = await prisma.profileWebSession.findFirst({
        where: {
          telegramId: accessToken.telegramId,
          expiresAt: { gt: now }
        },
        orderBy: { createdAt: 'desc' },
        select: { sessionKey: true }
      });

      if (!existingSession) {
        return { ok: false };
      }

      return { ok: true, sessionKey: existingSession.sessionKey };
    }

    const sessionKey = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.profileAccessToken.updateMany({
        where: {
          id: accessToken.id,
          consumedAt: null,
          expiresAt: { gt: now }
        },
        data: { consumedAt: now }
      });

      if (updated.count !== 1) {
        return null;
      }

      await tx.profileWebSession.create({
        data: {
          sessionKey,
          telegramId: accessToken.telegramId,
          expiresAt
        }
      });
      return sessionKey;
    });

    if (!result) {
      return { ok: false };
    }
    return { ok: true, sessionKey };
  }

  private async getActiveSession(sessionKey: string) {
    const session = await prisma.profileWebSession.findUnique({
      where: { sessionKey },
      select: { id: true, telegramId: true, expiresAt: true }
    });

    if (!session || session.expiresAt <= new Date()) {
      return null;
    }

    await prisma.profileWebSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    return session;
  }

  async getProfilePageData(sessionKey: string): Promise<ProfilePageData | null> {
    const session = await this.getActiveSession(sessionKey);
    if (!session) {
      return null;
    }

    const [user, activeSubscription, latestSubscription, subscriptionCount] = await Promise.all([
      prisma.user.findUnique({
        where: { telegramId: session.telegramId },
        select: {
          id: true,
          telegramId: true,
          vpnAccount: {
            select: { vlessUri: true, deletedAt: true }
          }
        }
      }),
      prisma.subscription.findFirst({
        where: {
          user: { telegramId: session.telegramId },
          status: SubscriptionStatus.ACTIVE,
          expiresAt: { gt: new Date() }
        },
        include: { plan: { select: { name: true } } },
        orderBy: { expiresAt: 'desc' }
      }),
      prisma.subscription.findFirst({
        where: { user: { telegramId: session.telegramId } },
        include: { plan: { select: { name: true } } },
        orderBy: { expiresAt: 'desc' }
      }),
      prisma.subscription.count({ where: { user: { telegramId: session.telegramId } } })
    ]);

    const hasAnySubscription = subscriptionCount > 0;
    const needsSetup = Boolean(
      activeSubscription && (!user?.vpnAccount || user.vpnAccount.deletedAt !== null || !user.vpnAccount.vlessUri)
    );

    if (!activeSubscription) {
      if (latestSubscription?.status === SubscriptionStatus.BLOCKED) {
        return {
          telegramId: session.telegramId.toString(),
          status: 'blocked',
          planName: latestSubscription.plan?.name ?? null,
          expiresAt: formatIso(latestSubscription.expiresAt),
          daysLeft: 0,
          hasAnySubscription,
          needsSetup: false
        };
      }

      return {
        telegramId: session.telegramId.toString(),
        status: 'expired',
        planName: latestSubscription?.plan?.name ?? null,
        expiresAt: formatIso(latestSubscription?.expiresAt ?? null),
        daysLeft: 0,
        hasAnySubscription,
        needsSetup: false
      };
    }

    return {
      telegramId: session.telegramId.toString(),
      status: 'active',
      planName: activeSubscription.plan?.name ?? null,
      expiresAt: activeSubscription.expiresAt.toISOString(),
      daysLeft: calculateDaysLeft(activeSubscription.expiresAt),
      hasAnySubscription,
      needsSetup
    };
  }

  async getSetupPageData(sessionKey: string): Promise<SetupPageData | null> {
    const session = await this.getActiveSession(sessionKey);
    if (!session) {
      return null;
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        user: { telegramId: session.telegramId },
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      },
      include: { plan: { select: { name: true } } },
      orderBy: { expiresAt: 'desc' }
    });

    if (!activeSubscription) {
      return null;
    }

    try {
      await ensureUserProvisionedByTelegramId(session.telegramId);
    } catch (error) {
      logger.warn({ error, telegramId: session.telegramId.toString() }, 'Provisioning failed while opening setup');
    }

    const account = await prisma.vpnAccount.findUnique({
      where: {
        userId: activeSubscription.userId
      },
      select: { vlessUri: true, deletedAt: true }
    });

    const vlessUri = account && !account.deletedAt ? account.vlessUri : null;
    const qrCodeDataUrl = vlessUri ? await QRCode.toDataURL(vlessUri, { width: 384, errorCorrectionLevel: 'M' }) : null;

    return {
      planName: activeSubscription.plan?.name ?? null,
      expiresAt: activeSubscription.expiresAt.toISOString(),
      vlessUri,
      qrCodeDataUrl
    };
  }

  async createRenewPayment(sessionKey: string): Promise<{ paymentUrl: string } | null> {
    const session = await this.getActiveSession(sessionKey);
    if (!session) {
      return null;
    }

    try {
      const order = await this.orderService.createRenewOrder(session.telegramId, '/profile');
      return { paymentUrl: order.paymentUrl };
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode !== 404) {
        throw error;
      }

      const latestPlan = await prisma.subscription.findFirst({
        where: {
          user: { telegramId: session.telegramId },
          planId: { not: null }
        },
        select: { planId: true },
        orderBy: { expiresAt: 'desc' }
      });

      if (!latestPlan?.planId) {
        throw error;
      }

      const order = await this.orderService.createOrder(session.telegramId, latestPlan.planId, '/profile');
      return { paymentUrl: order.paymentUrl };
    }
  }

  async cancelSubscription(sessionKey: string): Promise<{ status: 'blocked' | 'expired' } | null> {
    const session = await this.getActiveSession(sessionKey);
    if (!session) {
      return null;
    }
    return cancelAndDeleteUser(session.telegramId);
  }

  async clearSession(sessionKey: string): Promise<void> {
    await prisma.profileWebSession.deleteMany({
      where: { sessionKey }
    });
  }

  async cleanupExpired(): Promise<ProfileCleanupResult> {
    const now = new Date();
    const [tokens, sessions] = await Promise.all([
      prisma.profileAccessToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }]
        }
      }),
      prisma.profileWebSession.deleteMany({
        where: { expiresAt: { lte: now } }
      })
    ]);

    return {
      deletedTokens: tokens.count,
      deletedSessions: sessions.count
    };
  }
}
