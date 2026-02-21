import type { ProfilePageData, SetupPageData } from '../services/profileWebService';

type LayoutInput = {
  title: string;
  body: string;
};

type ProfileViewInput = {
  data: ProfilePageData;
  paymentStatus: 'succeeded' | 'failed' | null;
  canceled: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(input: LayoutInput): string {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <script>
      (function () {
        try {
          const saved = localStorage.getItem('kam_theme');
          if (saved === 'dark' || saved === 'light') {
            document.documentElement.dataset.theme = saved;
          } else {
            document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          }
        } catch {
          document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
      })();
    </script>
    <link rel="stylesheet" href="/profile/assets/profile.css" />
  </head>
  <body>
    <main class="wrap">
      <div class="topbar">
        <button class="btn" id="theme-toggle" type="button">Тема</button>
      </div>
      <section class="card">
        ${input.body}
      </section>
    </main>
    <script>
      (function () {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;

        function setTheme(theme) {
          document.documentElement.dataset.theme = theme;
        }

        function getCurrentTheme() {
          return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        }

        function applyLabel() {
          btn.textContent = getCurrentTheme() === 'dark' ? 'Светлая тема' : 'Тёмная тема';
        }

        btn.addEventListener('click', function () {
          const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
          setTheme(nextTheme);
          try {
            localStorage.setItem('kam_theme', nextTheme);
          } catch {}
          applyLabel();
        });

        try {
          if (!localStorage.getItem('kam_theme')) {
            const media = window.matchMedia('(prefers-color-scheme: dark)');
            media.addEventListener('change', function (event) {
              if (localStorage.getItem('kam_theme')) return;
              setTheme(event.matches ? 'dark' : 'light');
              applyLabel();
            });
          }
        } catch {}

        applyLabel();
      })();
    </script>
  </body>
</html>`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleString('ru-RU', { timeZone: 'UTC' });
}

export function renderExpiredPage(botOpenUrl: string): string {
  return layout({
    title: 'Ссылка устарела',
    body: `
      <h1>Ссылка устарела</h1>
      <p class="muted">Откройте профиль заново из Telegram-бота.</p>
      <div class="row">
        <a class="btn btn-primary" href="${escapeHtml(botOpenUrl)}">Открыть профиль в боте</a>
      </div>
    `
  });
}

export function renderProfilePage(input: ProfileViewInput): string {
  const statusLabel =
    input.data.status === 'active'
      ? 'Активна'
      : input.data.status === 'blocked'
        ? 'Остановлена'
        : 'Не активна';

  const paymentBanner =
    input.paymentStatus === 'succeeded'
      ? `<div class="banner">Оплата подтверждена. Информация обновлена.</div>`
      : input.paymentStatus === 'failed'
        ? `<div class="banner">Оплата завершилась с ошибкой. Попробуйте еще раз.</div>`
        : '';

  const cancelBanner = input.canceled ? `<div class="banner">Подписка остановлена.</div>` : '';
  const setupBanner = input.data.needsSetup
    ? `<div class="banner">Подписка куплена, но настройка не завершена. <a href="/profile/setup">Перейти к настройке</a>.</div>`
    : '';

  const noSubBlock = !input.data.hasAnySubscription
    ? `<p class="muted">Вы еще не покупали подписку.</p>`
    : '';

  return layout({
    title: 'Профиль',
    body: `
      <h1>Профиль</h1>
      <p><strong>Статус:</strong> ${statusLabel}</p>
      <p><strong>Тариф:</strong> ${escapeHtml(input.data.planName ?? '-')}</p>
      <p><strong>Срок подписки (UTC):</strong> ${formatDate(input.data.expiresAt)}</p>
      <p><strong>Осталось дней:</strong> ${input.data.daysLeft}</p>
      ${paymentBanner}
      ${cancelBanner}
      ${setupBanner}
      ${noSubBlock}

      <div class="row">
        <a class="btn" href="/profile/setup">Инструкции</a>
        <form method="POST" action="/profile/actions/renew">
          <button class="btn btn-primary" type="submit">Продлить</button>
        </form>
        <form id="cancel-form" method="POST" action="/profile/actions/cancel">
          <button class="btn btn-danger" id="cancel-open" type="button">Отменить</button>
        </form>
        <button class="btn" type="button" disabled>Пригласить друга (скоро)</button>
      </div>

      <div class="modal-backdrop" id="cancel-modal" aria-hidden="true">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
          <h3 id="cancel-title">Остановить подписку?</h3>
          <p>Доступ будет отключен, а профиль перейдет в статус «Остановлена».</p>
          <div class="row">
            <button class="btn btn-danger" id="cancel-confirm" type="button">Да, остановить</button>
            <button class="btn" id="cancel-close" type="button">Нет, оставить</button>
          </div>
        </div>
      </div>

      <script>
        const cancelForm = document.getElementById('cancel-form');
        const openBtn = document.getElementById('cancel-open');
        const closeBtn = document.getElementById('cancel-close');
        const confirmBtn = document.getElementById('cancel-confirm');
        const modal = document.getElementById('cancel-modal');

        function closeModal() {
          if (!modal) return;
          modal.classList.remove('open');
          modal.setAttribute('aria-hidden', 'true');
        }

        function openModal() {
          if (!modal) return;
          modal.classList.add('open');
          modal.setAttribute('aria-hidden', 'false');
        }

        if (openBtn) {
          openBtn.addEventListener('click', openModal);
        }
        if (closeBtn) {
          closeBtn.addEventListener('click', closeModal);
        }
        if (modal) {
          modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal();
          });
        }
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') closeModal();
        });
        if (confirmBtn && cancelForm) {
          confirmBtn.addEventListener('click', () => cancelForm.submit());
        }
      </script>
    `
  });
}

export function renderSetupPage(input: SetupPageData): string {
  const hasConfig = Boolean(input.vlessUri);
  const qrHtml = input.qrCodeDataUrl ? `<img class="qr" src="${input.qrCodeDataUrl}" alt="VPN QR code" />` : '';
  const safeVless = input.vlessUri ? escapeHtml(input.vlessUri) : '';

  return layout({
    title: 'Настройка',
    body: `
      <h1>Настройка подписки</h1>
      <p><strong>Тариф:</strong> ${escapeHtml(input.planName ?? '-')}</p>
      <p><strong>Срок подписки (UTC):</strong> ${formatDate(input.expiresAt)}</p>

      <section class="step active" id="step-1">
        <h2>Шаг 1. Выберите платформу</h2>
        <p class="muted">По умолчанию платформа выбирается автоматически.</p>
        <div class="platforms" id="platforms">
          <button class="platform-btn" type="button" data-platform="ios">iOS</button>
          <button class="platform-btn" type="button" data-platform="macos">macOS</button>
          <button class="platform-btn" type="button" data-platform="windows">Windows</button>
          <button class="platform-btn" type="button" data-platform="android">Android</button>
        </div>
        <div class="row">
          <button class="btn btn-primary" id="to-step-2" type="button" disabled>Далее</button>
        </div>
      </section>

      <section class="step" id="step-2">
        <h2>Шаг 2. Подключение</h2>
        ${
          hasConfig
            ? `
              <div class="center">${qrHtml}</div>
              <p class="muted">Отсканируйте QR-код в приложении VPN.</p>
              <div class="code" id="vless-code">${safeVless}</div>
              <div class="row">
                <button class="btn" id="copy-vless" type="button">Скопировать</button>
              </div>
            `
            : `
              <p>Конфиг пока не готов. Обновите страницу через несколько секунд.</p>
            `
        }
        <p class="muted" id="platform-hint"></p>
        <div class="row">
          <button class="btn btn-primary" id="to-step-3" type="button">Далее</button>
        </div>
      </section>

      <section class="step" id="step-3">
        <h2>Шаг 3. Готово</h2>
        <p>Настройка завершена. Перейдите в профиль.</p>
        <div class="row">
          <a class="btn btn-primary" href="/profile">Перейти в профиль</a>
        </div>
      </section>

      <script>
        const platforms = Array.from(document.querySelectorAll('[data-platform]'));
        const step1 = document.getElementById('step-1');
        const step2 = document.getElementById('step-2');
        const step3 = document.getElementById('step-3');
        const toStep2 = document.getElementById('to-step-2');
        const toStep3 = document.getElementById('to-step-3');
        const platformHint = document.getElementById('platform-hint');
        const copyBtn = document.getElementById('copy-vless');
        const vlessCode = document.getElementById('vless-code');
        let selectedPlatform = '';

        const hints = {
          ios: 'iOS: заглушка инструкции (позже подставим ассеты).',
          macos: 'macOS: заглушка инструкции (позже подставим ассеты).',
          windows: 'Windows: заглушка инструкции (позже подставим ассеты).',
          android: 'Android: заглушка инструкции (позже подставим ассеты).'
        };

        function detectPlatform() {
          const ua = navigator.userAgent.toLowerCase();
          if (ua.includes('android')) return 'android';
          if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
          if (ua.includes('mac os')) return 'macos';
          if (ua.includes('win')) return 'windows';
          return 'android';
        }

        function setPlatform(name) {
          selectedPlatform = name;
          toStep2.disabled = false;
          platforms.forEach((btn) => btn.classList.toggle('active', btn.dataset.platform === name));
          if (platformHint) {
            platformHint.textContent = hints[name] || '';
          }
        }

        platforms.forEach((btn) => {
          btn.addEventListener('click', () => setPlatform(btn.dataset.platform || ''));
        });

        toStep2.addEventListener('click', () => {
          step1.classList.remove('active');
          step2.classList.add('active');
        });

        toStep3.addEventListener('click', () => {
          step2.classList.remove('active');
          step3.classList.add('active');
        });

        if (copyBtn && vlessCode) {
          copyBtn.addEventListener('click', async () => {
            const value = vlessCode.textContent || '';
            try {
              await navigator.clipboard.writeText(value);
              copyBtn.textContent = 'Скопировано';
              setTimeout(() => { copyBtn.textContent = 'Скопировать'; }, 1200);
            } catch {
              copyBtn.textContent = 'Не удалось';
              setTimeout(() => { copyBtn.textContent = 'Скопировать'; }, 1200);
            }
          });
        }

        setPlatform(detectPlatform());
      </script>
    `
  });
}
