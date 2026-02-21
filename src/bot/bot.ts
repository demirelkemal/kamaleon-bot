import { Bot, InlineKeyboard, InputFile } from 'grammy';
import QRCode from 'qrcode';
import { config } from '../config';
import { logger } from '../logger';
import {
  apiCancelSubscription,
  apiCreateProfileLink,
  apiCreateOrder,
  formatBackendError,
  apiGetPlans,
  apiGetSubscription,
  apiGetVpnConfig,
  apiRenewSubscription
} from './backendClient';

type BotPlan = {
  id: string;
  name: string;
  priceCents: number;
};

const fallbackPlans: BotPlan[] = [
  { id: 'plan-7', name: '7 days', priceCents: 9900 },
  { id: 'plan-30', name: '30 days', priceCents: 29900 },
  { id: 'plan-90', name: '90 days', priceCents: 79900 }
];

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
  let plans: BotPlan[] = [];
  try {
    const loadedPlans = await apiGetPlans();
    plans = loadedPlans;
  } catch (error) {
    const details = formatBackendError(error);
    logger.error({ error, details }, 'Failed to load plans, using fallback plans');
    plans = fallbackPlans;
  }

  if (plans.length === 0) {
    plans = fallbackPlans;
  }

  const keyboard = new InlineKeyboard();
  for (const plan of plans) {
    keyboard.text(`${plan.name} • ${rub(plan.priceCents)}`, `plan:${plan.id}`).row();
  }

  await bot.api.sendMessage(chatId, 'Выберите тариф:', {
    reply_markup: keyboard
  });
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

async function openMenu(chatId: number, telegramId: string, bot: Bot): Promise<void> {
  try {
    const subscription = await apiGetSubscription(telegramId);
    if (subscription.status === 'active') {
      await sendProfile(chatId, telegramId, bot);
      return;
    }
  } catch (error) {
    const details = formatBackendError(error);
    logger.error({ error, details, telegramId }, 'Failed to fetch subscription while opening menu, fallback to plans');
  }

  await sendPlans(chatId, bot);
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

async function sendWebProfileLink(chatId: number, telegramId: string, bot: Bot): Promise<void> {
  const link = await apiCreateProfileLink(telegramId);
  if (isTelegramButtonUrlAllowed(link.url)) {
    await bot.api.sendMessage(chatId, 'Откройте профиль в браузере:', {
      reply_markup: new InlineKeyboard().url('Открыть профиль', link.url)
    });
    return;
  }

  await bot.api.sendMessage(
    chatId,
    [
      'Открыть профиль:',
      link.url,
      '',
      'URL-кнопка недоступна для localhost. Задайте публичный APP_BASE_URL/BACKEND_API_BASE_URL.'
    ].join('\n')
  );
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
      {
        reply_markup: new InlineKeyboard()
          .text('Старт', 'menu:start')
          .row()
          .text('Профиль', 'menu:profile')
      }
    );
  });

  bot.command('profile', async (ctx) => {
    try {
      if (!ctx.chat || !ctx.from) return;
      const telegramId = String(ctx.from.id);
      await sendWebProfileLink(ctx.chat.id, telegramId, bot);
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to handle /profile');
      await ctx.reply(`Не удалось открыть профиль: ${details}`);
    }
  });

  bot.callbackQuery('menu:start', async (ctx) => {
    try {
      if (!ctx.chat || !ctx.from) return;
      await ctx.answerCallbackQuery();

      const telegramId = String(ctx.from.id);
      await openMenu(ctx.chat.id, telegramId, bot);
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to handle start menu callback');
      await ctx.answerCallbackQuery({ text: 'Ошибка загрузки меню' }).catch(() => undefined);
      if (ctx.chat) {
        await ctx.reply('Сейчас не удалось открыть меню. Попробуйте еще раз чуть позже.');
      }
    }
  });

  bot.callbackQuery('menu:profile', async (ctx) => {
    try {
      if (!ctx.chat || !ctx.from) return;
      await ctx.answerCallbackQuery();
      const telegramId = String(ctx.from.id);
      await sendWebProfileLink(ctx.chat.id, telegramId, bot);
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to handle profile link callback');
      await ctx.answerCallbackQuery({ text: 'Ошибка открытия профиля' }).catch(() => undefined);
      if (ctx.chat) {
        await ctx.reply(`Не удалось открыть профиль: ${details}`);
      }
    }
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
    try {
      if (!ctx.from) return;
      const telegramId = String(ctx.from.id);
      await apiCancelSubscription(telegramId);
      await ctx.answerCallbackQuery();
      await ctx.reply('Подписка остановлена (status=blocked). Для возобновления выберите тариф и оплатите его заново.');
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to cancel subscription');
      await ctx.answerCallbackQuery({ text: 'Ошибка отмены' }).catch(() => undefined);
      await ctx.reply(`Не удалось остановить подписку: ${details}`);
    }
  });

  bot.callbackQuery('profile:qr', async (ctx) => {
    try {
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
    } catch (error) {
      const details = formatBackendError(error);
      logger.error({ error, details }, 'Failed to fetch VPN config');
      await ctx.answerCallbackQuery({ text: 'Ошибка получения конфига' }).catch(() => undefined);
      await ctx.reply(`Не удалось получить конфиг: ${details}`);
    }
  });

  bot.catch((error) => {
    logger.error({ error }, 'Telegram bot error');
  });

  return bot;
}
