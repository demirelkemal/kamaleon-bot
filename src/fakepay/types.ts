export type FakepayWebhookStatus = 'succeeded' | 'failed';

export type FakepayWebhookPayload = {
  eventId: string;
  providerPaymentId: string;
  status: FakepayWebhookStatus;
  amount: number;
  currency: string;
  metadata: {
    orderId: string;
  };
};
