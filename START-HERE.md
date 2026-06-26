# 🚀 Локальний запуск на ПК

Найпростіший шлях — запустити **сайт** і **бота** локально для тесту.
Бот працює в **MOCK-режимі**: створює фейкові ТТН (`9999...`), без бази даних,
без ключів Нової Пошти. Потрібно тільки токен бота від @BotFather.

## Що встановити один раз
- **Node.js 20+** — https://nodejs.org (для бота)
- **Python 3** — https://python.org (для сайту; при встановленні ✅ "Add to PATH")

---

## Windows — найшвидше

Подвійний клік на **`start-all.bat`** у корені — відкриються два вікна:
- сайт → http://localhost:8000 (адмінка: `/admin.html`)
- бот (MOCK)

Або по окремості:
- сайт: `stanley-brand-site\start-site.bat`
- бот: `tg-ttn-bot\start-local.bat`

При першому запуску бота відкриється Блокнот із `.env` — впиши свій
`TG_BOT_TOKEN`, збережи, закрий, запусти ще раз.

## macOS / Linux
```bash
# сайт
cd stanley-brand-site && ./start-site.sh
# бот (в іншому терміналі)
cd tg-ttn-bot && cp .env.example .env   # впиши TG_BOT_TOKEN у .env
./start-local.sh
```

---

## Як перевірити бота
1. У Telegram напиши своєму боту тестове замовлення:
   ```
   Іванова Олена Петрівна
   +380501234567
   Київ № 5
   Опл 2500
   ```
2. Бот покаже preview з кнопкою **«Створити ТТН»** → видасть фейковий номер `9999...`.

> Для груп вимкни Privacy Mode: @BotFather → /mybots → бот → Bot Settings →
> Group Privacy → Turn off.

---

## Коли захочеш «по-дорослому»
- **Реальні ТТН:** впиши `NP_API_KEY` + sender Refs у `tg-ttn-bot/.env`
  (див. `tg-ttn-bot/QUICK-START.md`, розділ Phase 3).
- **Повний бот (черги, БД, історія):** `tg-ttn-bot/start.bat` або
  `docker compose up -d --build` — це режим `main.ts`, якому потрібні
  **Postgres + Redis** (тому для простого тесту бери `start-local.bat`).
- **Бекенд сайту (оплата Monobank + форвард у Telegram):**
  `stanley-brand-site/backend/` — скопіюй `.env.example` → `.env`, заповни,
  `npm install && node server.js`.

## ⚠️ Безпека
Не коміть реальні токени. У `.env` тримай їх лише локально (`.env` уже в
`.gitignore`). Якщо твій токен десь засвітився — відклич у @BotFather (`/revoke`).
