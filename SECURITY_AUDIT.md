# Security Audit (Stage 6)

Дата аудита: 2026-02-14

## Критичные риски, которые закрыты

1. Жестко заданные DB credentials в `docker-compose`.
- Было: `postgres/postgres` в файле.
- Стало: значения берутся из `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

2. Утечка секретов в логах.
- Было: без редактирования чувствительных полей.
- Стало: `pino` redaction для `authorization`, `password`, `token`, `secret`, `cookie`, `set-cookie`.

3. Нестрогая проверка admin bearer token.
- Было: простое строковое сравнение.
- Стало: парсинг Bearer + timing-safe comparison (`timingSafeEqual`).

4. Избыточная экспозиция DB порта.
- Было: `5432:5432` на все интерфейсы.
- Стало: `127.0.0.1:5432:5432`.

## Укрепления backend

- Отключен `x-powered-by`.
- Добавлены базовые security headers:
  - `x-content-type-options: nosniff`
  - `x-frame-options: DENY`
  - `referrer-policy: no-referrer`
  - `permissions-policy`
  - CSP для `/fakepay/checkout`
- Ограничен JSON body size (`64kb`).

## Риски, требующие операционных мер

1. Секреты в `.env` должны быть уникальными и не должны попадать в git.
- Обязательно сгенерировать:
  - `POSTGRES_PASSWORD`
  - `FAKEPAY_WEBHOOK_SECRET`
  - `ADMIN_TOKEN`
- `BOT_TOKEN`, `THREEXUI_PASSWORD` хранить только локально/в секрет-сторе.

2. Для production:
- ставить backend за reverse proxy с TLS;
- ограничить доступ к `/api/admin/*` по IP allowlist + отдельный admin gateway;
- включить fail2ban/rate limit на публичных endpoints;
- использовать отдельного DB пользователя с минимальными правами.

3. После утечки токенов:
- немедленно перевыпускать `BOT_TOKEN` и менять пароль 3x-ui.
