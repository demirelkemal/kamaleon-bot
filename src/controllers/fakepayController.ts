import { Router } from 'express';
import { z } from 'zod';
import type { CoreRepository } from '../repositories/coreRepository';
import { FakepayService } from '../services/fakepayService';

const completeQuerySchema = z.object({
  result: z.enum(['succeeded', 'failed']),
  returnTo: z.string().optional()
});

const checkoutQuerySchema = z.object({
  returnTo: z.string().optional()
});

function sanitizeReturnTo(returnTo: string | undefined): string | null {
  if (!returnTo) {
    return null;
  }
  if (!returnTo.startsWith('/')) {
    return null;
  }
  if (returnTo.startsWith('//')) {
    return null;
  }
  return returnTo;
}

export function createFakepayController(repository: CoreRepository): Router {
  const router = Router();
  const service = new FakepayService(repository);

  router.get('/checkout/:providerPaymentId', async (req, res, next) => {
    try {
      const providerPaymentId = z.string().uuid().parse(req.params.providerPaymentId);
      const query = checkoutQuerySchema.parse(req.query);
      const html = await service.getCheckoutHtml(providerPaymentId, sanitizeReturnTo(query.returnTo));
      res.status(200).setHeader('content-type', 'text/html; charset=utf-8').send(html);
    } catch (error) {
      next(error);
    }
  });

  router.post('/complete/:providerPaymentId', async (req, res, next) => {
    try {
      const providerPaymentId = z.string().uuid().parse(req.params.providerPaymentId);
      const query = completeQuerySchema.parse(req.query);
      const message = await service.completePayment(providerPaymentId, query.result);

      const returnTo = sanitizeReturnTo(query.returnTo);
      if (returnTo) {
        const separator = returnTo.includes('?') ? '&' : '?';
        res.redirect(303, `${returnTo}${separator}payment=${query.result}`);
        return;
      }

      res.status(200).send(message);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
