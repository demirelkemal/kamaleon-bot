import dotenv from 'dotenv';

dotenv.config();

function getRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function parseCookieSecureMode(value: string | undefined): 'auto' | 'always' | 'never' {
  if (!value) return 'auto';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'always' || normalized === 'never' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export const config = {
  port: Number(process.env.PORT ?? '3000'),
  databaseUrl: getRequired('DATABASE_URL'),
  appBaseUrl: normalizeBaseUrl(getRequired('APP_BASE_URL')),
  backendApiBaseUrl: normalizeBaseUrl(process.env.BACKEND_API_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`),
  fakepayWebhookSecret: getRequired('FAKEPAY_WEBHOOK_SECRET'),
  adminToken: getRequired('ADMIN_TOKEN'),
  internalApiToken: process.env.INTERNAL_API_TOKEN ?? getRequired('ADMIN_TOKEN'),
  trustedProfileLinkSource: process.env.TRUSTED_PROFILE_LINK_SOURCE ?? 'telegram-bot',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  profileCookieSecure: parseCookieSecureMode(process.env.PROFILE_COOKIE_SECURE),
  profileCleanupIntervalMs: parsePositiveNumber(process.env.PROFILE_CLEANUP_INTERVAL_MS, 15 * 60 * 1000),
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? '',
  threeXUiBaseUrl: process.env.THREEXUI_BASE_URL ? normalizeBaseUrl(process.env.THREEXUI_BASE_URL) : '',
  threeXUiWebBasePath: normalizePath(process.env.THREEXUI_WEBBASEPATH ?? '/panel'),
  threeXUiUsername: process.env.THREEXUI_USERNAME ?? '',
  threeXUiPassword: process.env.THREEXUI_PASSWORD ?? '',
  threeXUiTwoFactor: process.env.THREEXUI_TWO_FACTOR ?? '',
  threeXUiInboundId: Number(process.env.THREEXUI_INBOUND_ID ?? '1'),
  threeXUiSubscriptionBaseUrl: process.env.THREEXUI_SUBSCRIPTION_BASE_URL
    ? normalizeBaseUrl(process.env.THREEXUI_SUBSCRIPTION_BASE_URL)
    : '',
  vpnPublicHost: process.env.VPN_PUBLIC_HOST ?? '',
  vpnPublicPort: Number(process.env.VPN_PUBLIC_PORT ?? '443'),
  vpnPublicSecurity: process.env.VPN_PUBLIC_SECURITY ?? 'reality',
  vpnPublicType: process.env.VPN_PUBLIC_TYPE ?? 'tcp',
  vpnPublicSni: process.env.VPN_PUBLIC_SNI ?? '',
  vpnPublicPbk: process.env.VPN_PUBLIC_PBK ?? '',
  vpnPublicSid: process.env.VPN_PUBLIC_SID ?? '',
  vpnPublicSpx: process.env.VPN_PUBLIC_SPX ?? '/',
  vpnPublicFp: process.env.VPN_PUBLIC_FP ?? 'chrome',
  vpnPublicFlow: process.env.VPN_PUBLIC_FLOW ?? 'xtls-rprx-vision',
  vpnPublicTagTemplate: process.env.VPN_PUBLIC_TAG_TEMPLATE ?? 'reality-tg-{telegramId}',
  vpnPublicUri: process.env.VPN_PUBLIC_VLESS_URI ?? '',
  vpnIosUrl: process.env.VPN_APP_IOS_URL ?? '',
  vpnAndroidUrl: process.env.VPN_APP_ANDROID_URL ?? '',
  vpnWindowsUrl: process.env.VPN_APP_WINDOWS_URL ?? '',
  vpnMacosUrl: process.env.VPN_APP_MACOS_URL ?? ''
};
