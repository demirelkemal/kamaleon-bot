# Kamaleon VPN Bot

Backend + Telegram bot для подписки VPN (VLESS), управление доступом через 3x-ui, тестовые платежи через FakePay.

## 1. Подготовка окружения

1. Скопируйте пример env:
```bash
cp .env.example .env
```

2. Заполните обязательные поля в `.env`:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL`
- `FAKEPAY_WEBHOOK_SECRET`
- `ADMIN_TOKEN`
- `BOT_TOKEN`
- `THREEXUI_BASE_URL`, `THREEXUI_WEBBASEPATH`, `THREEXUI_USERNAME`, `THREEXUI_PASSWORD`, `THREEXUI_INBOUND_ID`
- `VPN_PUBLIC_*`

Примечание: для локального теста оставьте:
- `APP_BASE_URL=http://localhost`
- `BACKEND_API_BASE_URL=http://127.0.0.1:3000`

## 2. Запуск

```bash
docker compose up -d --build
```

Контейнер `app` при старте выполняет:
- `npx prisma migrate deploy`
- запуск сервера `node dist/src/index.js`

Проверка здоровья:
```bash
curl http://127.0.0.1/health
```

## 3. Ручной тест API (curl)

### 3.1 Планы
```bash
curl http://127.0.0.1/api/plans
```

### 3.2 Создать пользователя
```bash
curl -X POST http://127.0.0.1/api/users/telegram \
  -H "content-type: application/json" \
  -d '{"telegramId":"291249764"}'
```

### 3.3 Создать заказ
```bash
curl -X POST http://127.0.0.1/api/orders \
  -H "content-type: application/json" \
  -d '{"telegramId":"291249764","planId":"<PLAN_ID_ИЗ_/api/plans>"}'
```

Ответ вернет:
- `orderId`
- `paymentUrl`

### 3.4 Подтвердить оплату через браузер
Откройте `paymentUrl` и нажмите `Оплатить успешно`.

### 3.5 Проверить заказ
```bash
curl http://127.0.0.1/api/orders/<ORDER_ID>
```
Ожидается `status: "paid"`.

### 3.6 Проверить подписку
```bash
curl "http://127.0.0.1/api/subscription?telegramId=291249764"
```
Ожидается `status: "active"`.

### 3.7 Проверить VPN конфиг и QR
```bash
curl "http://127.0.0.1/api/vpn/config?telegramId=291249764"
```
Ожидается:
- `status: "ready"`
- `vlessUri`
- `qrCodeDataUrl`

### 3.8 Ручной догон провижининга (если нужно)
```bash
curl -X POST "http://127.0.0.1/api/admin/provision?telegramId=291249764" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## 4. Ручной тест Telegram Bot

1. Откройте бота и отправьте `/start`.
2. Нажмите кнопку `Старт`.
3. Выберите тариф.
4. Скопируйте ссылку оплаты и откройте ее в браузере на той же машине, где запущен backend.
5. Нажмите `Оплатить успешно`.
6. Вернитесь в бота, нажмите `Получить QR/Инструкции`.
7. Проверьте, что бот отправил:
- PNG QR
- текст с VLESS URI

Дополнительно:
- `Продлить` -> оплата -> увеличение `daysLeft`
- `Остановить` -> `Да` -> статус подписки `blocked` и удаление клиента из 3x-ui

## 5. Проверка 3x-ui

После успешной оплаты:
- в панели 3x-ui в inbound (`THREEXUI_INBOUND_ID`) должен появиться клиент.

После остановки:
- клиент должен быть удален из 3x-ui.

## 6. Формула VLESS URI

Если 3x-ui не отдает готовую ссылку, URI собирается так:

`vless://{uuid}@{VPN_PUBLIC_HOST}:{VPN_PUBLIC_PORT}?type={VPN_PUBLIC_TYPE}&security={VPN_PUBLIC_SECURITY}&sni={VPN_PUBLIC_SNI}&pbk={VPN_PUBLIC_PBK}&fp={VPN_PUBLIC_FP}&sid={VPN_PUBLIC_SID}&spx={VPN_PUBLIC_SPX}&flow={VPN_PUBLIC_FLOW}#{VPN_PUBLIC_TAG_TEMPLATE}`

Где `{VPN_PUBLIC_TAG_TEMPLATE}` поддерживает плейсхолдер `{telegramId}`.

## 7. Безопасность

См. `SECURITY_AUDIT.md`.
# kamaleon-bot
# kamaleon-bot

## 8. GitHub Actions деплой

Добавлен workflow `.github/workflows/deploy.yml`:
- запускается на `push` в `main` и вручную через `workflow_dispatch`;
- выполняет `npm ci`, `npm run build`, `npm test`;
- при успехе деплоит на сервер по SSH, делает `git pull` и `docker compose up -d --build --remove-orphans`.

### GitHub Secrets, которые нужно создать

Обязательные:
- `DEPLOY_HOST` — IP/домен сервера.
- `DEPLOY_USER` — SSH-пользователь.
- `DEPLOY_SSH_KEY` — приватный SSH-ключ (лучше отдельный deploy key).
- `DEPLOY_PATH` — абсолютный путь до репозитория на сервере.

Опционально:
- `DEPLOY_PORT` — SSH-порт (по умолчанию `22`).

### Что должно быть подготовлено на сервере
- установлен Docker + Docker Compose Plugin;
- репозиторий уже склонирован в `DEPLOY_PATH`;
- в рабочей папке настроен `.env` со всеми runtime-переменными;
- пользователь имеет права на чтение/запись в `DEPLOY_PATH`.

## 9. Deploy Smoke Check

После автодеплоя проверьте:

```bash
curl -fsS http://127.0.0.1/health
```
