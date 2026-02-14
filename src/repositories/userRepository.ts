import type { PrismaClient } from '@prisma/client';
import type { CoreRepository } from './types';

export type UserRepository = Pick<CoreRepository, 'upsertTelegramUser'>;

export function createUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async upsertTelegramUser(telegramId: bigint) {
      return prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: { telegramId },
        select: { id: true, telegramId: true }
      });
    }
  };
}
