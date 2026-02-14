import express from 'express';
import pinoHttp from 'pino-http';
import { requestIdMiddleware } from './middleware/requestId';
import { logger } from './logger';
import { createAdminRouter, createApiRouter, createFakepayRouter, createWebhookRouter } from './api/routes';
import { errorHandler } from './api/errorHandler';
import { prismaCoreRepository, type CoreRepository } from './repositories/coreRepository';
import { securityHeaders } from './security/httpSecurity';

export function createApp(repository: CoreRepository = prismaCoreRepository) {
  const app = express();

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
  app.use('/api', createApiRouter(repository));
  app.use('/api/admin', createAdminRouter());
  app.use('/fakepay', createFakepayRouter(repository));
  app.use(errorHandler);

  return app;
}
