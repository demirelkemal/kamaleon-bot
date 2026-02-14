import { Router } from 'express';
import { z } from 'zod';
import { AdminService } from '../services/adminService';

const subscriptionQuerySchema = z.object({
  telegramId: z.coerce.bigint()
});

export function createAdminController(): Router {
  const router = Router();
  const service = new AdminService();

  router.post('/provision', async (req, res, next) => {
    try {
      const authHeader = req.header('authorization') ?? '';
      const query = subscriptionQuerySchema.parse(req.query);
      const result = await service.provision(authHeader, query.telegramId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
