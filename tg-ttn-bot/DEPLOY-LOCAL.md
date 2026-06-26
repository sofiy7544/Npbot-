# Локальный deploy + подключение группы — пошагово

## Phase 1: Включить чтение сообщений в группе

Сейчас бот видит только команды `/` в группе (privacy mode ON по умолчанию). Чтобы он читал ВСЕ сообщения с заказами — выключаем privacy.

### Шаг 1.1 — @BotFather
1. Открой Telegram → [@BotFather](https://t.me/BotFather)
2. `/mybots` → выбери **@Nono827272_bot**
3. **Bot Settings** → **Group Privacy** → **Turn off**
4. Bot должен ответить: *"Privacy mode is disabled for ... The bot will receive all messages."*

### Шаг 1.2 — Добавить бота в группу
1. Открой свою группу с заказами в Telegram
2. ⚙ Settings → **Add Members** → найди `@Nono827272_bot`
3. Сделай бота **админом** (опционально, но рекомендую — admin = бот видит даже edited messages и forwards)
4. Снять у бота лишние права: достаточно **Read Messages + Send Messages**

### Шаг 1.3 — Узнать `chat_id` группы
В группе напиши: `/whoami`
Бот ответит:
```
Chat ID: -1001234567890
Type: supergroup
```

Скопируй `chat_id` (с минусом!).

### Шаг 1.4 — Добавить chat_id в whitelist
Открой `tg-ttn-bot/.env`:
```bash
ALLOWED_CHAT_IDS=-1001234567890,7714034244
```
(через запятую — твой DM ID `7714034244` уже есть, добавь group ID)

Бот авто-перезагрузится через `tsx watch` → теперь читает группу.

---

## Phase 2: Local deploy (3 варианта)

### Вариант A — Самый простой (сейчас работает)
```bash
cd tg-ttn-bot
npm run dev
```
- ✅ MOCK режим (фейковые TTN)
- ✅ tsx watch — авто-перезагрузка при изменениях
- ❌ Падает когда закрываешь терминал
- ❌ В памяти state — драфты теряются при рестарте

**Для теста — идеально.**

### Вариант B — PM2 (production-like без Docker)
Бот работает 24/7 на ноуте даже после перезагрузки, авторестарт при крашах.

```bash
# 1. Установить PM2 (один раз)
npm install -g pm2

# 2. Сборка
cd tg-ttn-bot
npx tsc -p tsconfig.json   # компилируем в dist/

# 3. Запуск
pm2 start ecosystem.config.cjs

# 4. Авто-старт при перезагрузке системы (Windows: используй pm2-windows-startup)
pm2 startup
pm2 save

# Команды:
pm2 status              # статус всех процессов
pm2 logs tg-ttn-bot     # просмотр логов
pm2 restart tg-ttn-bot  # рестарт
pm2 stop tg-ttn-bot     # остановить
pm2 delete tg-ttn-bot   # удалить из PM2
```

- ✅ 24/7 без терминала
- ✅ Авто-рестарт при крашах
- ✅ Авто-старт при перезагрузке системы
- ❌ Всё ещё in-memory state

### Вариант C — Docker (full production stack)
PostgreSQL + Redis + bot + worker запускаются одной командой.

**Требования:** Docker Desktop установлен на Windows.

```bash
cd tg-ttn-bot

# 1. Создать .env из примера
cp .env.example .env
# Заполнить: TG_BOT_TOKEN, ALLOWED_CHAT_IDS (см. Phase 1)
# NP_API_KEY можно оставить пустым (MOCK режим)

# 2. Запустить весь стек
docker compose up -d --build

# 3. Применить миграции БД
docker compose exec bot npx prisma migrate deploy

# 4. Проверить что всё работает
docker compose ps                       # все 4 сервиса = Up
docker compose logs -f bot              # логи бота в реальном времени
docker compose logs -f worker           # логи воркера (BullMQ)
```

- ✅ Постоянный state (PostgreSQL)
- ✅ Redis для очередей/dedup/rate-limit
- ✅ BullMQ worker (создание TTN в фоне с retry)
- ✅ Auto-restart всех контейнеров
- ✅ Все драфты переживают рестарт
- ✅ Готов к production-нагрузке

**Stop / restart:**
```bash
docker compose stop                     # пауза
docker compose start                    # запуск назад
docker compose down                     # полная остановка
docker compose down -v                  # + удалить volumes (БД сотрётся!)
```

---

## Phase 3: Переход с MOCK на реальный NP

Когда хочешь создавать НАСТОЯЩИЕ ТТН:

### Шаг 3.1 — Получить API key
1. Зайди в [my.novaposhta.ua](https://my.novaposhta.ua) → **Налаштування** → **Безпека**
2. Скопируй **API ключ** (формат UUID, например `4ea83d36...`)

### Шаг 3.2 — Узнать sender refs
Нужны 5 UUID'ов отправителя. Самый простой способ — через Postman:

```bash
# Список твоих counterparties (отправителей)
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "ВАШ_API_KEY",
    "modelName": "Counterparty",
    "calledMethod": "getCounterparties",
    "methodProperties": { "CounterpartyProperty": "Sender" }
  }'

# Из ответа возьми Ref → это твой NP_SENDER_REF

# Контактные лица отправителя:
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -d '{
    "apiKey": "...",
    "modelName": "Counterparty",
    "calledMethod": "getCounterpartyContactPersons",
    "methodProperties": { "Ref": "NP_SENDER_REF_ИЗ_ВЫШЕ" }
  }'

# Из ответа возьми Ref → NP_SENDER_CONTACT_REF, Phones[0] → NP_SENDER_PHONE
```

### Шаг 3.3 — Заполнить .env
```bash
NP_API_KEY=4ea83d36-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NP_SENDER_CITY_REF=8d5a980d-391c-11dd-90d9-001a92567626   # UUID міста відправника (Київ для більшості)
NP_SENDER_WAREHOUSE_REF=...                                # UUID твого відділення-відправника
NP_SENDER_REF=...                                          # Counterparty UUID
NP_SENDER_CONTACT_REF=...                                  # ContactPerson UUID
NP_SENDER_PHONE=+380501234567                              # твій телефон
```

### Шаг 3.4 — Перезапустить
```bash
# Если PM2:
pm2 restart tg-ttn-bot

# Если Docker:
docker compose restart bot worker

# Если dev mode (tsx watch):
# само перезагрузится
```

При старте увидишь в логах:
```
Mode: 🟢 PRODUCTION (real NP API)
```

### Шаг 3.5 — Заполнить базу отделений (опционально, рекомендую)
```bash
npm run sync:warehouses
# или внутри docker:
docker compose exec worker npm run sync:warehouses
```
Это займёт ~15 минут — синхронизирует все ~28k міст + ~12k відділень/поштоматів в локальную БД. Дальше парсер сможет резолвить ЛЮБОЕ село через DB lookup (не только bundled 428).

---

## ✅ Чек-лист "Готово к проду"

- [ ] @BotFather — Group Privacy OFF
- [ ] Бот добавлен в группу
- [ ] `chat_id` группы записан в `ALLOWED_CHAT_IDS`
- [ ] Запущен PM2 или Docker (не tsx watch)
- [ ] `NP_API_KEY` заполнен (для реальных TTN)
- [ ] Все 5 `NP_SENDER_*` заполнены
- [ ] (Опц.) `npm run sync:warehouses` запущен — полная база
- [ ] `pm2 startup` или `docker compose` с `restart: unless-stopped` — авто-старт

---

## Troubleshooting

### Бот не отвечает в группе
- Проверь Privacy: `curl getMe` должен показать `can_read_all_group_messages: true`
  ```bash
  curl -s "https://api.telegram.org/botТВОЙ_TOKEN/getMe"
  ```
- Проверь whitelist: твой `ALLOWED_CHAT_IDS` содержит chat_id группы (с минусом!)
- Перезагрузи бота после изменения `.env`

### "Chat is not in whitelist"
Бот ответит этим в первом сообщении. Возьми chat_id из ответа `/whoami` и добавь в `ALLOWED_CHAT_IDS`.

### "Місто X не знайдено в НП"
- В MOCK режиме — любой город принимается. Если ошибка — значит `NP_API_KEY` уже подключён, но город опечатан. Используй точное название с КП Нової Пошти.
- В реал режиме — запусти `npm run sync:warehouses` чтобы база была актуальная.

### TypeScript errors при `npx tsc`
```bash
npm install                  # переустановить
npx prisma generate          # пересоздать Prisma client
npx tsc --noEmit -p tsconfig.json
```

### PM2 не стартует на Windows boot
```bash
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

### Docker compose: postgres conection refused
Бот пытается подключиться раньше чем PG готов. Перезапусти:
```bash
docker compose restart bot worker
```
(в `docker-compose.yml` у меня уже стоит `depends_on: postgres: condition: service_healthy`, но иногда нужен ручной рестарт)
