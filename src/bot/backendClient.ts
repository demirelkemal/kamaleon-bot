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

export function formatBackendError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    const message = data?.message ?? data?.error ?? error.message;
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
