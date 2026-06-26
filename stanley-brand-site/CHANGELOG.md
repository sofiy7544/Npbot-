# CHANGELOG — DailyUA

## v3 (2026-05-06) — Адмін-панель + Telegram-checkout

### 🆕 Новий файл: `admin.html` (103 KB)

Самостійна SPA-адмінка. Все в одному файлі, без backend, без build-step.

**10 розділів:**
1. **Панель** — статистика (замовлення, виторг, активні товари, низький залишок)
2. **Товари** — таблиця з пошуком, фільтрами по бренду/статусу, тогглами активності, редагуванням
3. **Замовлення** — фільтр по статусах, повна інформація, зміна статусу, повтор у Telegram, друк
4. **Банери та промо** — управління верхньою стрічкою (3 мови), live preview
5. **Контакти / Brand** — email, phone, telegram, whatsapp, юр.особа, налаштування продажів, зміна пароля
6. **SEO та Open Graph** — read-only поточних значень + регенератор sitemap.xml
7. **Медіатека** — drag & drop завантаження з автооптимізацією (resize 1024px, конвертація у WebP, quality 0.85)
8. **Аналітика** — топ товарів, розподіл по статусах, рекомендації по інтеграціях
9. **Експорт у код** — генерація `patch.js` для синхронізації з `index.html`
10. **Бекап / Відновлення** — повний JSON-дамп, restore, reset overrides, reset all

**Технічні рішення:**
- Авторизація: SHA-256 hash пароля у localStorage, sessionStorage для сесії
- Дефолтний пароль: `admin1234` (треба змінити після першого входу)
- Зберігання: 6 ключів localStorage (`dua_admin_*`) + спільний `dua_orders` з сайтом
- Image optimization: canvas resize → WebP toDataURL → base64 у localStorage
- Custom confirm dialog замість native `confirm()`
- Toast notifications system
- Mobile responsive: hamburger menu, sidebar slide-in, breakpoint 880px

### 🔄 Зміни в `index.html`

#### Telegram-checkout без backend
Додана функція `sendOrderToTelegram(order)` яка викликається після `placeOrder()`. Формує повідомлення з:
- ID замовлення, список товарів з кольорами і кількістю
- Сума, знижка, доставка, разом
- Контактні дані клієнта
- Адреса доставки і метод оплати
Відкриває `https://t.me/{username}?text=...` у новій вкладці. На mobile — відкриває TG-додаток.

#### Admin overrides bootstrap
В `index.html` додана IIFE одразу після `const PRODUCTS = [...]`. При завантаженні читає з localStorage:
- `dua_admin_products` ({edits, add, remove, disabled}) — змінює базовий каталог
- `dua_admin_colors` — додає кольори в COLORS map
- `dua_admin_brand` — підмінює BRAND через `window._BRAND_OV` (бо BRAND frozen)
- `dua_admin_banner` — кастомний текст announce-bar з підтримкою disable

Це означає: всі зміни в адмінці одразу видно на сайті у **тому ж браузері**.

#### Banner control
`renderAnnounce()` тепер читає `dua_admin_banner` і використовує кастомний текст або вимикає announce-bar повністю (з обнулінням `--announce-h`).

#### Filtering disabled products
`viewHome()` тепер фільтрує `_disabled` товари. `VOLUMES` та `BRANDS` теж розраховуються після фільтрації.

### 📊 Метрики

| | Було (v2) | Стало (v3) |
|---|---:|---:|
| Файли в проекті | 6 | **8** (+admin.html, +INSTRUCTIONS.md) |
| index.html | 332 KB | 338 KB (+1.8%) |
| index.html gzipped | 75 KB | 76 KB |
| admin.html | — | 103 KB / 22 KB gzipped |
| Загальний розмір | 4.1 MB | 4.2 MB |

---

## v2 (2026-05-06) — Контент + CRO апгрейд

(Див. секцію v2 нижче або історію коміту)

### Виправлено
- 10 битих файлів webp (0 байт) видалено
- SKU `stanley-aerolight-quencher` видалено (немає фото на заміну)

### Додано 3 нових SKU
- `stanley-protour-30` (3 300 ₴, 15 кольорів, 30 фото)
- `stanley-protour-20` (2 999 ₴, 8 кольорів, 17 фото)
- `stanley-lsf-holiday` (3 500 ₴, 4 кольори, 14 фото, Limited)

### Оновлено
- `stanley-quencher-40`: 2 099 → 2 500 ₴, палітра 13 → 22 кольори
- 13 нових відгуків × 3 мови
- 20 нових кольорів у COLORS map
- Featured Collections блок на головній (3 банери з editorial-фото)
- sitemap.xml (92 entries), robots.txt, og-image.png 1200×630
- 86 нових студійних фото (123 загалом, 3.6 MB)

### Метрики
- Каталог: 10 → **12 SKU**
- Товари з фото: 6 → 8
- Биті файли: 10 → 0
- Відгуки покривають: 8/10 → **12/12**
- Загальний бал: **8.4 / 10**
