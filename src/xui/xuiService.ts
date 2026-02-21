import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export type XuiClientInput = {
  clientId: string;
  email: string;
  subId: string;
  expiresAt: Date;
};

type XuiInboundClient = {
  id?: string;
  email?: string;
};

type XuiActionResponse = {
  success?: boolean;
  msg?: string;
};

type XuiInboundResponse = {
  obj?: {
    settings?: string | { clients?: unknown };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildPath(path: string): string {
  return `${config.threeXUiWebBasePath}${path}`;
}

function buildLoginPaths(): string[] {
  const base = config.threeXUiWebBasePath;
  const parent = base.endsWith('/panel') ? base.slice(0, -'/panel'.length) : base;
  const candidates = [`${base}/login`, `${parent}/login`, '/login'];
  return Array.from(new Set(candidates));
}

function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const message = error.message;
    return `status=${status ?? 'n/a'} message=${message} data=${JSON.stringify(data)}`;
  }
  return error instanceof Error ? error.message : 'unknown';
}

function ensureXuiSuccess(response: { data?: unknown }, action: string): void {
  const payload = parseXuiActionResponse(response.data);
  if (payload && typeof payload.success === 'boolean' && !payload.success) {
    throw new Error(`${action} failed: ${payload.msg ?? 'unknown reason'}`);
  }
}

function parseXuiActionResponse(data: unknown): XuiActionResponse | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const payload: XuiActionResponse = {};
  if ('success' in data && typeof data.success === 'boolean') {
    payload.success = data.success;
  }
  if ('msg' in data && typeof data.msg === 'string') {
    payload.msg = data.msg;
  }

  return payload;
}

function getAxiosStatus(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  return error.response?.status;
}

function parseInboundResponse(data: unknown): XuiInboundResponse | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const objValue = data.obj;
  if (!isRecord(objValue)) {
    return undefined;
  }

  const responseObj: NonNullable<XuiInboundResponse['obj']> = {};
  if ('settings' in objValue && (typeof objValue.settings === 'string' || isRecord(objValue.settings))) {
    responseObj.settings = objValue.settings;
  }
  return { obj: responseObj };
}

function extractClientsFromSettings(settings: string | { clients?: unknown }): unknown[] {
  if (typeof settings === 'string') {
    try {
      const parsed: unknown = JSON.parse(settings);
      if (!isRecord(parsed) || !('clients' in parsed)) {
        return [];
      }
      return Array.isArray(parsed.clients) ? parsed.clients : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(settings.clients) ? settings.clients : [];
}

function toInboundClient(value: unknown): XuiInboundClient | null {
  if (!isRecord(value)) {
    return null;
  }

  const client: XuiInboundClient = {};
  if ('id' in value && typeof value.id === 'string') {
    client.id = value.id;
  }
  if ('email' in value && typeof value.email === 'string') {
    client.email = value.email;
  }

  return client;
}

export class XuiService {
  private readonly http: AxiosInstance;
  private sessionCookie = '';

  constructor() {
    this.http = axios.create({
      baseURL: config.threeXUiBaseUrl,
      timeout: 15000
    });
  }

  private async login(): Promise<void> {
    if (!config.threeXUiBaseUrl || !config.threeXUiUsername || !config.threeXUiPassword) {
      throw new Error('3x-ui is not configured. Set THREEXUI_BASE_URL, THREEXUI_USERNAME, THREEXUI_PASSWORD.');
    }

    const payload: Record<string, string> = {
      username: config.threeXUiUsername,
      password: config.threeXUiPassword
    };
    if (config.threeXUiTwoFactor) {
      payload.twoFactorCode = config.threeXUiTwoFactor;
    }

    const loginPaths = buildLoginPaths();
    const attempts: string[] = [];

    for (const loginPath of loginPaths) {
      let response;
      try {
        response = await this.http.post(loginPath, payload, {
          headers: { 'content-type': 'application/json' }
        });
      } catch (jsonError) {
        const form = new URLSearchParams();
        form.set('username', payload.username);
        form.set('password', payload.password);
        if (payload.twoFactorCode) form.set('twoFactorCode', payload.twoFactorCode);

        try {
          response = await this.http.post(loginPath, form, {
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
          });
        } catch (formError) {
          attempts.push(`${loginPath}: ${formatAxiosError(formError)}; json=${formatAxiosError(jsonError)}`);
          continue;
        }
      }

      const setCookie = response.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        this.sessionCookie = setCookie[0];
        return;
      }

      attempts.push(`${loginPath}: success response but no set-cookie; data=${JSON.stringify(response.data)}`);
    }

    throw new Error(`3x-ui login failed: no session cookie. Attempts: ${attempts.join(' | ')}`);
  }

  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.sessionCookie) {
      await this.login();
    }

    try {
      return await fn();
    } catch (error) {
      const status = getAxiosStatus(error);
      if (status === 401 || status === 403) {
        await this.login();
        return fn();
      }
      throw error;
    }
  }

  private headers() {
    return {
      Cookie: this.sessionCookie,
      'content-type': 'application/x-www-form-urlencoded'
    };
  }

  private async fetchInboundClients(): Promise<XuiInboundClient[]> {
    const paths = [buildPath(`/api/inbounds/get/${config.threeXUiInboundId}`), buildPath(`/inbound/get/${config.threeXUiInboundId}`)];

    for (const path of paths) {
      try {
        const response = await this.http.get(path, { headers: { Cookie: this.sessionCookie } });
        ensureXuiSuccess(response, 'getInbound');

        const payload = parseInboundResponse(response.data);
        const settings = payload?.obj?.settings;
        if (!settings) {
          return [];
        }

        const clientsRaw = extractClientsFromSettings(settings);
        return clientsRaw
          .map(toInboundClient)
          .filter((item): item is XuiInboundClient => item !== null);
      } catch {
        continue;
      }
    }

    return [];
  }

  private async findClientIdByEmail(email: string): Promise<string | null> {
    const clients = await this.fetchInboundClients();
    const existing = clients.find((client) => client.email === email && typeof client.id === 'string' && client.id.length > 0);
    return existing?.id ?? null;
  }

  public async upsertClient(input: XuiClientInput): Promise<void> {
    await this.withAuth(async () => {
      await this.deleteClient(input.clientId).catch(() => undefined);

      const client = {
        id: input.clientId,
        flow: config.vpnPublicFlow,
        email: input.email,
        limitIp: 0,
        totalGB: 0,
        expiryTime: input.expiresAt.getTime(),
        enable: true,
        tgId: '',
        subId: input.subId
      };

      const form = new URLSearchParams();
      form.set('id', String(config.threeXUiInboundId));
      form.set('settings', JSON.stringify({ clients: [client] }));

      try {
        const response = await this.http.post(buildPath('/api/inbounds/addClient'), form, {
          headers: this.headers()
        });
        ensureXuiSuccess(response, 'addClient');
      } catch {
        try {
          const response = await this.http.post(buildPath('/inbound/addClient'), form, {
            headers: this.headers()
          });
          ensureXuiSuccess(response, 'addClient');
        } catch (error) {
          const message = formatAxiosError(error);
          if (message.includes('Duplicate email')) {
            const existingClientId = await this.findClientIdByEmail(input.email);
            if (existingClientId) {
              await this.deleteClient(existingClientId);
              const retry = await this.http.post(buildPath('/inbound/addClient'), form, {
                headers: this.headers()
              });
              ensureXuiSuccess(retry, 'addClient');
              return;
            }
          }

          throw new Error(`3x-ui addClient failed: ${message}`);
        }
      }
    });
  }

  public async deleteClient(clientId: string): Promise<void> {
    await this.withAuth(async () => {
      const path = buildPath(`/inbound/${config.threeXUiInboundId}/delClient/${encodeURIComponent(clientId)}`);
      try {
        const response = await this.http.post(path, new URLSearchParams(), { headers: this.headers() });
        ensureXuiSuccess(response, 'delClient');
      } catch {
        try {
          const response = await this.http.get(path, { headers: { Cookie: this.sessionCookie } });
          ensureXuiSuccess(response, 'delClient');
        } catch (error) {
          throw new Error(`3x-ui delClient failed (${path}): ${formatAxiosError(error)}`);
        }
      }
    });
  }
}

export const xuiService = new XuiService();
