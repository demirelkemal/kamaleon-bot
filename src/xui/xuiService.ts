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
  const payload = response.data as { success?: boolean; msg?: string } | undefined;
  if (payload && typeof payload.success === 'boolean' && payload.success === false) {
    throw new Error(`${action} failed: ${payload.msg ?? 'unknown reason'}`);
  }
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
      const status = (error as { response?: { status?: number } }).response?.status;
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

        const payload = response.data as { obj?: { settings?: string | { clients?: unknown } } } | undefined;
        const settingsRaw = payload?.obj?.settings;
        let clientsRaw: unknown = [];

        if (typeof settingsRaw === 'string') {
          try {
            clientsRaw = (JSON.parse(settingsRaw) as { clients?: unknown }).clients ?? [];
          } catch {
            clientsRaw = [];
          }
        } else if (settingsRaw && typeof settingsRaw === 'object') {
          clientsRaw = (settingsRaw as { clients?: unknown }).clients ?? [];
        }

        if (!Array.isArray(clientsRaw)) {
          return [];
        }

        return clientsRaw
          .filter((item) => item && typeof item === 'object')
          .map((item) => item as XuiInboundClient);
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
