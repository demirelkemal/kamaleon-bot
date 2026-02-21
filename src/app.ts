import express from 'express';
import path from 'node:path';
import pinoHttp from 'pino-http';
import { requestIdMiddleware } from './middleware/requestId';
import { logger } from './logger';
import { createAdminRouter, createApiRouter, createFakepayRouter, createProfileRouter, createWebhookRouter } from './api/routes';
import { errorHandler } from './api/errorHandler';
import { prismaCoreRepository, type CoreRepository } from './repositories/coreRepository';
import { securityHeaders } from './security/httpSecurity';
import { config } from './config';

export function createApp(repository: CoreRepository = prismaCoreRepository) {
  const app = express();
  app.set('trust proxy', config.trustProxy);

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId
    })
  );

  app.get('/health', (_req, res) => {
    res.status(200).send('ok');
  });

  app.use('/api/webhooks', express.raw({ type: 'application/json' }), createWebhookRouter(repository));
  app.use(express.json({ limit: '64kb' }));
  app.use('/profile/assets', express.static(path.resolve(process.cwd(), 'src/profile')));
  app.use('/api', createApiRouter(repository));
  app.use('/profile', createProfileRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/fakepay', createFakepayRouter(repository));
  app.use(errorHandler);

  return app;
}
