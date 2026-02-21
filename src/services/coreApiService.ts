import type { CoreRepository } from '../repositories/coreRepository';
import { OrderService } from './orderService';
import { SubscriptionService } from './subscriptionService';
import { FakepayService } from './fakepayService';

export class CoreApiService {
  readonly orders: OrderService;
  readonly subscriptions: SubscriptionService;
  readonly fakepay: FakepayService;

  constructor(private readonly repository: CoreRepository) {
    this.orders = new OrderService(repository);
    this.subscriptions = new SubscriptionService(repository);
    this.fakepay = new FakepayService(repository);
  }

  async getPlans() {
    return this.repository.getActivePlans();
  }

  async upsertTelegramUser(telegramId: bigint) {
    return this.repository.upsertTelegramUser(telegramId);
  }
}
