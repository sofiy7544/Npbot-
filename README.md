# Npbot — Stanley Brand UA: site + TTN bot

Монорепозиторій із двох проєктів, що працюють разом для дропшип-магазину
термокухлів Stanley в Україні:

| Папка | Що це | Стек |
|---|---|---|
| [`stanley-brand-site/`](stanley-brand-site/) | Вітрина-магазин + адмінка. Приймає замовлення і **пересилає їх у Telegram**. | Статичний HTML/CSS/JS + опційний Node-бекенд (Monobank-еквайринг, форвард у Telegram) |
| [`tg-ttn-bot/`](tg-ttn-bot/) | Telegram-бот: читає замовлення з чату, парсить їх і створює **ТТН Нової Пошти**. | TypeScript, grammy, Prisma, Redis/BullMQ, Fastify |

## Як вони пов'язані

```
Покупець → [сайт: кошик/checkout] → premium-patch.js шле замовлення у Telegram-групу
                                              │
                                     [tg-ttn-bot читає чат]
                                              │
                            парсинг → preview → кнопка «Створити ТТН»
                                              │
                                     Nova Poshta API → номер ТТН
```

Сайт лише **доставляє текст замовлення** в Telegram. Бот перетворює цей текст
на ТТН. Кожну частину можна запускати окремо.

## Швидкий старт

**Сайт (статика):**
```bash
cd stanley-brand-site
python3 -m http.server 8000   # → http://localhost:8000
```

**Бот (mock-режим, без реальних ТТН і без API-ключів):**
```bash
cd tg-ttn-bot
cp .env.example .env          # вписати лише TG_BOT_TOKEN
npm install
npm run dev
```

Детальні інструкції — у README кожної папки та в `tg-ttn-bot/QUICK-START.md`.

## Безпека

- **Ніколи не комітьте реальні токени.** У репозиторії лише `*.env.example` з плейсхолдерами.
- Раніше в архіві сайту був зашитий реальний Telegram-токен — його **відредаговано
  (redacted) перед комітом**. Якщо це твій токен — **відкликай його в @BotFather**.
- Деталі конвенцій і архітектури — у [`CLAUDE.md`](CLAUDE.md).
