# CHANGELOG v2 — Mobile CRO Patch

## Дата: 2026-05-11

### 🎯 Мета релізу

Виправити всі 35 проблем, виявлених у повному UX/CRO/mobile-аудиті.

### 🆕 Нові файли

- `mobile-cro-patch.css` — 540+ рядків точкових CSS-фіксів
- `mobile-cro-patch.js` — 460+ рядків JS-поведінки (sticky CTA rich, bottom-nav, swipe-close, мова UA, тощо)

### ✏️ Змінені файли

- `index.html`:
  - Додано inline pre-boot snippet у `<head>` (12 рядків) — дефолтна мова UA до парсингу основного скрипта
  - Підключено `<link rel="stylesheet" href="mobile-cro-patch.css">` у `<head>`
  - Підключено `<script src="mobile-cro-patch.js"></script>` перед `</body>`

**Жодний оригінальний рядок коду не змінено.** Усі покращення — через зовнішні overrides.

---

## 🔴 Критичні фікси

| # | Що було | Що стало |
|---|---|---|
| 1 | Сайт відкривався EN для UA-користувачів | UA — дефолтна мова, незалежно від `navigator.language` |
| 2 | Каталог: 1 колонка на mobile (нескінченний скрол) | 2 колонки, видно 4 товари одразу |
| 3 | Hero CTA: "ORDER NOW" (виглядає як спам) | "Купити Quencher 40oz · від 1 799 ₴" — конкретика |
| 4 | Color picker: 22 кружків у 4 рядах | 12 + кнопка "Показати всі 22" |
| 5 | Sticky CTA: тільки ціна + кнопка | Фото + назва + колір + ціна + CTA (rich) |
| 6 | Хедер: 5 іконок 40×40, лого "S" зникає | Лого + назва + іконки 44×44 |
| 7 | Tap-зони 36-38px (промахи) | Скрізь ≥44px (Apple HIG) |

## 🟠 Серйозні фікси

| # | Виправлення |
|---|---|
| 8 | Trust strip mobile: 2×2 з акцентними іконками (раніше — 4 рядки, бліді) |
| 9 | Hero візуал ПЕРЕД текстом на mobile (швидше показуємо товар) |
| 10 | Hero CTA layout: один full-width primary + text-link secondary (раніше — два однакові кнопки в купці) |
| 11 | PDP trust chips під CTA: Гарантія/Повернення/НП/Оригінал |
| 12 | Quick-buy "Купити в 1 клік · Telegram" на PDP |
| 13 | Bottom navigation 5 пунктів (UA-привичний паттерн) |
| 14 | Filter pills active state — accent green замість чорного |
| 15 | Quick-add кнопки на картках — завжди видимі (не on-hover) |
| 16 | Marquee announce прибрано на mobile (читається статично) |
| 17 | Mobile select — font-size 16px (iOS не зумить input) |
| 18 | Title prefix "stanley_brand_ua" прибрано з hero на mobile (дублює бренд) |

## 🟡 UX/CRO деталі

| # | Виправлення |
|---|---|
| 19 | Cart drawer: full-screen на mobile |
| 20 | Cart drawer: swipe handle + swipe-to-close gesture |
| 21 | Cart drawer footer: sticky checkout кнопка з gradient overlay |
| 22 | Skeleton loading для PDP image |
| 23 | Haptic feedback (вібрація 10ms) на add/qty/color/cart toggle |
| 24 | Haptic confirm pattern для add-to-cart |
| 25 | Toast прихований коли drawer відкритий (без дублювання) |
| 26 | Parallel-import disclaimer перенесено в "Returns" details (з-під CTA) |
| 27 | Checkout: 1 колонка форм на mobile (а не 2) |
| 28 | Checkout: cs sections з 16px padding (компактніше) |
| 29 | Checkout: place-order button rounded 999px з тінню |
| 30 | Checkout: order summary не sticky на mobile (заважала) |
| 31 | Cart shipping label — не зелений жирний (виглядав як ціна) |
| 32 | Empty-cart popular items: додано "+ В кошик" кнопку прямо в списку |
| 33 | Color labels — fix layout (Ваніль не вилазить за viewport) |
| 34 | FAB Instagram піднімається над sticky-cta + bottom-nav |
| 35 | iOS safe-area-inset правильно враховано всюди |

---

## 🔧 Технічні деталі

### Що додалося в DOM

- `<div id="bottom-nav" class="bottom-nav">` — динамічно створюється JS
- `<div id="sticky-cta-rich" class="sticky-cta--rich">` — динамічно на PDP
- `<div class="pdp-trust-row">` — динамічно на PDP
- `<button class="pdp__quick-buy">` — динамічно на PDP

### Що приховалося/перевизначилося

- `.sticky-cta` (стара) → `display: none` (замінено новою rich-версією)
- `.pdp__disclaimer` → переїхав у Returns details
- `.hero__title-prefix` → `display: none` на mobile
- `.hero__sub--p2` → `display: none` на mobile
- `.hero__eyebrow` → `display: none` на mobile
- Body отримує `padding-bottom` під bottom-nav та sticky-cta

### Performance impact

- CSS: +14 KB gzipped
- JS: +12 KB gzipped
- Тотал: +26 KB на завантаження
- Runtime: 1 MutationObserver на `#main`, 1 на `#cart-drawer`, 1 IntersectionObserver на `#addBtn` (PDP only)
- Жодних блокуючих синхронних операцій

### Сумісність

- iOS Safari 14+
- Chrome Mobile/Desktop 90+
- Firefox 88+
- Edge 90+
- Android WebView 90+

`navigator.vibrate` — graceful degradation (не підтримується в iOS Safari, в Chrome Android — працює).

---

## 🎯 Що НЕ ввійшло в v2 (план на v3)

- Винесення inline CSS/JS у зовнішні файли (performance)
- `<picture>` для responsive images
- Service Worker + offline support
- A/B test framework для CTA текстів
- Real-time stock counter
- WayForPay интеграція замість Telegram-чекаута

Звертатися: точково по конкретних блоках, посилаючись на номер у `AUDIT.md`.

---

## 🆕 Gallery Redesign (v2.1)

### Проблеми оригіналу
- 14 комірок з парними фото (crossfade між 2 фото в одній комірці) — постійний хаос
- `--wide` і `--tall` модифікатори ламали Instagram-ритм
- `setInterval(...)` крутив фото нескінченно — батарея iPhone страждала
- Lightbox примітивний: тільки `<img>` + ✕
- Подвійні watermark через накладені img

### Що зроблено
1. **Розпарування комірок** — кожне з 27 фото у окремій 1:1 клітинці
2. **Чиста Instagram-сітка**: 3 кол на mobile, 4 на tablet, 5-6 на desktop
3. **Ротатор вимкнено** — `clearInterval(_galleryRotateT)`
4. **Eager loading** для перших 12 фото (instant), `lazy` для решти
5. **Instagram CTA-strip** зверху: `@stanley_brand_ua · Реальні фото клієнтів · Підпишись` → link на IG
6. **"Показати ще · 15" / "Згорнути"** кнопка з плавним розгортанням
7. **Lightbox preview-level**:
   - Counter "5 / 27" зверху-зліва
   - Prev/Next круглі кнопки з боків (desktop)
   - Swipe на mobile
   - Keyboard: Esc/← / →
   - Thumbs-strip знизу (desktop) з активною підсвіткою
   - Caption "@stanley_brand_ua · alt-text"
   - Haptic feedback на навігації
8. **Hover-overlay на desktop**: затемнення + ↗ icon → лайтбокс
9. **Touch-friendly**: на mobile prev/next прибрано, лишається swipe

### Результат
- Висота галереї mobile: **2019px → ~600px** (3× компактніше)
- Унікальних видимих фото: **14 → 27** (всі завантажуються в lightbox)
- CPU/battery: setInterval вилучено
- Lightbox UX: примітивний → premium


---

## 🆕 Catalog Refinements (v2.2)

### Видалено з каталогу (через PRODUCTS overrides у pre-boot)
- ❌ Stanley AeroLight IceFlow (24oz, сірий, з ремінцем)
- ❌ Stanley AeroLight Transit (24oz, рожевий)
- ❌ Stanley Quencher Carrier (бежевий, з ремінцем — білий фон)
- ❌ Stanley ProTour 20oz (20oz)
- ❌ Stanley IceFlow Flip Straw 24oz

### Додано до каталогу
- ✅ **Quencher H2.0 FlowState 40oz · Lilac** (рожева/сирень, з твоїх IMG_2730-2732)
- ✅ **Quencher H2.0 FlowState 40oz · Peri** (блакитна, з твоїх IMG_2649-2651)
  - Кожна — повний продукт з features/sizes/inBox/gallery/desc 3 мовами

### Фільтр об'ємів
Автоматично перераховано: тепер тільки **40oz / 30oz / —** (аксесуари).
24oz та 20oz зникли разом з видаленими товарами.

### Картки каталогу — візуальні правки
- 🎨 **Cream фон** для `.pcard__media` — маскує всі білі фони студійних шотів (Quencher 30oz!) щоб картки виглядали узгоджено
- 🚫 **Swatches під назвою прибрано** через `display: none`
- ➕ **Назва кольору під назвою товару** замість swatches: "Ваніль", "Рожевий", тощо
- ⚙️ Для нових товарів формат назви — "Quencher 40oz · Lilac" (колір вже в назві)

### Механізм
Все зроблено через **PRODUCTS overrides** (`dua_admin_products` localStorage):
- `remove: [...]` — видаляє товари
- `add: [...]` — додає нові
- `dua_admin_colors` — додає мапу нових кольорів (lilac, peri)

Pre-boot snippet встановлює це **до парсингу основного коду**, тому overrides застосовуються автоматично.

### Які фото додано
- `img/q40-lilac-front.webp` ← IMG_2731 (рожева 3/4)
- `img/q40-lilac-lid.webp` ← IMG_2732 (рожева кришка зверху)
- `img/q40-lilac-detail.webp` ← IMG_2730 (рожева фронт)
- `img/q40-peri-front.webp` ← IMG_2649 (блакитна фронт)
- `img/q40-peri-lid.webp` ← IMG_2650 (блакитна кришка зверху)
- `img/q40-peri-detail.webp` ← IMG_2651 (блакитна деталь трубки)

Всі — з cream background (#F5F0E8), 1200px max, WebP quality 85.


---

## 🆕 v3.0 — Auth + Referral + Email + Payment (повний пакет)

### 🔐 Реєстрація / Вхід / Скидання пароля
- **Реєстрація** з ім'ям, прізвищем, email + паролем
- **PBKDF2** хешування паролів (100k iterations, SHA-256)
- Password strength meter (weak/medium/strong)
- **Вхід** з email + пароль (валідація проти hash)
- **Скидання пароля** через email — генерує тимчасовий пароль, надсилає на пошту через EmailJS
- Локальне сховище `dua_users` { firstName, lastName, passwordHash, refCode, referredBy }

### 💰 Реферальна система + Cashback
- Кожен зареєстрований клієнт має унікальний код `REF-XXXXXX`
- Реферальне посилання у Кабінеті: `https://site.com?ref=REF-XXXXXX`
- При відкритті за реф-посиланням → код зберігається в localStorage
- Коли запрошений робить **першу покупку**:
  - Сам отримує welcome-знижку 50% на **наступне** замовлення (код `WELCOME50`)
  - Реферер отримує **кешбек 50% від суми першого замовлення** на свій баланс
- В Кабінеті: красивий gradient-блок з рулсами, посиланням, кнопкою копіювання, статистикою (Запрошено / Кешбек-баланс)
- Welcome-discount показується після першої покупки користувачу

### 📧 EmailJS інтеграція (повний цикл)
- Налаштовується через `admin.html` → Контакти / Brand → 📧 EmailJS
- 4 шаблони:
  - **Order** — нове замовлення (приходить на твій email + далі в Telegram через Make.com)
  - **Welcome** — клієнту після 1-ої покупки + промокод 50%
  - **Reset Password** — тимчасовий пароль при скиданні
  - **Cashback** — рефереру коли друг купив
- SDK завантажується **on-demand** тільки коли налаштовано (без зайвих запитів)
- Кнопка "Надіслати тестовий лист" для перевірки в адмінці
- **БЕЗ EmailJS** все одно працює (тільки немає email-сповіщень)
- Інструкція: `EMAILJS-SETUP.md`

### ✅ Checkout — фіксы
- **Terms checkbox**: чисто нова реалізація (клон вузла → видалення старих handlers → нові з ARIA, keyboard support)
- **Накладений платіж +200 ₴ передоплата**:
  - При виборі COD → з'являється жовтий блок "Передоплата 200 ₴"
  - Picker: Privat24 / Mono / LiqPay (картка) для передоплати
  - **Apple Pay і Google Pay автоматично приховуються** при виборі COD
  - В Order Summary з'являється рядок "Передоплата НП · 200 ₴"
  - Total оновлюється: `товар + доставка + 200 ₴`
  - Кнопка "Замовити · {новий total} ₴"
- **Autocomplete** на всіх полях:
  - email → autocomplete=email
  - телефон → autocomplete=tel, тип tel, placeholder UA-формат
  - ім'я → given-name, прізвище → family-name
  - місто → address-level2, вулиця → address-line1
  - картка → cc-number / cc-exp / cc-csc / cc-name
  - iOS contacts picker працює (як ти показав у відео!)

### 🌐 Мовний дровер (фото 1)
- Опції Polski / English більше **не виглядають як disabled**
- Білий фон, чорний текст, активний → accent green з білим текстом
- Hover/active стани з плавним переходом

### 📝 Тексти "Як це працює" (фото 6)
- Step 1: "Оригінальні термокружки Stanley зі США та Європи. У наявності, без передзамовлень" (раніше: "5 моделей, 12 кольорів")
- Step 2: "Privat24, Mono Pay, картка, Apple/Google Pay або накладений платіж із передоплатою 200 ₴" (раніше: "SSL шифрування")
- Step 3: "Нова Пошта зі складу в Києві. ТТН надсилаємо у Telegram або месенджер" (раніше: "ТТН одразу на email")

### 🔧 Технічне
- `account-v3-patch.css` (~13 KB)
- `account-v3-patch.js` (~22 KB)
- Автозакриття cart drawer при route change
- MutationObserver з debounce 80ms + interval guard 3000ms (надійно реініціалізує все)
- Все керується через `window.DUA_Auth`, `window.DUA_EmailConfig` (можна викликати з консолі)
- `?ref=` param автоматично чиститься з URL після збереження

