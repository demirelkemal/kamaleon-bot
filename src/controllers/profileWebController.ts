import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import {
  PROFILE_SESSION_COOKIE,
  ProfileWebService
} from '../services/profileWebService';
import {
  renderExpiredPage,
  renderProfilePage,
  renderSetupPage
} from '../profile/views';

const accessParamsSchema = z.object({
  token: z.string().uuid()
});

const profileQuerySchema = z.object({
  payment: z.enum(['succeeded', 'failed']).optional(),
  canceled: z.enum(['1']).optional()
});

function readSessionCookie(rawCookie: string | undefined): string | null {
  if (!rawCookie) {
    return null;
  }

  const parts = rawCookie.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PROFILE_SESSION_COOKIE) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export function createProfileWebController(): Router {
  const router = Router();
  const service = new ProfileWebService();

  router.get('/access/:token', async (req, res, next) => {
    try {
      const params = accessParamsSchema.parse(req.params);
      const consumed = await service.consumeAccessToken(params.token);
      if (!consumed.ok) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      const isSecureCookie =
        config.profileCookieSecure === 'always'
          ? true
          : config.profileCookieSecure === 'never'
            ? false
            : req.secure;

      res.cookie(PROFILE_SESSION_COOKIE, consumed.sessionKey, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureCookie,
        maxAge: 60 * 60 * 1000,
        path: '/profile'
      });
      res.redirect(303, '/profile');
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const query = profileQuerySchema.parse(req.query);
      const sessionKey = readSessionCookie(req.header('cookie'));
      if (!sessionKey) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      const data = await service.getProfilePageData(sessionKey);
      if (!data) {
        await service.clearSession(sessionKey);
        res.clearCookie(PROFILE_SESSION_COOKIE, { path: '/profile' });
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      if (data.needsSetup) {
        res.redirect(303, '/profile/setup');
        return;
      }

      const html = renderProfilePage({
        data,
        paymentStatus: query.payment ?? null,
        canceled: query.canceled === '1'
      });
      res.status(200).setHeader('content-type', 'text/html; charset=utf-8').send(html);
    } catch (error) {
      next(error);
    }
  });

  router.get('/setup', async (req, res, next) => {
    try {
      const sessionKey = readSessionCookie(req.header('cookie'));
      if (!sessionKey) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      const setupData = await service.getSetupPageData(sessionKey);
      if (!setupData) {
        res.redirect(303, '/profile');
        return;
      }

      const html = renderSetupPage(setupData);
      res.status(200).setHeader('content-type', 'text/html; charset=utf-8').send(html);
    } catch (error) {
      next(error);
    }
  });

  router.post('/actions/renew', async (req, res, next) => {
    try {
      const sessionKey = readSessionCookie(req.header('cookie'));
      if (!sessionKey) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      const payment = await service.createRenewPayment(sessionKey);
      if (!payment) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      res.redirect(303, payment.paymentUrl);
    } catch (error) {
      next(error);
    }
  });

  router.post('/actions/cancel', async (req, res, next) => {
    try {
      const sessionKey = readSessionCookie(req.header('cookie'));
      if (!sessionKey) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      const result = await service.cancelSubscription(sessionKey);
      if (!result) {
        res.status(410).setHeader('content-type', 'text/html; charset=utf-8').send(renderExpiredPage(service.getBotOpenUrl()));
        return;
      }

      res.redirect(303, '/profile?canceled=1');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
