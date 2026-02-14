import axios from 'axios';
import { prisma } from '../db/prisma';
import { config } from '../config';

export async function pushPaymentSucceeded(orderId: string): Promise<void> {
  if (!config.botToken) {
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      plan: true
    }
  });

  if (!order) {
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { userId: order.userId },
    orderBy: { expiresAt: 'desc' },
    select: { expiresAt: true }
  });

  const expiresText = subscription?.expiresAt ? subscription.expiresAt.toISOString() : 'n/a';

  const text = [
    'Оплата подтверждена.',
    `Тариф: ${order.plan.name}`,
    `Доступ до: ${expiresText}`,
    'Нажмите «Получить QR/Инструкции» в боте.'
  ].join('\n');

  await axios.post(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    chat_id: Number(order.user.telegramId),
    text
  });
}
