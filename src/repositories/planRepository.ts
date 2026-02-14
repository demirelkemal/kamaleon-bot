import type { PrismaClient } from '@prisma/client';
import type { CoreRepository } from './types';

export type PlanRepository = Pick<CoreRepository, 'getActivePlans'>;

export function createPlanRepository(prisma: PrismaClient): PlanRepository {
  return {
    async getActivePlans() {
      return prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { durationDays: 'asc' },
        select: { id: true, code: true, name: true, durationDays: true, priceCents: true }
      });
    }
  };
}
