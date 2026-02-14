import type { CoreRepository, OrderDto, PlanDto, SubscriptionView, UserDto, VpnConfigView } from '../../repositories/coreRepository';
import type { FakepayWebhookPayload } from '../../fakepay/types';

type InMemoryState = {
  usersByTelegram: Map<bigint, UserDto>;
  plans: PlanDto[];
  orders: Map<string, OrderDto>;
  orderIdByProviderPaymentId: Map<string, string>;
  processedEvents: Set<string>;
  subscriptionsByTelegram: Map<bigint, { status: 'active' | 'expired' | 'blocked'; expiresAt: Date | null; planId: string | null }>;
};

export function createInMemoryRepository(): CoreRepository {
  const state: InMemoryState = {
    usersByTelegram: new Map(),
    plans: [
      { id: 'plan-7', code: 'plan_7', name: '7 days', durationDays: 7, priceCents: 9900 },
      { id: 'plan-30', code: 'plan_30', name: '30 days', durationDays: 30, priceCents: 29900 },
      { id: 'plan-90', code: 'plan_90', name: '90 days', durationDays: 90, priceCents: 79900 }
    ],
    orders: new Map(),
    orderIdByProviderPaymentId: new Map(),
    processedEvents: new Set(),
    subscriptionsByTelegram: new Map()
  };

  let userCounter = 1;
  let orderCounter = 1;

  const planDaysById = new Map(state.plans.map((plan) => [plan.id, plan.durationDays]));
  const planTitleById = new Map(state.plans.map((plan) => [plan.id, plan.name]));

  function calculateDaysLeft(expiresAt: Date | null): number {
    if (!expiresAt) return 0;
    const diff = expiresAt.getTime() - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / (24 * 60 * 60 * 1000));
  }

  function findTelegramIdByUserId(userId: string): bigint | null {
    for (const [telegramId, user] of state.usersByTelegram.entries()) {
      if (user.id === userId) return telegramId;
    }
    return null;
  }

  return {
    async getActivePlans() {
      return state.plans;
    },

    async upsertTelegramUser(telegramId: bigint) {
      const existing = state.usersByTelegram.get(telegramId);
      if (existing) return existing;

      const user = { id: `user-${userCounter++}`, telegramId };
      state.usersByTelegram.set(telegramId, user);
      return user;
    },

    async getSubscriptionByTelegramId(telegramId: bigint): Promise<SubscriptionView> {
      const sub = state.subscriptionsByTelegram.get(telegramId);
      if (!sub || !sub.expiresAt || sub.expiresAt.getTime() <= Date.now()) {
        return { status: 'expired', daysLeft: 0, expiresAt: sub?.expiresAt?.toISOString() ?? null, planId: sub?.planId ?? null, planTitle: sub?.planId ? planTitleById.get(sub.planId) ?? null : null };
      }

      if (sub.status === 'blocked') {
        return { status: 'blocked', daysLeft: 0, expiresAt: sub.expiresAt.toISOString(), planId: sub.planId, planTitle: sub.planId ? planTitleById.get(sub.planId) ?? null : null };
      }

      return {
        status: 'active',
        daysLeft: calculateDaysLeft(sub.expiresAt),
        expiresAt: sub.expiresAt.toISOString(),
        planId: sub.planId,
        planTitle: sub.planId ? planTitleById.get(sub.planId) ?? null : null
      };
    },

    async createPendingOrder(telegramId: bigint, planId: string) {
      const user = await this.upsertTelegramUser(telegramId);
      const plan = state.plans.find((item) => item.id === planId);
      if (!plan) {
        throw new Error('Plan not found');
      }

      const orderId = `order-${orderCounter++}`;
      state.orders.set(orderId, {
        id: orderId,
        status: 'pending_payment',
        providerPaymentId: null,
        amountCents: plan.priceCents,
        currency: 'RUB',
        planId: plan.id,
        userId: user.id
      });

      return { orderId, amountCents: plan.priceCents, currency: 'RUB' };
    },

    async createRenewOrder(telegramId: bigint) {
      const sub = await this.getSubscriptionByTelegramId(telegramId);
      if (sub.status !== 'active' || !sub.planId) {
        throw new Error('No active subscription to renew');
      }
      return this.createPendingOrder(telegramId, sub.planId);
    },

    async cancelSubscription(telegramId: bigint) {
      const sub = state.subscriptionsByTelegram.get(telegramId);
      if (!sub) {
        return { status: 'expired' as const };
      }
      state.subscriptionsByTelegram.set(telegramId, { ...sub, status: 'blocked' });
      return { status: 'blocked' as const };
    },

    async getVpnConfig(telegramId: bigint): Promise<VpnConfigView> {
      const sub = await this.getSubscriptionByTelegramId(telegramId);
      if (sub.status !== 'active') {
        return { status: 'not_provisioned', vlessUri: null };
      }
      return { status: 'ready', vlessUri: 'vless://stub@example.com:443?security=reality#stub' };
    },

    async setOrderProviderPaymentId(orderId: string, providerPaymentId: string) {
      const order = state.orders.get(orderId);
      if (!order) throw new Error('Order not found');
      order.providerPaymentId = providerPaymentId;
      state.orderIdByProviderPaymentId.set(providerPaymentId, orderId);
    },

    async getOrderById(orderId: string) {
      return state.orders.get(orderId) ?? null;
    },

    async getOrderByProviderPaymentId(providerPaymentId: string) {
      const orderId = state.orderIdByProviderPaymentId.get(providerPaymentId);
      if (!orderId) return null;
      return state.orders.get(orderId) ?? null;
    },

    async applyWebhookEvent(payload: FakepayWebhookPayload) {
      if (state.processedEvents.has(payload.eventId)) {
        return { idempotent: true, orderId: payload.metadata.orderId, status: payload.status };
      }
      state.processedEvents.add(payload.eventId);

      const order = await this.getOrderByProviderPaymentId(payload.providerPaymentId);
      if (!order || payload.metadata.orderId !== order.id) {
        throw new Error('Order not found for payment');
      }

      if (payload.status === 'failed') {
        order.status = 'failed';
        return { idempotent: false, orderId: order.id, status: 'failed' as const };
      }

      order.status = 'paid';

      const telegramId = findTelegramIdByUserId(order.userId);
      if (!telegramId) {
        throw new Error('User not found');
      }

      const now = new Date();
      const planDays = planDaysById.get(order.planId) ?? 0;
      const existing = state.subscriptionsByTelegram.get(telegramId);

      if (existing?.status === 'active' && existing.expiresAt && existing.expiresAt > now) {
        const extended = new Date(existing.expiresAt);
        extended.setUTCDate(extended.getUTCDate() + planDays);
        state.subscriptionsByTelegram.set(telegramId, { status: 'active', expiresAt: extended, planId: order.planId });
        return { idempotent: false, orderId: order.id, status: 'succeeded' as const };
      }

      const expiresAt = new Date(now);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + planDays);
      state.subscriptionsByTelegram.set(telegramId, { status: 'active', expiresAt, planId: order.planId });
      return { idempotent: false, orderId: order.id, status: 'succeeded' as const };
    }
  };
}
