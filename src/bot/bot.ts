import { Bot, InlineKeyboard, InputFile } from 'grammy';
import QRCode from 'qrcode';
import { config } from '../config';
import { logger } from '../logger';
import {
  apiCancelSubscription,
  apiCreateOrder,
  formatBackendError,
  apiGetPlans,
  apiGetSubscription,
  apiGetVpnConfig,
  apiRenewSubscription
} from './backendClient';

function rub(cents: number): string {
  return `${(cents / 100).toFixed(2)} RUB`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', { timeZone: 'UTC' });
}

function profileKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Продлить', 'profile:renew')
    .text('Остановить', 'profile:cancel')
    .row()
    .text('Получить QR/Инструкции', 'profile:qr');
}

async function sendPlans(chatId: number, bot: Bot): Promise<void> {
  const plans = await apiGetPlans();
  if (plans.length === 0) {
    await bot.api.sendMessage(chatId, 'Тарифы пока недоступны.');
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const plan of plans) {
    keyboard.text(`${plan.name} • ${rub(plan.priceCents)}`, `plan:${plan.id}`).row();
  }

  await bot.api.sendMessage(chatId, 'Выберите тариф:', { reply_markup: keyboard });
}

async function sendProfile(chatId: number, telegramId: string, bot: Bot): Promise<void> {
  const subscription = await apiGetSubscription(telegramId);
  if (subscription.status !== 'active') {
    if (subscription.status === 'blocked') {
      await bot.api.sendMessage(chatId, 'Подписка заблокирована. Выберите тариф и оплатите, чтобы восстановить доступ.');
    } else {
      await bot.api.sendMessage(chatId, 'Подписка не активна. Выберите тариф для подключения.');
    }
    await sendPlans(chatId, bot);
    return;
  }

  await bot.api.sendMessage(
    chatId,
    [
      'Профиль подписки',
      `Тариф: ${subscription.planTitle ?? '-'}`,
      `Действует до (UTC): ${formatDate(subscription.expiresAt)}`,
      `Осталось дней: ${subscription.daysLeft}`
    ].join('\n'),
    { reply_markup: profileKeyboard() }
  );
}

function instructionsText(vlessUri: string, subscriptionUrl: string | null): string {
  const subscriptionBlock = subscriptionUrl
    ? ['Ссылка с инструкциями и автонастройкой:', subscriptionUrl, ''].join('\n')
    : '';

  return [
    'Инструкции по подключению:',
    subscriptionBlock,
  ].join('\n');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isTelegramButtonUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

export function createTelegramBot(): Bot | null {
  if (!config.botToken) {
    logger.warn('BOT_TOKEN is empty, Telegram bot is disabled');
    return null;
  }

  const bot = new Bot(config.botToken);

  bot.api.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'profile', description: 'Профиль подписки' }
  ]).catch((error) => {
    logger.error({ error }, 'Failed to set bot commands');
  });

  bot.command('start', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    await ctx.reply(
      'Добро пожаловать в Kamaleon VPN.\nНажмите «Старт», чтобы открыть меню.',
      { reply_markup: new InlineKeyboard().text('Старт', 'menu:start') }
    );
  });

  bot.command('profile', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const telegramId = String(ctx.from.id);
    const subscription = await apiGetSubscription(telegramId);

    if (subscription.status === 'active') {
      await sendProfile(ctx.chat.id, telegramId, bot);
      return;
    }

    await sendPlans(ctx.chat.id, bot);
  });

  bot.callbackQuery('menu:start', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const telegramId = String(ctx.from.id);
    const subscription = await apiGetSubscription(telegramId);
    await ctx.answerCallbackQuery();

    if (subscription.status === 'active') {
      await sendProfile(ctx.chat.id, telegramId, bot);
      return;
    }

    await sendPlans(ctx.chat.id, bot);
  });

  bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
    try {
      if (!ctx.chat || !ctx.from) return;
      const planId = ctx.match[1];
      const telegramId = String(ctx.from.id);
      const order = await apiCreateOrder(telegramId, planId);

      const canOpenInTelegram = isTelegramButtonUrlAllowed(order.paymentUrl);
      await ctx.answerCallbackQuery();

      const text = [
        'Заказ создан.',
        'Оплатите по ссылке:',
        order.paymentUrl,
        '',
        'После подтверждения оплаты вернитесь в бот и нажмите «Получить QR/Инструкции».'
      ].join('\n');

      if (canOpenInTelegram) {
        const keyboard = new InlineKeyboard();
        if (order.paymentUrl.startsWith('https://')) {
          keyboard.webApp('Оплатить', order.paymentUrl);
        } else {
          keyboard.url('Оплатить', order.paymentUrl);
        }
        keyboard.row().text('Получить QR/Инструкции', 'profile:qr');

        await ctx.reply(text, {
          reply_markup: keyboard
        });
        return;
      }

      await ctx.reply(text, {
        reply_markup: new InlineKeyboard().text('Получить QR/Инструкции', 'profile:qr')
      });
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to create order from plan selection');
      await ctx.answerCallbackQuery({ text: 'Ошибка создания заказа' });
      await ctx.reply(`Не удалось создать заказ: ${details}`);
    }
  });

  bot.callbackQuery('profile:renew', async (ctx) => {
    try {
      if (!ctx.from) return;
      const telegramId = String(ctx.from.id);
      const order = await apiRenewSubscription(telegramId);

      await ctx.answerCallbackQuery();
      const text = ['Заказ на продление создан.', 'Ссылка на оплату:', order.paymentUrl].join('\n');

      if (isTelegramButtonUrlAllowed(order.paymentUrl)) {
        await ctx.reply(text, {
          reply_markup: new InlineKeyboard().url('Оплатить', order.paymentUrl).row().text('Получить QR/Инструкции', 'profile:qr')
        });
        return;
      }

      await ctx.reply(text, {
        reply_markup: new InlineKeyboard().text('Получить QR/Инструкции', 'profile:qr')
      });
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to renew subscription');
      await ctx.answerCallbackQuery({ text: 'Ошибка продления' });
      await ctx.reply(`Не удалось создать заказ на продление: ${details}`);
    }
  });

  bot.callbackQuery('profile:cancel', async (ctx) => {
    if (!ctx.chat) return;
    await ctx.answerCallbackQuery();
      await ctx.reply('Подтвердить остановку подписки?', {
        reply_markup: new InlineKeyboard().text('Да', 'cancel:yes').text('Нет', 'cancel:no')
      });
  });

  bot.callbackQuery('cancel:no', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
  });

  bot.callbackQuery('cancel:yes', async (ctx) => {
    if (!ctx.from) return;
    const telegramId = String(ctx.from.id);
    await apiCancelSubscription(telegramId);
    await ctx.answerCallbackQuery();
    await ctx.reply('Подписка остановлена (status=blocked). Для возобновления выберите тариф и оплатите его заново.');
  });

  bot.callbackQuery('profile:qr', async (ctx) => {
    if (!ctx.from) return;
    const telegramId = String(ctx.from.id);
    const vpnConfig = await apiGetVpnConfig(telegramId);

    await ctx.answerCallbackQuery();

    if (vpnConfig.status !== 'ready' || !vpnConfig.vlessUri || vpnConfig.vlessUri === 'not provisioned') {
      await ctx.reply('Конфиг пока не готов. Если вы только что оплатили, подождите 5-10 секунд и нажмите кнопку еще раз.');
      return;
    }

    const qr = vpnConfig.qrCodeDataUrl
      ? Buffer.from(vpnConfig.qrCodeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
      : await QRCode.toBuffer(vpnConfig.vlessUri, { width: 512, type: 'png' });

    await ctx.replyWithPhoto(new InputFile(qr, 'vpn.png'), {
      caption: instructionsText(vpnConfig.vlessUri, vpnConfig.subscriptionUrl)
    });
    await ctx.reply(`${vpnConfig.vlessUri}`);
  });

  bot.catch((error) => {
    logger.error({ error }, 'Telegram bot error');
  });

  return bot;
}
