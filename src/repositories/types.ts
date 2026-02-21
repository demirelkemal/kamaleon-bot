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

export type CancelSubscriptionResult = {
  status: 'blocked' | 'expired';
};

export type ApplyWebhookEventResult = {
  idempotent: boolean;
  orderId: string;
  status: 'succeeded' | 'failed';
};

export type CoreRepository = {
  getActivePlans: () => Promise<PlanDto[]>;
  upsertTelegramUser: (telegramId: bigint) => Promise<UserDto>;
  getSubscriptionByTelegramId: (telegramId: bigint) => Promise<SubscriptionView>;
  createPendingOrder: (telegramId: bigint, planId: string) => Promise<{ orderId: string; amountCents: number; currency: string }>;
  createRenewOrder: (telegramId: bigint) => Promise<{ orderId: string; amountCents: number; currency: string }>;
  cancelSubscription: (telegramId: bigint) => Promise<CancelSubscriptionResult>;
  getVpnConfig: (telegramId: bigint) => Promise<VpnConfigView>;
  setOrderProviderPaymentId: (orderId: string, providerPaymentId: string) => Promise<void>;
  getOrderById: (orderId: string) => Promise<OrderDto | null>;
  getOrderByProviderPaymentId: (providerPaymentId: string) => Promise<OrderDto | null>;
  applyWebhookEvent: (payload: FakepayWebhookPayload, rawPayload: string) => Promise<ApplyWebhookEventResult>;
};
