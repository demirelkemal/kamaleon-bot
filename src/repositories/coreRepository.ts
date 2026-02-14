import { prisma } from '../db/prisma';
import { createOrderRepository } from './orderRepository';
import { createPlanRepository } from './planRepository';
import { createSubscriptionRepository } from './subscriptionRepository';
import { createUserRepository } from './userRepository';
import { createWebhookRepository } from './webhookRepository';
import type { CoreRepository } from './types';

export type { CoreRepository, OrderDto, PlanDto, SubscriptionView, UserDto, VpnConfigView } from './types';

const planRepository = createPlanRepository(prisma);
const userRepository = createUserRepository(prisma);
const orderRepository = createOrderRepository(prisma);
const subscriptionRepository = createSubscriptionRepository(prisma);
const webhookRepository = createWebhookRepository(prisma);

export const prismaCoreRepository: CoreRepository = {
  ...planRepository,
  ...userRepository,
  ...orderRepository,
  ...subscriptionRepository,
  ...webhookRepository
};
