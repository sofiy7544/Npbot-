# Деплой бота в хмару (24/7, без домашнього ПК)

Мета: бот живе на сервері й створює ТТН цілодобово, навіть коли комп'ютер
вимкнений. Локальний запуск описаний у `DEPLOY-LOCAL.md` — цей файл про хмару.

Основний шлях тут — **Railway**: в одному проєкті є і Postgres, і Redis, деплой
іде прямо з `Dockerfile`, а боту не потрібен публічний домен (він працює на
long-polling, тобто сам ходить до Telegram). Render і Fly.io — наприкінці.

---

## Що саме деплоїться

Два процеси з **одного й того самого образу**:

| Сервіс | Команда | Навіщо | Обов'язковий? |
|---|---|---|---|
| `bot` | `npm run start:migrate` | читає чат, парсить, створює ТТН | **так** |
| `worker` | `npm run start:worker` | щотижнева синхронізація відділень НП + прибирання прострочених чернеток | ні, але бажаний |

ТТН створюється **всередині процесу `bot`**, а не через чергу — тож без
`worker` бот повністю робочий. `worker` потрібен, щоб довідник відділень НП не
застарівав і щоб протерміновані чернетки не накопичувались у базі.

`npm run start:migrate` перед стартом накатує міграції Prisma
(`prisma migrate deploy`). CLI Prisma лежить усередині образу, тому нічого не
тягнеться з npm під час запуску.

---

## Railway — покроково

### Крок 1. Проєкт і база
1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → `Npbot-`.
2. У проєкті: **New** → **Database** → **Add PostgreSQL**.
3. Ще раз: **New** → **Database** → **Add Redis**.

### Крок 2. Сервіс `bot`
У налаштуваннях сервісу, створеного з репозиторію:

- **Settings → Service Name** → `bot`
- **Settings → Root Directory** → `tg-ttn-bot`
  (репозиторій — монорепо; без цього Railway збиратиме сайт із кореня)
- **Settings → Config as code** → `railway.json`

### Крок 3. Змінні
**Variables** сервісу `bot`. Повний список із поясненнями — у
`.env.production.example`; мінімум:

```
NODE_ENV=production
TG_BOT_TOKEN=<токен від @BotFather>
ALLOWED_CHAT_IDS=<-1001234567890,7714034244>
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

`${{Postgres.DATABASE_URL}}` — не текст, а посилання на змінну сусіднього
сервісу: Railway підставить справжній рядок і оновить його, якщо база
переїде. `PORT` Railway додає сам — health-сервер слухає саме його.

`NP_API_KEY` поки не заповнюй: без нього бот у MOCK-режимі й видає фейкові ТТН
`9999...`. Спочатку переконайся, що бот взагалі відповідає, і лише потім
вмикай реальну Нову Пошту (Крок 6).

### Крок 4. Сервіс `worker`
**New** → **GitHub Repo** → той самий репозиторій. Далі так само:

- **Service Name** → `worker`
- **Root Directory** → `tg-ttn-bot`
- **Config as code** → `railway.worker.json`
- **Variables** — ті самі, що й у `bot`

Різниця лише в конфізі: `worker` стартує `npm run start:worker` і не має
health-перевірки, бо не слухає жодного порту.

### Крок 5. Перевірка
1. **Deployments → Logs** сервісу `bot`. Очікувано:
   ```
   app.starting   mode: "MOCK"
   tg.polling_mode
   tg.started     username: "..."
   health.listening
   app.ready
   ```
2. У Telegram напиши боту `/whoami` — відповість ID чату.
3. Надішли тестове замовлення:
   ```
   Іванова Олена Петрівна
   +380501234567
   Київ № 5
   Опл 2500
   ```
   Бот покаже preview з кнопкою **«Створити ТТН»** → фейковий номер `9999...`.

Якщо бот мовчить у **групі** — вимкни Privacy Mode: @BotFather → `/mybots` →
бот → Bot Settings → Group Privacy → **Turn off**. Інакше бот бачить лише
команди з `/`. Далі — додай chat_id групи в `ALLOWED_CHAT_IDS`.

### Крок 6. Реальні ТТН
Коли mock відпрацював — додай у змінні `bot` (і `worker`):

```
NP_API_KEY=<ключ із кабінету НП>
NP_SENDER_CITY_REF=...
NP_SENDER_WAREHOUSE_REF=...
NP_SENDER_REF=...
NP_SENDER_CONTACT_REF=...
NP_SENDER_PHONE=+380...
```

Де брати Refs — `QUICK-START.md`, розділ «Phase 3». Після збереження Railway
перезапустить сервіс, і в логах `mode` зміниться на `PRODUCTION`.
**Наступна ТТН буде справжньою і платною.**

---

## Гроші

Railway: ~$5/міс кредиту на Hobby-плані. Бот у спокої з'їдає мало, але
Postgres + Redis + два сервіси в сумі зазвичай виходять за безплатний кредит —
рахуй на ~$5–10/міс. Якщо треба дешевше: не піднімай `worker` — тоді
синхронізацію відділень запускай зрідка руками. Локально, з `DATABASE_URL`, що
вказує на хмарну базу: `npm run sync:warehouses`. В образі (Railway → Shell)
tsx немає, тому там — `node dist/jobs/warehouse-sync-cli.js`.

---

## Render

Blueprint-файл (`render.yaml`) тут навмисно не доданий: перевірити його
синтаксис проти живої документації Render із цього середовища не вийшло, а
неробочий конфіг гірший за його відсутність. Тому — через дашборд:

1. **New → Postgres**, **New → Key Value** (так тепер зветься Redis).
2. **New → Web Service** → репозиторій → **Root Directory** `tg-ttn-bot`,
   **Runtime** `Docker`, **Start Command** `npm run start:migrate`,
   **Health Check Path** `/health`.
3. **New → Background Worker** → те саме, але **Start Command**
   `npm run start:worker`, без health-перевірки.
4. Змінні — як у Кроці 3, `DATABASE_URL` і `REDIS_URL` взяти з дашбордів
   створених баз (внутрішні URL, не зовнішні).

Важливо: на безплатному плані Render присипляє web-сервіси без трафіку.
Боту на long-polling це ламає роботу — для Render потрібен платний план.

## Fly.io

1. `fly launch --no-deploy` у теці `tg-ttn-bot` (підхопить `Dockerfile`).
2. `fly postgres create` + `fly redis create`, далі `fly postgres attach` —
   він сам пропише `DATABASE_URL`.
3. Решта змінних: `fly secrets set TG_BOT_TOKEN=... ALLOWED_CHAT_IDS=...`
4. У `fly.toml` став команду `npm run start:migrate`, а `auto_stop_machines`
   вимкни — інакше машина засне й бот перестане читати чат.
5. Redis у Fly (Upstash) віддає `rediss://` — TLS. Код це тримає.

---

## Що варто знати (граблі цього проєкту)

- **Webhook-режим не реалізований.** HTTP-приймача апдейтів у коді немає. Якщо
  виставити `TG_WEBHOOK_URL`, бот впаде на старті з явною помилкою — навмисно:
  інакше Telegram перестав би слати апдейти через `getUpdates`, і бот мовчки
  «оглух» би. У хмарі працює long-polling.
- **`ADMIN_API_TOKEN` лишай порожнім** — admin-сервера в коді ще немає.
- **Один екземпляр бота.** Два процеси з одним токеном на long-polling
  конфліктують у Telegram (`409 Conflict`). Не став `numReplicas > 1` і не
  тримай бота локально одночасно з хмарним.
- **Міграції.** Початкова міграція лежить у `prisma/migrations/0_init/`.
  Схему міняєш — роби `npx prisma migrate dev --name <опис>` локально й комить
  результат, інакше в проді таблиці не з'являться.
- **Health-сервер** слухає лише тоді, коли задано `PORT`. Локально й у
  docker-compose нічого не займає порт. `GET /health` → 200, якщо живі і
  Postgres, і Redis; 503 — якщо ні.
