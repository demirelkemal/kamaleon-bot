import { OrderStatus } from '@prisma/client';
import type { OrderDto } from './types';

export function toApiOrderStatus(status: OrderStatus): OrderDto['status'] {
  if (status === OrderStatus.PAID) return 'paid';
  if (status === OrderStatus.FAILED) return 'failed';
  return 'pending_payment';
}

export function calculateDaysLeft(expiresAt: Date, now = new Date()): number {
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}
