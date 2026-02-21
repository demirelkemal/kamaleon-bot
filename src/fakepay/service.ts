import { randomUUID } from 'node:crypto';
import { config } from '../config';

export type FakepayCreatePaymentInput = {
  orderId: string;
  returnTo?: string;
};

export type FakepayCreatePaymentOutput = {
  providerPaymentId: string;
  confirmationUrl: string;
};

export function createFakepayPayment(input: FakepayCreatePaymentInput): FakepayCreatePaymentOutput {
  const providerPaymentId = randomUUID();
  const params = new URLSearchParams({ orderId: input.orderId });
  if (input.returnTo) {
    params.set('returnTo', input.returnTo);
  }
  return {
    providerPaymentId,
    confirmationUrl: `${config.appBaseUrl}/fakepay/checkout/${providerPaymentId}?${params.toString()}`
  };
}
