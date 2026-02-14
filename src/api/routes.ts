import { Router } from 'express';
import { createApiController } from '../controllers/apiController';
import { createAdminController } from '../controllers/adminController';
import { createWebhookController } from '../controllers/webhookController';
import { createFakepayController } from '../controllers/fakepayController';
import type { CoreRepository } from '../repositories/coreRepository';

export function createApiRouter(repository: CoreRepository): Router {
  return createApiController(repository);
}

export function createAdminRouter(): Router {
  return createAdminController();
}

export function createWebhookRouter(repository: CoreRepository): Router {
  return createWebhookController(repository);
}

export function createFakepayRouter(repository: CoreRepository): Router {
  return createFakepayController(repository);
}
