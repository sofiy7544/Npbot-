# SECURITY — INTELLECT 2.0

## Секреты
- Ключи/токены только в `.env` (в `.gitignore`), в коде — тип `Secret`,
  маскируется в логах/repr/describe().
- В логи бота токен не попадает (приглушён httpx-логгер).
- Журнал действий (`audit_logs`) чистит секреты regex-ом (`security.redact`).

## Доступ
- Telegram: только `ALLOWED_USERS` (+ пароль доступа для новых).
- Веб-панель: пароль `ACCESS_PASSWORD` (заголовок `X-Intellect-Token`),
  все `/api/*` возвращают 401 без него.
- Роли admin/user (`security.roles`).

## Опасные действия (требуют подтверждения)
`computer.shutdown/restart/kill_process`, `files.delete`, `network.change`,
`memory.wipe`, `devices.bulk`. AI НЕ выполняет их без явного подтверждения
пользователя (инлайн-кнопка в Telegram). AI НЕ исполняет произвольные
shell-команды — только инструменты из белого списка; запуск/убийство процессов
ограничены whitelists.

## Сеть
- Устройства — только локальная сеть (WLED/TV по 192.168.x).
- Наружу ходит только к Telegram и OpenAI. Проброс портов не требуется.

## Осталось (roadmap безопасности)
- Rate-limit на веб-API, CSRF-токен для мутаций, HTTPS для панели (сейчас
  LAN-only). Шифрование БД при желании.
