import { Router } from 'express';
import type { CoreRepository } from '../repositories/coreRepository';
import { WebhookService } from '../services/webhookService';

export function createWebhookController(repository: CoreRepository): Router {
  const router = Router();
  const service = new WebhookService(repository);

  router.post('/fakepay', async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const signature = req.header('x-fakepay-signature');
      const result = await service.handleFakepay(rawBody, signature);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
