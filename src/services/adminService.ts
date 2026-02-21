import { HttpError } from '../api/errors';
import { verifyBearerToken } from '../security/auth';
import { config } from '../config';
import { ensureUserProvisionedByTelegramId } from './provisioningService';

export class AdminService {
  async provision(authorizationHeader: string, telegramId: bigint): Promise<{ ok: true }> {
    if (!verifyBearerToken(authorizationHeader, config.adminToken)) {
      throw new HttpError(401, 'Unauthorized');
    }

    await ensureUserProvisionedByTelegramId(telegramId);
    return { ok: true };
  }
}
