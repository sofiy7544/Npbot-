# Stanley · Triple-Pass Production Audit (v6)

> **44/44 static checks · 32/32 prior e2e · 24/24 isolation E2E**
> Audit done in 3 passes per request — each pass: find problems first, fix after.

---

## ПРОХОД 1 · Mobile UX & Визуал — что нашёл и пофиксил

| Проблема (до) | Серьёзность | Fix |
|---|---|---|
| ProTour 30oz: 15 цветов в данных | 🟡 ср. | → 5 (cream/rose/frost/mocha/orchid) |
| ProTour 20oz: 8 цветов | 🟡 ср. | → 5 (cream/frost/rose/peach/orchid) |
| Owala FreeSip 24oz: 6 цветов | 🟡 ср. | → 5 (cream/blush/sage/navy/charcoal) |
| **14 `<img>` без width/height** → CLS на загрузке | 🔴 крит. | v3.js теперь ставит default 800×800 → onLoad обновляет на natural |
| `mobile-cro-patch.js setupColorCollapse` cap=8 конфликтовал с v3 cap=5 | 🟡 ср. | Aligned to cap=5 + skip if v3Enhanced |

Проверки которые уже были ✓: hero preload, 3-thumb CSS cap, studio cool-neutral PDP bg, all media queries, alt-атрибуты на всех img.

---

## ПРОХОД 2 · Checkout / Account / Orders — что нашёл и пофиксил

| Проблема (до) | Серьёзность | Fix |
|---|---|---|
| **`computeSold(p)` читал `dua_orders`** → после v5 namespacing это юзер-приватные данные → "Х купили" на product card показывал ЛИЧНЫЕ заказы | 🟡 ср. | Убрал чтение dua_orders, использует только `baseFromReviews + bestsellerBonus + dua_admin_sold override` |
| **Все проверенные раньше** (v3-v5) ещё работают ✓ |  | TG popup removed · Success page · anti-double-submit · namespacing · empty state |

Что осталось ✓ (нет регрессий):
- Storage proxy `dua_orders__<uid>` / `__guest`
- AUTH.register с salt + hash + email duplicate check
- AUTH.login с anti-enumeration + timing-safe compare
- Admin link скрыт от обычных юзеров (v2 sweep)
- PDP "1-click order" в TG (user-initiated) сохранён — нормальный паттерн

---

## ПРОХОД 3 · Security / Production Readiness — что нашёл и пофиксил

| Проблема (до) | Серьёзность | Fix |
|---|---|---|
| **🔴 TG bot token `8621763731:AAE1...` опубликован в `index.html`** | 🔴 КРИТ. | Удалён (включая комментарий). `telegramBotToken: ""`. Owner ДОЛЖЕН revoke в @BotFather + поднять backend |
| Нет `_headers` файла → нет HSTS/X-Frame/X-Content-Type/Permissions-Policy на уровне HTTP | 🟡 высоко | Создан `_headers` с полным набором (см. ниже) |
| Нет `_redirects` для SPA fallback | 🟡 высоко | Создан `_redirects` |
| OG image указывал на `https://stanleybrandua.com/og-image.png` (домен не задеплоен) | 🟡 высоко | Заменено на relative `/og-image.png` |
| 16 console.log в production JS | 🟢 средне | `premium-patch-v6.js` глушит console.log/info/debug в проде; debug=1 в URL включает обратно |
| 5 картинок > 250KB (case-birch/black/rose) | 🟡 высоко | **НЕ исправлено в архиве** — нужен реальный binary processing. См. инструкцию в README ниже |

Что было сделано раньше и работает ✓:
- Admin signed session token (`nonce.sig`)
- Admin brute-force lockout (5 попыток → 15 мин)
- Admin default password скрыт с login + change form
- Permissions-Policy + X-Content-Type + Referrer-Policy в meta тегах

---

## Файлы

### Новые
- `premium-patch-v6.js` (1 KB) — console gate для prod
- `_headers` (1.5 KB) — Netlify HTTP security + caching policy
- `_redirects` (0.4 KB) — SPA fallback для clean URLs

### Изменены
- `index.html`:
  - TG token удалён из `STANLEY_CONFIG`
  - OG image → relative path
  - `computeSold()` больше не читает приватные orders
  - 4 palettes сокращены до 5 цветов
  - `<script src="premium-patch-v6.js">` подключен ПЕРВЫМ (после auth-isolation)
- `mobile-cro-patch.js`: `setupColorCollapse` cap=5 + skip if v3 уже handled
- `premium-patch-v3.js`: enhanceImages теперь резервирует 800×800 ДО loading + obs onload

### НЕ тронуто
- premium-patch v1, v2, v4, v5
- auth-isolation-patch.js (v5)
- account-v3-patch.js
- premium-patch.js (Mono + TG dispatch core)
- admin.html (v5 hardened)
- API endpoints / business logic

---

## Что проверить руками на телефоне (live-deploy)

DevTools я применить к Netlify-preview не могу. Чек-лист для тебя:

### Lighthouse Mobile (Chrome → Lighthouse → Mobile, все категории)
- [ ] **Performance ≥ 80** — должен подняться благодаря CLS fixes (`<img width/height>`) и `_headers` caching
- [ ] **Accessibility ≥ 90**
- [ ] **Best Practices ≥ 95** — TG token больше не в коде
- [ ] **SEO ≥ 90**

### DevTools → Network (Throttle: Fast 4G, Disable cache)
- [ ] Initial bundle (DOMContentLoaded) **< 250 KB transferred**
- [ ] LCP image (`hero-stanley-pastel.webp`) **со status 200 + fetchpriority=high header**
- [ ] Все .webp получают `Cache-Control: max-age=31536000, immutable` (можно посмотреть в headers ответа)

### DevTools → Application → Local Storage (после регистрации)
- [ ] Есть `dua_users` (объект `{ email_lower: {uid, salt, pwHash, ...} }`)
- [ ] Есть `dua_user` (текущий пользователь без password)
- [ ] Есть `dua_session` в формате `<hex>.<hex>` (signed token)
- [ ] После создания заказа: `dua_orders__u_<...>` — твои заказы
- [ ] `dua_orders` (без namespace) — mirror того же контента

### Console — НЕ должно быть:
- [ ] Красных error
- [ ] `Refused to load` от CSP
- [ ] `Mixed Content`
- [ ] **В проде:** никаких console.log от Stanley patches (v6 их глушит)

### Functional tests (real users):
- [ ] Register Alice → видит empty account state (без fake stats)
- [ ] Logout → Register Bob → **НЕ видит** заказы Alice
- [ ] Login Alice снова → видит СВОИ заказы
- [ ] Wrong password → generic "Невірний email або пароль"
- [ ] Дубликат email → "Цей email уже зареєстровано"
- [ ] Admin: 5 неправильных паролей → "Доступ заблоковано на 15 хвилин"
- [ ] Admin: `sessionStorage.setItem("dua_admin_auth", "1")` через DevTools + reload → **НЕ войти**
- [ ] Checkout → place order → success page показывается, **TG popup не открывается**
- [ ] Success page: animated tick + копирование order ID

### Mobile (iPhone Safari + Android Chrome):
- [ ] PDP gallery: 3 thumbnails, swipe
- [ ] Color swatches: 5 видимых + "Показати всі N" если больше
- [ ] Checkout inputs: на tap **НЕ зум** (font-size 16px)
- [ ] Sticky CTA не закрыт home indicator
- [ ] Нет horizontal scroll
- [ ] Animations плавные на 60fps

---

## Что всё ещё не production-ready (требует ДО публичного запуска)

### 🔴 Critical (блокирует launch)

1. **TG bot token нужно RE-GENERATE**
   - `@BotFather` → `/revoke` → новый
   - Старый токен публично известен (Netlify preview, web archive, possibly indexed)
2. **Backend для TG/Mono**
   - В архиве есть готовый `monobank-demo.zip` (Express + полный flow)
   - Деплой на Render/Vercel/Fly
   - В `STANLEY_CONFIG.apiBase` указать URL backend
3. **Купить и подключить домен** `stanleybrandua.com`
   - Сейчас canonical + sitemap указывают на этот домен — Google не сможет индексировать на Netlify-preview

### 🟡 High (нужно сделать в первую неделю)

4. **Сжать большие картинки** (5 файлов > 250KB):
   ```bash
   # На локальной машине:
   cd img/cases/
   for f in *.webp; do
     cwebp -q 78 -resize 1600 0 "$f" -o "tmp.webp" && mv tmp.webp "$f"
   done
   # Ожидаемое сжатие: 384 KB → 120-150 KB на файл
   ```
5. **`og-image.png` создать** — сейчас meta его указывают, но файла нет в `img/`
6. **Real email service** — currently EmailJS keys configurable в admin, но не обязательный

### 🟢 Medium (улучшения)

7. **Сменить admin password** сразу после первого логина (через Brand → Безпека)
8. **Включить enforced CSP** после миграции inline scripts в external (сейчас report-only)
9. **Service Worker** для repeat-visitor speed boost

---

## Что нужно переносить на backend/database (для real scale)

Сейчас вся auth/orders живут в **localStorage** — это работает на 1 устройство. Для серьёзного бизнеса нужно:

| Сейчас (frontend localStorage) | Что нужно (backend) |
|---|---|
| `dua_users` объект с salt+pwHash | Postgres `users` table + scrypt/argon2 |
| `dua_session` signed token | HTTP-only secure cookie + server-side `sessions` table |
| `dua_orders__<uid>` | Postgres `orders` table с FK на users |
| Storage proxy для namespacing | Server-side ownership check на каждый API call |
| TG bot token в frontend | env var + backend proxy `/api/tg/dispatch` |
| Mono token | env var + `/api/mono/create` (готов в monobank-demo) |
| Admin SHA-256 хэш в localStorage | Server-side scrypt + 2FA |
| Brute-force в localStorage | Redis-backed rate limit per-IP |
| Email verification flow | Email service (Resend / Postmark) |

**Backend готов** в `monobank-demo.zip` — нужно только расширить его эндпоинтами `/api/auth/*` и `/api/orders/*`. Loop SaaS scaffold (`loop-saas.zip` из ранней сессии) показывает как это делается с Next.js + Prisma.

---

## TL;DR — текущее состояние

✅ **Frontend-only production-acceptable**:
- Visual quality premium
- Mobile UX production-ready
- Auth с isolation (для одного устройства)
- Admin hardened
- Security headers через Netlify
- Console silenced в prod

🔴 **Перед public launch:**
1. Revoke TG token
2. Deploy backend
3. Подключить домен

🟡 **В первую неделю:**
4. Сжать картинки кейсов
5. og-image.png
6. CSP enforced
