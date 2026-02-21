import QRCode from 'qrcode';
import { cancelAndDeleteUser, ensureUserProvisionedByTelegramId } from './provisioningService';
import { logger } from '../logger';
import type { CoreRepository } from '../repositories/coreRepository';

export class SubscriptionService {
  constructor(private readonly repository: CoreRepository) {}

  async getSubscription(telegramId: bigint) {
    return this.repository.getSubscriptionByTelegramId(telegramId);
  }

  async cancel(telegramId: bigint) {
    return cancelAndDeleteUser(telegramId);
  }

  async getVpnConfig(telegramId: bigint): Promise<{ status: 'ready' | 'not_provisioned'; vlessUri: string | null; subscriptionUrl: string | null; qrCodeDataUrl?: string }> {
    let configData = await this.repository.getVpnConfig(telegramId);

    if (configData.status !== 'ready') {
      try {
        await ensureUserProvisionedByTelegramId(telegramId);
        configData = await this.repository.getVpnConfig(telegramId);
      } catch (provisionError) {
        logger.warn({ provisionError, telegramId: telegramId.toString() }, 'Provisioning retry failed on vpn/config');
      }
    }

    if (configData.status === 'ready' && configData.vlessUri) {
      const qrCodeDataUrl = await QRCode.toDataURL(configData.vlessUri, { width: 512, errorCorrectionLevel: 'M' });
      return { ...configData, qrCodeDataUrl };
    }

    return configData;
  }
}
