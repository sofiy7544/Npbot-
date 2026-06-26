# Stanley Brand UA — Backend

Mini-backend на Node.js + Express для:

1. **Monobank acquiring** — створення інвойсів, перевірка статусу, webhook.
2. **Forwarding замовлень у Telegram-групу** — повідомлення з фотографіями товарів, обʼємом, ціною, типом оплати.

---

## Швидкий старт (локально)

```bash
cd backend
cp .env.example .env
# Відкрий .env та заповни:
#   MONOBANK_TOKEN       — з https://web.monobank.ua → Інтернет-еквайринг → API ключ
#   TELEGRAM_BOT_TOKEN   — вже вставлено
#   TELEGRAM_CHAT_ID     — див. нижче, як знайти

npm install
npm start
# → ✓ Stanley backend running on http://localhost:8787
```

Перевір: відкрий `http://localhost:8787/` — побачиш сторінку статусу.

---

## Як знайти chat_id Telegram-групи

1. Додай бота `@your_bot_username` у вашу групу.
2. **Зроби бота адміністратором** (інакше він не зможе відправляти фото).
3. Напиши будь-яке повідомлення в групі (наприклад "test").
4. Відкрий в браузері:
   `https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/getUpdates`
5. Знайди останнє `"chat": { "id": -1001234567890, ... }`.
6. **Скопіюй `id` цілком разом зі знаком мінус** і встав у `.env`:
   ```
   TELEGRAM_CHAT_ID=-1001234567890
   ```
7. Restart `npm start`.

> Групові chat_id зазвичай починаються з `-100...` (для супергруп).

---

## Тестування

```bash
# Тестовий заказ → має прийти у вашу TG-групу:
curl -X POST http://localhost:8787/api/tg/order \
  -H "Content-Type: application/json" \
  -d '{
    "order": {
      "id": "TEST-1",
      "createdAt": "2026-05-12T18:00:00Z",
      "subtotal": 2500, "discount": 0, "shippingCost": 0, "codFee": 0, "total": 2500,
      "payment": "mono",
      "items": [{ "id": "stanley-quencher-30", "qty": 1, "color": "Рожевий кварц", "name": "Quencher 30oz", "volume": "30oz", "price": 2500, "imageRel": "img/IMG_2491.webp" }],
      "contact": { "phone": "+380501234567", "email": "test@test.com" },
      "shipping": { "method": "np-branch", "firstName": "Тест", "lastName": "Тестовий", "city": "Київ", "locker": "Відділення №1" }
    }
  }'
```

Має повернутись `{"ok":true}` і повідомлення з фото у групі.

---

## Тестування Monobank invoice

```bash
curl -X POST http://localhost:8787/api/mono/create \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "TEST-1", "amount": 10000, "ccy": 980, "description": "Тестова оплата" }'
```

Відповідь буде з полем `pageUrl` — це посилання на оплату Monobank. Відкрий його у браузері.

---

## Деплой у production (Railway / Render / Fly.io)

### Railway

```bash
# Встанови Railway CLI
npm i -g @railway/cli

cd backend
railway login
railway init
railway up
```

В UI Railway → Variables → додай:
- `MONOBANK_TOKEN` = твій production токен
- `TELEGRAM_BOT_TOKEN` = `<YOUR_TELEGRAM_BOT_TOKEN>`
- `TELEGRAM_CHAT_ID` = `-1001234567890` (твій)
- `PUBLIC_ORIGIN` = `https://stanleybrandua.com`
- `ALLOWED_ORIGINS` = `https://stanleybrandua.com,https://www.stanleybrandua.com`

Після деплою отримаєш URL виду `https://stanley-brand-backend.up.railway.app`.

### Підключення фронта до backend

У `index.html` знайди блок `STANLEY_CONFIG` та встав твій backend URL:

```html
<script>
window.STANLEY_CONFIG = {
  apiBase: "https://stanley-brand-backend.up.railway.app",
  monoEnabled: true,
};
</script>
```

---

## Безпека

- ❗ `MONOBANK_TOKEN` має зберігатися **тільки** у `.env` або environment variables хостингу. Не комітити у git.
- ❗ `TELEGRAM_BOT_TOKEN` — теж секрет. Якщо випадково засвітиш — відкликай через `@BotFather` → `/revoke`.
- Backend перевіряє статус кожного платежу повторним запитом до Monobank API (не довіряє лише webhook payload).
- Замовлення у Telegram відправляється **тільки після підтвердженої оплати** (для Monobank). Для накладеного платежу — відразу.

---

## Endpoints

| Method | Path                 | Призначення                          |
|--------|----------------------|--------------------------------------|
| POST   | `/api/mono/create`   | Створити інвойс Monobank             |
| POST   | `/api/mono/webhook`  | Server-to-server callback від Monobank |
| GET    | `/api/mono/status`   | Перевірити статус інвойсу            |
| POST   | `/api/tg/order`      | Відправити замовлення у TG (для не-Mono оплат) |

---

## Troubleshooting

**Telegram: `Bad Request: chat not found`**  
→ Бот не доданий у групу або chat_id невірний.

**Telegram: `Bad Request: have no rights to send a photo`**  
→ Бот не адмін групи. Зроби адміном.

**Monobank: `401 Unauthorized`**  
→ Невірний `MONOBANK_TOKEN`. Перевір `.env`.

**CORS error у браузері**  
→ Додай свій домен у `ALLOWED_ORIGINS` в `.env`.

**Заказ не приходить у TG після Mono оплати**  
→ Перевір `webHookUrl` — backend має бути доступним з інтернету (не `localhost`). У Railway / Render це автоматично HTTPS URL.
