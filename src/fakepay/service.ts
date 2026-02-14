import { randomUUID } from 'node:crypto';
import { config } from '../config';

export type FakepayCreatePaymentInput = {
  orderId: string;
};

export type FakepayCreatePaymentOutput = {
  providerPaymentId: string;
  confirmationUrl: string;
};

export function createFakepayPayment(input: FakepayCreatePaymentInput): FakepayCreatePaymentOutput {
  const providerPaymentId = randomUUID();
  return {
    providerPaymentId,
    confirmationUrl: `${config.appBaseUrl}/fakepay/checkout/${providerPaymentId}?orderId=${encodeURIComponent(input.orderId)}`
  };
}
