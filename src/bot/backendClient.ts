import axios from 'axios';
import { config } from '../config';

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
};

type Subscription = {
  status: 'active' | 'expired' | 'blocked';
  daysLeft: number;
  expiresAt: string | null;
  planId: string | null;
  planTitle: string | null;
};

const http = axios.create({
  baseURL: config.backendApiBaseUrl,
  timeout: 15000
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const maybeMessage = data.message;
  if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
    return maybeMessage;
  }

  const maybeError = data.error;
  if (typeof maybeError === 'string' && maybeError.length > 0) {
    return maybeError;
  }

  return null;
}

export function formatBackendError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = extractErrorMessage(error.response?.data) ?? error.message;
    return status ? `HTTP ${status}: ${message}` : message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function apiGetPlans(): Promise<Plan[]> {
  const response = await http.get('/api/plans');
  return response.data.plans;
}

export async function apiGetSubscription(telegramId: string): Promise<Subscription> {
  const response = await http.get('/api/subscription', { params: { telegramId } });
  return response.data;
}

export async function apiCreateOrder(telegramId: string, planId: string): Promise<{ orderId: string; paymentUrl: string }> {
  const response = await http.post('/api/orders', { telegramId, planId });
  return response.data;
}

export async function apiRenewSubscription(telegramId: string): Promise<{ orderId: string; paymentUrl: string }> {
  const response = await http.post('/api/subscription/renew', { telegramId });
  return response.data;
}

export async function apiCancelSubscription(telegramId: string): Promise<{ status: 'blocked' | 'expired' }> {
  const response = await http.post('/api/subscription/cancel', { telegramId });
  return response.data;
}

export async function apiGetVpnConfig(
  telegramId: string
): Promise<{ status: 'ready' | 'not_provisioned'; vlessUri: string | null; subscriptionUrl: string | null; qrCodeDataUrl?: string }> {
  const response = await http.get('/api/vpn/config', { params: { telegramId } });
  return response.data;
}

export async function apiCreateProfileLink(telegramId: string): Promise<{ url: string; expiresAt: string }> {
  const response = await http.post('/api/profile/link', { telegramId }, {
    headers: {
      authorization: `Bearer ${config.internalApiToken}`,
      'x-kamaleon-source': config.trustedProfileLinkSource
    }
  });
  return response.data;
}
