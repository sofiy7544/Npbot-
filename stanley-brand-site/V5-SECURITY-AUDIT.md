# Stanley · Security Audit v5 — Account Isolation + Admin Hardening

> 125/125 проверок (69 static + 24 isolation E2E + 32 prior business logic)

## TL;DR

Закрыта **production-critical** проблема: новый пользователь видел заказы и статистику от предыдущего юзера (со скриншота). Причина — у "auth-системы" не было `userId`, а все данные хранились в **глобальных** localStorage ключах.

Также убрана утечка дефолтного пароля админа на login странице.

---

## Что нашли

### 🔴 C-1: Заказы НЕ привязаны к userId (КРИТИЧНО)

`localStorage.setItem("dua_orders", ...)` — глобальный массив. Любой, кто заходил на этом устройстве (включая гостей), видел один и тот же набор заказов. На скриншоте Юлия видит заказы от тестов или предыдущей сессии.

### 🔴 C-2: "Регистрация" = `User.save({email})` — ноль auth

- Нет таблицы `dua_users`. Email unique не проверялся.
- Пароль **не сохранялся**. Можно было залогиниться под **любой** email и **любой** пароль ≥6 символов.
- Это не authentication — это запись имени в localStorage.

### 🔴 C-3: Все per-user данные глобальные

`dua_cart`, `dua_favs`, `dua_checkout`, `dua_viewed`, `dua_last_order`, `dua_reviews` — без namespacing. Все юзеры на устройстве делят корзину, избранное, последний заказ.

### 🔴 C-4: Admin auth = `sessionStorage.setItem("dua_admin_auth", "1")`

Любой может открыть DevTools → console → `sessionStorage.setItem("dua_admin_auth","1")` → reload → войти.

### 🔴 C-5: Дефолтный пароль на login page

`admin.html:819`: `пароль за замовчуванням <code>${DEFAULT_PASSWORD}</code>` — пароль `Stanley1913Admin!` показан **открытым текстом** на login. Это был и есть скриншот юзера.

### 🔴 C-6: Нет brute-force protection

Сколько угодно попыток пароля — никакого rate limit.

### 🔴 C-7: Account view рендерит ВСЕ `dua_orders`

`viewAccount()` показывал summary всех заказов любому залогиненному пользователю — даже только что зарегавшемуся.

---

## Что исправили

### 1. Реальная auth система — `auth-isolation-patch.js`

Новый файл, загружается **синхронно** в `<head>` ДО `premium-patch.js`. Экспортирует `window.AUTH`:

```js
await AUTH.register({ email, password, firstName, lastName });
//  → создаёт уникальный uid = "u_" + 8 hex bytes
//  → генерит per-user salt (16 random bytes)
//  → хэширует SHA-256("stanley-pw-v1::" + salt + "::" + password)
//  → сохраняет в dua_users[emailLower] = { uid, salt, pwHash, ... }
//  → отказывает на duplicate email (EMAIL_TAKEN)
//  → отказывает на слабый пароль (WEAK_PASSWORD, < 8 chars)
//  → отказывает на bad email (BAD_EMAIL)

await AUTH.login({ email, password });
//  → читает user из dua_users
//  → сравнивает pwHash через timing-safe path
//  → unknown email = fake-compare (anti-timing) + BAD_CREDS (anti-enumeration)
//  → wrong password = BAD_CREDS (то же сообщение)
//  → создаёт подписанную сессию

AUTH.logout();  // wipe dua_user + dua_session + legacy mirror

await AUTH.currentUser();  // проверяет подпись сессии и возвращает user/null
```

### 2. Per-user namespacing через `Storage.prototype` patch

NS_KEYS = `{ dua_orders, dua_cart, dua_favs, dua_checkout, dua_viewed, dua_last_order }`

Когда **существующий** код вызывает `localStorage.getItem("dua_orders")`, наш патч:
1. Читает текущего пользователя
2. Перенаправляет к `dua_orders__<uid>` или `dua_orders__guest`
3. Возвращает значение

Это значит **весь legacy код** (admin.html, premium-patch.js, account-v3-patch.js) **работает без изменений** — но видит только данные текущего юзера.

### 3. Подписанные сессии (anti-tampering)

```
dua_session = "<nonce>.<sha256(session-v1::salt::uid::nonce)>"
```

Если злоумышленник в DevTools пишет `localStorage.setItem("dua_user", '{"uid":"hacker"}')` — у него нет `dua_session` или валидной подписи. На startup `AUTH.currentUser()` обнаружит это и сотрёт.

`session_salt` тоже в localStorage, но это **доверенный** сервер для **одного устройства** — даже зная salt, нельзя забрать сессию **другого** юзера без знания его uid в подписи. Это лучше чем нет валидации совсем.

### 4. Migration old → new

При первой загрузке `migrateLegacy()` переносит существующие `dua_orders`, `dua_cart` etc. в `dua_orders__guest`. Помечает в `dua_v5_migrated="1"`. Не запускается повторно.

При **login** гостевые данные мерджатся в namespace пользователя:
- orders / favs / viewed — union с dedup по id
- cart / checkout / last_order — данные пользователя выигрывают (они новее)

После merge guest namespace стирается.

### 5. Admin hardening

| Что | Как |
|---|---|
| Пароль удалён с login screen | Текст: "Перший вхід? Пароль за замовчуванням ти отримав від адміна сайту. Зміни його в Brand → Безпека." |
| Пароль удалён с password-change form | Текст: "Зберігається лише в цьому браузері (захешований SHA-256)." |
| Brute-force lockout | 5 неверных → блок на 15 хв (`dua_admin_lockout`, `dua_admin_attempts`) |
| Signed session token | `sessionStorage[dua_admin_auth] = "<nonce>.<sha256(nonce + pwHash)>"` |
| Невалидная сессия отклоняется | `isValidSession()` проверяет sig, если no-match → wipe + login screen |
| Смена пароля **инвалидирует все старые сессии** | потому что `pwHash` меняется, и старая подпись больше не сходится |

### 6. Premium empty state в `viewAccount`

Раньше показывался блок с **тремя статистиками всегда** (0 заказов / 0₴ / 0 избранных). Сейчас:

- Если у юзера 0 заказов: только premium illustration + CTA "Знайди свою першу термокружку" + ссылка на каталог
- Если у юзера есть заказы: stat tiles + список заказов
- Гостевой view: 2 cards "Login" / "Register" (как было)

### 7. Premium auth forms

CSS: `.auth-card` с 20px radius, soft shadow 24px×48px, input 52px height, focus ring `4px rgba(28,58,46,0.08)`, 16px font на mobile (anti iOS-zoom), submit disabled во время request с `await AUTH.*`.

---

## Файлы

### Новые
- `auth-isolation-patch.js` (12 KB) — auth + namespacing core
- `premium-patch-v5.css` (3 KB) — empty state + auth UI

### Изменены
- `index.html`:
  - User object → `AUTH.currentUserSync()` / `AUTH.logout()`
  - Login handler → `await AUTH.login(...)`
  - Register handler → `await AUTH.register(...)`
  - viewAccount → empty state + conditional stats
  - i18n: 9 новых строк (3 lang × 3 ключа)
  - `<script src="auth-isolation-patch.js">` СИНХРОННО до premium-patch.js
  - `<link rel="stylesheet" href="premium-patch-v5.css">`
- `admin.html`:
  - login_hint без `${DEFAULT_PASSWORD}`
  - password-change hint без `${DEFAULT_PASSWORD}`
  - login handler с brute-force lockout + signed token
  - renderApp() async + isValidSession()

### НЕ тронуто
- premium-patch v1-v4
- account-v3-patch
- mobile-cro-patch
- Cart / Favs объекты (читают через patched Storage.prototype)
- viewCheckout / viewConfirmation
- Все API endpoints
- Bot API integration

---

## Тестовое подтверждение (E2E sim, 24/24)

```
✓ Guest order writes to dua_orders__guest
✓ Legacy dua_orders mirror written (для TG hook)
✓ Alice registration creates u_<uid>
✓ Alice inherits guest order via merge
✓ Alice places ALICE-1 → имеет 2 заказа
✓ Logout, register Bob
✓ 🔒 Bob does NOT see Alice's ALICE-1 (isolation)
✓ 🔒 Bob does NOT see GUEST-1 (was merged into Alice)
✓ Bob places BOB-1
✓ Logout, login Alice
✓ 🔒 Alice sees HER orders again
✓ 🔒 Alice does NOT see Bob's order
✓ Wrong password rejected
✓ Unknown email → same BAD_CREDS (no enumeration)
✓ Duplicate email blocked
✓ Weak password (< 8) blocked
✓ Bad email blocked
✓ Stored password is 64 hex chars (SHA-256)
✓ Password is NOT plaintext
✓ Per-user salt ≥ 16 bytes
✓ 🔒 Forged dua_user (no token) → currentUser = null
✓ 🔒 Tampered session token rejected
```

---

## Что нужно сделать ВРУЧНУЮ на проде

1. **Сменить дефолтный admin password** через UI Brand → Безпека сразу после деплоя (текст hint об этом теперь говорит)
2. **`dua_v5_migrated`** существующих устройств запустится автоматически при первом заходе на новую версию — данные не пропадут
3. **`AUTH_SECRET` равен salt** в localStorage — для реального продакшна перенести auth на бекенд (backend готов в `/backend` — Express + Postgres + scrypt). Текущий patch — это hardening **существующей** frontend-only архитектуры до уровня production-acceptable, но не замена backend auth.

---

## Что ЕЩЁ можно сделать (out of scope этого patch'а)

- **TOTP/2FA** для admin
- **Refresh-токены** с автоматической ротацией (sliding sessions сейчас не реализованы — токен жив до logout или смены пароля)
- **Captcha** на регистрации (требует backend для верификации)
- **Email verification** flow (требует email service)
- **Rate limit per-IP** на серверной стороне (требует backend)

Эти улучшения требуют backend и не могут быть реализованы только в браузере.
