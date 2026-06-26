# 🚀 tg-ttn-bot — Швидкий старт

Telegram бот, який читає замовлення з групи/особистих повідомлень, парсить дані (ПІБ, телефон, місто, відділення, сума, тип оплати) і автоматично створює ТТН Нової Пошти.

---

## 📦 Що в архіві

| Файл / папка | Опис |
|---|---|
| `src/` | Весь код бота (TypeScript, 41 prod файл) |
| `prisma/schema.prisma` | Схема PostgreSQL (12 таблиць) |
| `Dockerfile` + `docker-compose.yml` | Full production stack |
| `ecosystem.config.cjs` | PM2 config (для 24/7 на ноуті) |
| `.env.example` | Шаблон конфігурації — копіюй у `.env` і заповнюй |
| `start.bat` | Дабл-клік → бот стартує в dev режимі (Windows) |
| `start-prod.bat` | Дабл-клік → PM2 deploy (24/7) |
| `package.json` | npm-скрипти |
| `README.md` | Огляд проєкту |
| `DEPLOY-LOCAL.md` | Детальний гайд по deploy |
| `PRODUCTION-AUDIT.md` | Production readiness аудит |
| `WAREHOUSE-SYNC.md` | Документація системи синхронізації відділень НП |
| `REFERENCE-PROJECTS.md` | Ресёрч схожих проєктів |
| **`QUICK-START.md`** | **Цей файл — швидкий гайд** |

---

## ⚡ TL;DR — поднять за 5 хвилин

```bash
# 1. Розпакувати архів (вже зроблено)
cd tg-ttn-bot

# 2. Скопіювати .env шаблон
cp .env.example .env

# 3. Відкрити .env і вписати:
#    TG_BOT_TOKEN=<токен від @BotFather>
#    ALLOWED_CHAT_IDS=<chat_id групи>  (або пусто = будь-який чат)

# 4. Встановити залежності і запустити
npm install
npx prisma generate
npm run dev
```

Бот стартує в **MOCK режимі** — створює фейкові ТТН (починаються з `9999`), реальний NP API не дзвонить. Ідеально для тестування парсера.

**Альтернатива:** дабл-клікни `start.bat` — він зробить усе автоматично.

---

## 📋 КРОК ЗА КРОКОМ

### Крок 1 — Telegram бот

#### 1.1 Створи бота (якщо ще немає)
1. Відкрий [@BotFather](https://t.me/BotFather)
2. `/newbot` → введи назву і username
3. Скопіюй **token** (виглядає як `1234567890:AAGgnMBLDa2fWdFW54jE0PktkCJI3n-CLUQ`)

#### 1.2 ⚠️ Вимкни Privacy Mode (КРИТИЧНО для груп!)
Без цього бот бачить у групі **тільки команди** `/start /help`, але НЕ звичайні повідомлення з замовленнями.

1. У [@BotFather](https://t.me/BotFather): `/mybots` → твій бот
2. **Bot Settings** → **Group Privacy** → **Turn off**
3. Очікувана відповідь: *"Privacy mode is disabled... The bot will receive all messages."*

#### 1.3 Додай бота в групу
1. Відкрий групу з замовленнями
2. ⚙ → Add Members → знайди свого бота
3. (Опц., але рекомендую) Зроби бота **адміном** — права: тільки Read + Send Messages

#### 1.4 Дізнайся `chat_id` групи
У групі напиши:
```
/whoami
```
Бот відповість:
```
Chat ID: -1001234567890
Type: supergroup
```
Запам'ятай це число (з мінусом!).

---

### Крок 2 — Налаштування `.env`

Скопіюй шаблон:
```bash
cp .env.example .env
```

Відкрий `.env` і заповни мінімум:
```bash
# ОБОВ'ЯЗКОВО
TG_BOT_TOKEN=1234567890:AAG...твій_токен...

# ОБОВ'ЯЗКОВО для груп — додай chat_id з кроку 1.4
# Якщо порожньо → бот працює в будь-якому чаті (тільки для dev!)
ALLOWED_CHAT_IDS=-1001234567890

# Можна додати кілька через кому:
# ALLOWED_CHAT_IDS=-1001234567890,7714034244
```

**Все інше можна залишити порожнім** — бот стартує в MOCK режимі.

---

### Крок 3 — Запуск (3 варіанти)

#### Варіант A — Dev (найпростіше, для тесту)
```bash
npm install
npx prisma generate
npm run dev
```
або просто **дабл-клік `start.bat`** на Windows.

✅ Авто-перезавантаження при змінах коду  
✅ Логи у консолі + `logs/bot.log`  
❌ Падає при закритті терміналу  
❌ Драфти в пам'яті — зникають при рестарті

#### Варіант B — PM2 (24/7 на ноуті, "deploy and forget")
```bash
npm install -g pm2 pm2-windows-startup
npm install
npx prisma generate
npx tsc -p tsconfig.json     # компіляція в dist/
pm2 start ecosystem.config.cjs
pm2 save
pm2-startup install          # auto-start при перезавантаженні Windows (run as Admin)
```
або просто **дабл-клік `start-prod.bat`**.

✅ Працює 24/7 у фоні  
✅ Авто-рестарт при крашах  
✅ Авто-старт при перезавантаженні Windows  
❌ Все ще in-memory state (без БД)

**PM2 команди:**
```bash
pm2 status                 # health всіх процесів
pm2 logs tg-ttn-bot        # live логи
pm2 restart tg-ttn-bot     # рестарт
pm2 stop tg-ttn-bot        # пауза
pm2 delete tg-ttn-bot      # видалити
```

#### Варіант C — Docker (full production stack)
Потрібен Docker Desktop. Запускає PostgreSQL + Redis + bot + worker одною командою.

```bash
docker compose up -d --build
docker compose exec bot npx prisma migrate deploy   # створити таблиці
docker compose logs -f bot                          # перевірити що працює
```

✅ Persistence — драфти переживають рестарт  
✅ Redis для черг / dedup / rate-limit  
✅ BullMQ worker — створення ТТН у фоні з retry  
✅ Готово до production навантаження  
✅ Auto-restart всіх контейнерів

**Docker команди:**
```bash
docker compose ps                 # статус
docker compose logs -f            # всі логи
docker compose restart bot        # рестарт одного сервісу
docker compose down               # зупинити
docker compose down -v            # + видалити БД (!)
```

---

### Крок 4 — Тестування

#### У DM з ботом:
Надішли тестове замовлення:
```
Іванова Олена Петрівна
+380501234567
Київ № 5
Сума: 2500
Quencher 40oz Cream
Накладений
```

Бот відповість preview з кнопками:
```
📋 Перевір замовлення перед створенням ТТН
🧪 MOCK режим — фейкова ТТН для тесту

👤 ПІБ: Іванова Олена Петрівна
📞 Тел: +380501234567
📦 Відділення №5
📍 Місто: Київ
💰 Сума: 2500 ₴
💳 Тип оплати: 🟢 COD (накладений)

[✅ Створити ТТН] [❌ Скасувати]
```

Натисни **✅ Створити ТТН** → отримаєш фейковий номер `99991234567890`.

#### У групі:
Просто відправ замовлення в будь-якому форматі — бот сам розпізнає і відповість preview.

---

## 🔥 Перехід на реальні ТТН (Phase 3)

Коли тестування закінчилось і хочеш створювати **справжні ТТН**:

### 4.1 Отримай NP API key
[my.novaposhta.ua](https://my.novaposhta.ua) → **Налаштування** → **Безпека** → скопіюй ключ.

### 4.2 Узнай sender Refs (5 UUID)
Використай Postman або curl:
```bash
# 1) Список твоїх отримувачів-відправників:
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "ТВІЙ_NP_API_KEY",
    "modelName": "Counterparty",
    "calledMethod": "getCounterparties",
    "methodProperties": { "CounterpartyProperty": "Sender" }
  }'
# → візьми Ref → це NP_SENDER_REF
```

### 4.3 Заповни `.env`:
```bash
NP_API_KEY=4ea83d36-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NP_SENDER_CITY_REF=8d5a980d-391c-11dd-90d9-001a92567626  # Київ за замовч.
NP_SENDER_WAREHOUSE_REF=...
NP_SENDER_REF=...
NP_SENDER_CONTACT_REF=...
NP_SENDER_PHONE=+380501234567
```

### 4.4 Перезапусти бота — в логах побачиш:
```
Mode: 🟢 PRODUCTION (real NP API)
```

### 4.5 (Опц.) Завантажити базу всіх відділень
```bash
npm run sync:warehouses
```
~15 хвилин — синхронізує всі ~28k міст + ~12k відділень/поштоматів в локальну БД. Парсер зможе резолвити **будь-яке село**, навіть якщо його немає в bundled-списку 428 міст.

Подальше оновлення — автоматично щонеділі о 03:00 (BullMQ cron у воркері).

---

## 📊 Чек-лист готовності до production

- [ ] `@BotFather` → Group Privacy **OFF**
- [ ] Бот доданий у групу
- [ ] `chat_id` групи прописаний у `ALLOWED_CHAT_IDS`
- [ ] `TG_BOT_TOKEN` — заповнений
- [ ] Запущений PM2 (`start-prod.bat`) АБО Docker (`docker compose up -d`)
- [ ] (Для реальних ТТН) `NP_API_KEY` + всі 5 `NP_SENDER_*` — заповнені
- [ ] (Опц.) `npm run sync:warehouses` — завантажена база
- [ ] PM2 auto-start: `pm2-startup install` АБО Docker `restart: unless-stopped`
- [ ] Тестове замовлення в групі → preview → кнопка → ТТН створено

---

## ✅ Що вміє бот

### Парсинг 233+ форматів повідомлень
- ✅ Всі 24 області України + 428 міст у bundled-словнику
- ✅ Латинські назви: `Kyiv → Київ`, `Lviv → Львів`
- ✅ Опечатки міст: `Харкрів → Харків` (Levenshtein fuzzy match)
- ✅ Різні формати телефону: `+380501234567`, `0501234567`, `+380 (99) 259 13 25`, `(067) 123-45-67`
- ✅ Префікси: "Відправка на ім'я", "Отримувач:", "ПІБ:"
- ✅ Емодзі-розмітка: `📦 👤 📱 🏙 🏤 💰`
- ✅ Multi-order — кілька замовлень в одному повідомленні
- ✅ Опечатки в типах оплати: `НАДОЖКА → НАЛОЖКА`, `Паштомат/Почтомат → Поштомат`
- ✅ "Опл XXXX", "наложка XXXX", "сума XXXX", "оплата при отриманні"
- ✅ Курьерська доставка: "АДРЕСНАЯ ДОСТАВКА" → courier mode
- ✅ One-line orders: "Романська Марія 0951047738 Львів НП 24 2499"
- ✅ Кодування поштоматів: 5-значні номери → postomat, 1-4 → branch

### Тип оплати (Scoring engine)
- 🟢 **COD** (накладений): "наложка", "післяплата", "опл XXXX", "оплата при отриманні", "cash on delivery"
- 🔵 **Prepaid**: "передоплата", "100% оплачено", "paid", "карта", "Приват24", "mono"
- ⚠️ Враховує "БЕЗ наложки", "вже оплачено наперед" — правильно класифікує як Prepaid

### Архітектура
- ✅ Idempotency: створення ТТН захищено 4 рівнями захисту (BullMQ jobId + DB unique + pre-check + race resolution)
- ✅ Rate limiting: per-user + global, Redis Lua token-bucket
- ✅ NP API: token-bucket throttling (8 req/s), 3 retries + exponential backoff
- ✅ 7-day cache для NP city/warehouse lookups
- ✅ Graceful shutdown: SIGTERM → drain in-flight → close connections
- ✅ Correlation IDs: requestId автоматично пробрасується через всі async виклики
- ✅ Soft-delete: жодних DELETE — `isActive=false` зберігає історію

---

## 🐛 Troubleshooting

### Бот не відповідає в групі
```bash
# Перевір privacy mode:
curl "https://api.telegram.org/bot<TOKEN>/getMe"
# → "can_read_all_group_messages": true
```
Якщо `false` — повернись до **Кроку 1.2**.

### "Chat is not in whitelist"
- Запусти `/whoami` у потрібному чаті, скопіюй chat_id
- Додай у `ALLOWED_CHAT_IDS` (через кому)
- Перезапусти бота

### "Місто X не знайдено в НП"
- **MOCK режим**: будь-яке місто має прийматись. Якщо не приймає — це bug, надішли в issue.
- **PROD режим**: запусти `npm run sync:warehouses` щоб оновити базу.

### Помилки TypeScript при `npx tsc`
```bash
npm install
npx prisma generate
npx tsc --noEmit -p tsconfig.json
```

### Бот падає одразу після старту
- Перевір `.env` — `TG_BOT_TOKEN` заповнений?
- Перевір логи: `cat logs/bot.log | tail -50`

---

## 📁 Структура проєкту

```
tg-ttn-bot/
├── src/
│   ├── shared/                      # config (zod), logger (pino), result, AppError
│   ├── domain/
│   │   ├── value-objects/           # Phone, Money (immutable, self-validating)
│   │   └── order-fingerprint.ts     # Dedup + Levenshtein similarity
│   ├── application/
│   │   ├── ports/                   # Repository + NP + AI interfaces
│   │   └── use-cases/               # IngestMessage, CreateTtn, SyncWarehouses
│   ├── infrastructure/
│   │   ├── parser/                  # Parser engine + payment classifier + city dict
│   │   ├── ai/                      # Claude API fallback
│   │   ├── nova-poshta/             # HTTP client + token-bucket + 7d cache
│   │   ├── persistence/             # 7 Prisma repos
│   │   ├── redis/                   # Distributed rate-limiter (Lua)
│   │   └── telegram/                # grammY adapter
│   ├── presentation/
│   │   ├── bot/                     # Thin handlers + views
│   │   └── admin/                   # Fastify admin API (stub)
│   ├── jobs/                        # BullMQ queues + worker + sync CLI
│   ├── main.container.ts            # DI composition root
│   ├── main.ts                      # Entry point + graceful shutdown
│   └── index.ts                     # Legacy entry (current `npm run dev`)
├── prisma/schema.prisma             # 12 tables, 30+ indexes
├── tests (264 in 15 suites)         # parser/chaos/perf/VO/sync/payment-classifier
├── Dockerfile + docker-compose.yml  # Full prod stack
├── ecosystem.config.cjs             # PM2 config
├── start.bat / start-prod.bat       # Windows quick-start scripts
└── docs:
    ├── QUICK-START.md               # цей файл
    ├── DEPLOY-LOCAL.md              # detailed deploy guide
    ├── PRODUCTION-AUDIT.md          # production readiness review
    ├── WAREHOUSE-SYNC.md            # NP sync system docs
    ├── REFERENCE-PROJECTS.md        # ресёрч схожих проєктів
    └── README.md
```

---

## 📞 Корисні посилання

- [Nova Poshta API docs](https://developers.novaposhta.ua/documentation)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [grammY framework](https://grammy.dev)
- [Prisma ORM](https://www.prisma.io/docs)
- [BullMQ](https://docs.bullmq.io)

---

**Бот має token який вже працює:** `@Nono827272_bot` — можеш тестити одразу через `npm run dev`.

Готовий до production коли підключиш реальний `NP_API_KEY`. Архітектура витримує 50+ менеджерів × тисячі ТТН/день.
