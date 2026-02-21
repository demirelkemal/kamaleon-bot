import { HttpError } from '../api/errors';
import { createFakepayPayment } from '../fakepay/service';
import type { CoreRepository } from '../repositories/coreRepository';

export class OrderService {
  constructor(private readonly repository: CoreRepository) {}

  async createOrder(telegramId: bigint, planId: string, returnTo?: string): Promise<{ orderId: string; paymentUrl: string }> {
    const order = await this.repository.createPendingOrder(telegramId, planId);
    const payment = createFakepayPayment({ orderId: order.orderId, returnTo });
    await this.repository.setOrderProviderPaymentId(order.orderId, payment.providerPaymentId);

    return { orderId: order.orderId, paymentUrl: payment.confirmationUrl };
  }

  async createRenewOrder(telegramId: bigint, returnTo?: string): Promise<{ orderId: string; paymentUrl: string }> {
    const order = await this.repository.createRenewOrder(telegramId);
    const payment = createFakepayPayment({ orderId: order.orderId, returnTo });
    await this.repository.setOrderProviderPaymentId(order.orderId, payment.providerPaymentId);

    return { orderId: order.orderId, paymentUrl: payment.confirmationUrl };
  }

  async getOrderById(orderId: string) {
    const order = await this.repository.getOrderById(orderId);
    if (!order) {
      throw new HttpError(404, 'Order not found');
    }
    return order;
  }

  async getOrderByProviderPaymentId(providerPaymentId: string) {
    return this.repository.getOrderByProviderPaymentId(providerPaymentId);
  }
}
