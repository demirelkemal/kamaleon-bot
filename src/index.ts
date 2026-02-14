import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { createTelegramBot } from './bot/bot';

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

process.on('SIGINT', () => {
  if (bot) bot.stop();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  if (bot) bot.stop();
  server.close(() => process.exit(0));
});
