import { randomUUID } from 'node:crypto';
import { HttpError } from '../api/errors';
import { signFakepayPayload } from '../fakepay/signature';
import type { FakepayWebhookPayload, FakepayWebhookStatus } from '../fakepay/types';
import { config } from '../config';
import { renderFakepayCheckoutPage } from '../fakepay/views/checkoutPage';
import type { CoreRepository } from '../repositories/coreRepository';
import { createFakepayPayment } from '../fakepay/service';

function paymentStatusToLabel(status: FakepayWebhookStatus): string {
  return status === 'succeeded' ? 'Оплата успешно отправлена в webhook' : 'Оплата завершена ошибкой';
}

export class FakepayService {
  constructor(private readonly repository: CoreRepository) {}

  async createPayment(orderId: string) {
    return createFakepayPayment({ orderId });
  }

  async getCheckoutHtml(providerPaymentId: string, returnTo: string | null): Promise<string> {
    const order = await this.repository.getOrderByProviderPaymentId(providerPaymentId);
    if (!order) {
      throw new HttpError(404, 'Payment not found');
    }

    return renderFakepayCheckoutPage({
      orderId: order.id,
      providerPaymentId,
      amountCents: order.amountCents,
      currency: order.currency,
      returnTo
    });
  }

  async completePayment(providerPaymentId: string, result: FakepayWebhookStatus): Promise<string> {
    const order = await this.repository.getOrderByProviderPaymentId(providerPaymentId);
    if (!order) {
      throw new HttpError(404, 'Payment not found');
    }

    const payload: FakepayWebhookPayload = {
      eventId: randomUUID(),
      providerPaymentId,
      status: result,
      amount: order.amountCents,
      currency: order.currency,
      metadata: { orderId: order.id }
    };

    const rawBody = JSON.stringify(payload);
    const signature = signFakepayPayload(rawBody, config.fakepayWebhookSecret);

    const webhookResponse = await fetch(`${config.backendApiBaseUrl}/api/webhooks/fakepay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fakepay-signature': signature
      },
      body: rawBody
    });

    const responseText = await webhookResponse.text();
    if (!webhookResponse.ok) {
      throw new HttpError(502, `Webhook delivery failed: ${webhookResponse.status} ${responseText}`);
    }

    return paymentStatusToLabel(result);
  }
}
