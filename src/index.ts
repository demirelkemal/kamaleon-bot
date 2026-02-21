import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { createTelegramBot } from './bot/bot';
import { ProfileWebService } from './services/profileWebService';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Server started');
});

const bot = createTelegramBot();
if (bot) {
  bot.start().then(() => {
    logger.info('Telegram bot started');
  });
}

const profileWebService = new ProfileWebService();
const runProfileCleanup = () => {
  profileWebService
    .cleanupExpired()
    .then((result) => {
      if (result.deletedTokens > 0 || result.deletedSessions > 0) {
        logger.info(result, 'Profile auth cleanup completed');
      }
    })
    .catch((error) => {
      logger.warn({ error }, 'Profile auth cleanup failed');
    });
};

runProfileCleanup();
const cleanupTimer = setInterval(runProfileCleanup, config.profileCleanupIntervalMs);

cleanupTimer.unref();

process.on('SIGINT', () => {
  clearInterval(cleanupTimer);
  if (bot) bot.stop();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  clearInterval(cleanupTimer);
  if (bot) bot.stop();
  server.close(() => process.exit(0));
});
