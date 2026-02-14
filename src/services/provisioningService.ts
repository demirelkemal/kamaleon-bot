import { randomBytes, randomUUID } from 'node:crypto';
import { SubscriptionStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../api/errors';
import { config } from '../config';
import { xuiService } from '../xui/xuiService';

function buildTag(telegramId: bigint): string {
  return config.vpnPublicTagTemplate.replace('{telegramId}', telegramId.toString());
}

function buildVlessUri(clientId: string, email: string, telegramId: bigint): string {
  if (config.vpnPublicUri) {
    return config.vpnPublicUri
      .replace('{uuid}', clientId)
      .replace('{email}', encodeURIComponent(email))
      .replace('{telegramId}', telegramId.toString());
  }

  const params = new URLSearchParams();
  params.set('type', config.vpnPublicType);
  params.set('security', config.vpnPublicSecurity);
  if (config.vpnPublicSni) params.set('sni', config.vpnPublicSni);
  if (config.vpnPublicFlow) params.set('flow', config.vpnPublicFlow);
  if (config.vpnPublicPbk) params.set('pbk', config.vpnPublicPbk);
  if (config.vpnPublicSid) params.set('sid', config.vpnPublicSid);
  if (config.vpnPublicSpx) params.set('spx', config.vpnPublicSpx);
  if (config.vpnPublicFp) params.set('fp', config.vpnPublicFp);

  return `vless://${clientId}@${config.vpnPublicHost}:${config.vpnPublicPort}?${params.toString()}#${encodeURIComponent(buildTag(telegramId))}`;
}

function generateSubId(): string {
  return randomBytes(8).toString('hex');
}

function buildSubscriptionUrl(subId: string): string | null {
  if (!config.threeXUiSubscriptionBaseUrl) {
    return null;
  }
  return `${config.threeXUiSubscriptionBaseUrl}?name=${encodeURIComponent(subId)}`;
}

async function getActiveProvisioningTargetByUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      vpnAccount: true,
      subscriptions: {
        where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'desc' },
        take: 1
      }
    }
  });

  if (!user || user.subscriptions.length === 0) {
    return null;
  }

  return {
    user,
    subscription: user.subscriptions[0]
  };
}

export async function ensureUserProvisionedByTelegramId(telegramId: bigint): Promise<void> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  await ensureUserProvisionedByUserId(user.id);
}

export async function ensureUserProvisionedByOrderId(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
  if (!order) {
    throw new HttpError(404, 'Order not found');
  }
  await ensureUserProvisionedByUserId(order.userId);
}

async function ensureUserProvisionedByUserId(userId: string): Promise<void> {
  const target = await getActiveProvisioningTargetByUserId(userId);
  if (!target) {
    throw new HttpError(404, 'No active subscription for provisioning');
  }

  const clientId = target.user.vpnAccount?.xuiClientId ?? randomUUID();
  const subId = target.user.vpnAccount?.xuiSubId ?? generateSubId();
  const email = `tg-${target.user.telegramId.toString()}`;
  const vlessUri = buildVlessUri(clientId, email, target.user.telegramId);
  const subscriptionUrl = buildSubscriptionUrl(subId);

  await xuiService.upsertClient({
    clientId,
    email,
    subId,
    expiresAt: target.subscription.expiresAt
  }).catch((error) => {
    throw new HttpError(502, `3x-ui provision failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.vpnAccount.upsert({
      where: { userId: target.user.id },
      update: {
        xuiClientId: clientId,
        xuiSubId: subId,
        xuiInboundId: config.threeXUiInboundId,
        vlessUri,
        subscriptionUrl,
        deletedAt: null,
        lastProvisionedAt: now
      },
      create: {
        userId: target.user.id,
        xuiClientId: clientId,
        xuiSubId: subId,
        xuiInboundId: config.threeXUiInboundId,
        vlessUri,
        subscriptionUrl,
        deletedAt: null,
        lastProvisionedAt: now
      }
    });

    await tx.subscription.update({
      where: { id: target.subscription.id },
      data: {
        needsProvisioning: false,
        lastProvisionedAt: now
      }
    });
  });
}

export async function cancelAndDeleteUser(telegramId: bigint): Promise<{ status: 'blocked' | 'expired' }> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: {
      vpnAccount: true,
      subscriptions: {
        orderBy: { expiresAt: 'desc' },
        take: 1
      }
    }
  });

  if (!user || user.subscriptions.length === 0) {
    return { status: 'expired' };
  }

  if (user.vpnAccount && !user.vpnAccount.deletedAt) {
    await xuiService.deleteClient(user.vpnAccount.xuiClientId).catch((error) => {
      throw new HttpError(502, `3x-ui delete failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }

  const latestSubscription = user.subscriptions[0];
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: latestSubscription.id },
      data: {
        status: SubscriptionStatus.BLOCKED,
        needsProvisioning: false
      }
    });

    if (user.vpnAccount) {
      await tx.vpnAccount.update({
        where: { userId: user.id },
        data: {
          deletedAt: new Date()
        }
      });
    }
  });

  return { status: 'blocked' };
}
