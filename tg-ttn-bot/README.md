# tg-ttn-bot

Telegram-бот, який ловить повідомлення у вашій групі, парсить замовлення (ПІБ, телефон, місто, відділення, сума), і одним кліком створює ТТН Нової Пошти.

**Незалежний мікросервіс** — нічого не знає про основний сайт, працює окремо.

---

## 🚀 Запуск за 5 хвилин

### 1. Створи бот

1. У Telegram знайди **@BotFather** → `/newbot` → дай ім'я і username
2. Отримай токен виду `123456789:AAE...`
3. Створи свою робочу групу і додай бота як учасника

### 2. Дізнайся `chat_id` групи

Додай у групу **@userinfobot** → він напише `Chat ID: -1001234567890`. Це число (з мінусом) — твій `ALLOWED_CHAT_IDS`.

Або: відправ боту `/whoami` в групі — він покаже ID.

### 3. Дістань NP API ключ + sender details

#### API key
- https://new.novaposhta.ua → Налаштування → Безпека → «Створити ключ»

#### Sender refs (UUID-и твого магазину як відправника)
Найпростіше — через curl-запити:

```bash
# 1. Знайди CityRef твого міста (наприклад Київ):
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"YOUR_KEY","modelName":"Address","calledMethod":"getCities","methodProperties":{"FindByString":"Київ"}}' \
  | jq '.data[0].Ref'
# → "8d5a980d-391c-11dd-90d9-001a92567626"

# 2. Знайди WarehouseRef твого відділення:
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"YOUR_KEY","modelName":"Address","calledMethod":"getWarehouses","methodProperties":{"CityRef":"<CityRef з кроку 1>","FindByString":"42"}}' \
  | jq '.data[0].Ref'

# 3. Знайди свій Counterparty Sender Ref:
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"YOUR_KEY","modelName":"Counterparty","calledMethod":"getCounterparties","methodProperties":{"CounterpartyProperty":"Sender","Page":"1"}}' \
  | jq '.data[0].Ref'

# 4. Знайди ContactPerson Ref (з попереднього SenderRef):
curl -X POST https://api.novaposhta.ua/v2.0/json/ \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"YOUR_KEY","modelName":"ContactPerson","calledMethod":"getContactPersonsList","methodProperties":{"Ref":"<SenderRef з кроку 3>","Page":"1"}}' \
  | jq '.data[0].Ref'
```

### 4. Налаштуй .env

```bash
cd tg-ttn-bot
cp .env.example .env
nano .env
```

Заповни:
- `TG_BOT_TOKEN` — з кроку 1
- `ALLOWED_CHAT_IDS` — з кроку 2 (можна кілька через кому)
- `NP_API_KEY`, `NP_SENDER_*` — з кроку 3
- `NP_SENDER_PHONE` — твій номер у форматі `+380...`

### 5. Встанови + запусти

```bash
npm install
npm run dev
```

Якщо все правильно — у консолі побачиш:
```
🤖 tg-ttn-bot starting…
   Allowed chats: -1001234567890
   NP API key: ✅ set
   NP sender: ✅ set
✅ Bot @your_bot_username is running (long-polling)
```

### 6. Перевір у групі

Відправ боту `/test` — він має відповісти `✅ Ключ працює. Знайшли: Київ`.

---

## 💬 Як використовувати

Відправ у групу будь-яке з:

**Формат 1 — багаторядково:**
```
Іванова Олена Петрівна
+380501234567
Київ, № 42
Сума: 2500
Quencher 40oz Cream
Накладений
```

**Формат 2 — одним рядком:**
```
Іванова О. +380501234567 Київ № 42 сума 2500 термокухоль
```

**Формат 3 — з лейблами:**
```
ПІБ: Іванова Олена
Тел: +380501234567
Місто: Київ
Відділення: 42
Сума: 2500
Опис: Quencher 40oz Cream
```

**Формат 4 — поштомат:**
```
Олена +380501234567 Київ поштомат 5 сума 2500
```

**Формат 5 — кур'єр:**
```
Олена Іванова +380501234567 Київ кур'єр Хрещатик 1 кв 5 сума 2500
```

Бот reply'не з preview:
```
📋 Перевір замовлення перед створенням ТТН

👤 ПІБ: Іванова Олена Петрівна
📞 Тел: +380501234567
📦 Відділення №42
📍 Місто: Київ
💰 Сума: 2500 ₴
⚖ Вага: 0.6 кг
📝 Опис: Quencher 40oz Cream
💳 Оплата: Накладений · оплачує одержувач

[✅ Створити ТТН]  [❌ Скасувати]
```

Натиск `✅` → бот за 2-5 сек відповість:
```
✅ ТТН створено!

📋 20450012345678
👤 Іванова Олена Петрівна
📍 Київ · Відділення №42
💰 Вартість доставки: 80 ₴
📅 Очікувана дата: 23.05.2026

🔗 Трекінг НП
```

---

## ⚙ Команди бота

| Команда | Що робить |
|---|---|
| `/start`, `/help` | Привітання + приклади формату |
| `/test` | Перевіряє NP API key (запит на пошук «Київ») |
| `/whoami` | Показує `chat_id` поточного чату |

---

## 🏗 Архітектура

```
src/
  index.ts      ← entry point, bot init, .env load
  handlers.ts   ← message → preview, callback → TTN
  parser.ts     ← парсинг вільного тексту (regex bank)
  np-client.ts  ← мінімальний клієнт Nova Poshta API
  state.ts     ← in-memory store of pending drafts (10 min TTL)
  format.ts     ← HTML templates для повідомлень
```

**Залежності:** grammy (Telegram framework), dotenv. Все.

---

## 🚀 Production на VPS

```bash
# 1. Скопіюй папку на сервер
scp -r tg-ttn-bot user@server:/home/user/

# 2. Встановити Node 20+ і PM2 (якщо ще немає)
ssh user@server
cd /home/user/tg-ttn-bot
npm install
nano .env  # заповнити real values

# 3. Запустити через PM2
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # один раз — щоб після reboot бот сам стартував
```

Перевірити логи: `pm2 logs tg-ttn-bot`

---

## 🔒 Безпека

- **`ALLOWED_CHAT_IDS`** — обов'язково для production. Без нього бот реагує у будь-якому чаті куди його додадуть.
- **`.env`** — не комітити в git (вже в .gitignore через шаблон). Сторонні не повинні мати доступу.
- **NP_API_KEY** — якщо втік, перевипусти в кабінеті NP.

---

## 🐞 Troubleshooting

### Бот не реагує на повідомлення
- Перевір `pm2 logs tg-ttn-bot` — чи стартував
- Перевір `ALLOWED_CHAT_IDS` — твій chat_id має бути в списку
- У групі: send `/whoami` — має відповісти. Якщо ні — бот не доданий або не має прав

### `/test` повертає помилку
- API key недійсний — перевипусти в кабінеті NP
- Або у тебе обмежений тариф NP (рідкісно)

### «Поштомат №X не знайдено в Y»
- Перевір правильність назви міста (cyrillic «Київ», не «Kyiv»)
- Перевір що № існує в твоєму місті (у Києві поштоматів зараз ~200)

### «Sender details not configured»
- Не всі `NP_SENDER_*` у `.env`
- Перезапусти бот після зміни `.env`: `pm2 restart tg-ttn-bot`

---

Це бот працює окремо від основного сайту (`stanley-brand-ua/`). Якщо хочеш єдину систему — використовуй основний сайт + admin → settings → NP integration.
