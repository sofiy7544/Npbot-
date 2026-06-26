# ROUND-2 CHANGELOG · 12 May 2026

Виправлення за зворотним звʼязком зі скрінів 2785–2795.

---

## Що змінено

### Файли додано
- `premium-patch-v2.css` (642 рядки) — round-2 visual fixes
- `premium-patch-v2.js` (461 рядок) — premium alert, status card, lang fix, COD explainer

### Файли змінено
- `index.html` — підключено v2 patches, BRAND контакти оновлено, `data-volume` на pdp/pcard media
- `premium-patch.css` — насиченіший cream gradient (`#F4ECD7→#ECE0C2→#D9C99F` замість майже-білого `#FBF7EF`)
- `premium-patch.js` — auto-disable Mono Pay коли apiBase порожній

---

## Вирішені проблеми (зі скрінів)

| # | Скрін | Проблема | Як виправлено |
|---|---|---|---|
| 1 | IMG_2795 | Кнопки PL/EN/UK не клікаються в lang drawer | Делегований click handler у `premium-patch-v2.js` через `document.addEventListener('click', …, true)` — біндинг тепер працює одразу |
| 2 | IMG_2794 | `alert("Failed to fetch")` від Mono | Якщо `apiBase` порожній — кнопка Mono Pay прихована. Якщо є але впав — premium-modal замість browser alert, з пропозицією переключитись на Privat24 |
| 3 | IMG_2794 | На confirmation одразу зелена галочка, навіть до підтвердження банку | Тепер 3 стани: `pending` (Mono — крутиться загрузчик), `cod-pending` (накладений — «очікуємо предоплату 200 ₴» + кнопка TG), `paid` (зелена галочка). Polling статусу через `/api/mono/status` |
| 4 | IMG_2794 | Немає нагадування про ліміти інтернет-платежів | Додано картку `.payment-limits-reminder` під status-card з порадою як збільшити ліміт |
| 5 | IMG_2790 | "Адмінка магазину" в особистому кабінеті клієнта | Прихована через CSS селектори + JS-обхід для динамічного контенту |
| 6 | IMG_2790 | Реферальний блок майже невидимий (тонкий текст на тонкому тлі) | Перебудовано як premium dark-green картку з білим текстом, accent-glow, монотипним полем для реф-посилання, stat-grid внизу |
| 7 | IMG_2793 | Незрозуміла COD логіка | Додано `.cod-explainer` що зʼявляється при кліку на накладений: «Передплата 200 ₴ через Mono/Privat → відправляємо. Решту при отриманні. Без передплати накладений не оформляємо.» |
| 8 | IMG_2793 | Уродські значки P24 / mono / L | Замінено на real-brand SVG: Privat24 (green pill), Monobank (чорний з підписом), LiqPay (синій), Apple Pay (з логотипом), Google Pay (з G), COD (іконка готівки) |
| 9 | IMG_2787/2789 | Білий фон навколо фото в карточках замість cream | Cream-градієнт зроблено насиченим (`#F4ECD7→#D9C99F`), додано inset highlight + ground shadow. Перебиває `mobile-cro-patch.css` |
| 10 | IMG_2791 | 30oz і 40oz виглядають однаково — нема ієрархії | `data-volume` атрибут на `.pdp__media` і `.pcard__media`. CSS: 30oz `max-width: 70%`, 40oz `max-width: 82%`. Тепер 40oz візуально помітно більший |
| 11 | IMG_2788 | "Придумані" контакти `+380 44 333 22 11`, `hello@stanleybrandua.com` | Замінено на `+380 67 124 28 64` і `stanley.brand.ua@gmail.com` (19+ місць через sed). Власник магазину легко замінить у `BRAND` обʼєкті |

---

## Як перевірити

1. **Languages**: відкрий головну → клікни прапор у хедері → переключи на PL/EN — має одразу перемалювати весь сайт мовою
2. **Mono Pay не зʼявляється в checkout** (бо `apiBase: ""`). Якщо хочеш бачити її — задеплой backend і встав URL у `STANLEY_CONFIG.apiBase` в `index.html`
3. **Confirmation states**: оформи замовлення з COD — побачиш `cod-pending` стан з оранжевим спіннером і кнопкою TG. З Privat24 — одразу зелена галочка
4. **Карточки товарів**: всі мають насичений cream-фон з тінню під товаром
5. **40oz vs 30oz**: на `/#shop?vol=40oz` карточки помітно більше товари, ніж на `/#shop?vol=30oz`
6. **Payment icons**: перейди до checkout → секція Оплата — побачиш правильні бренд-стилі (зелений Privat24, чорний mono, синій LiqPay)
7. **Lightbox cream**: клік на головне фото товару — відкривається cream stage з blur backdrop (не білий, не чорний)

---

## Конфігурація після деплою backend

У `index.html` знайди:
```js
window.STANLEY_CONFIG = {
  apiBase: "",      // ← вставити URL твого Railway/Render backend
  monoEnabled: false,
};
```

Просто встав URL — Mono Pay автоматично зʼявиться, premium status flow підхопить polling статусу платежу.

---

## Контакти у BRAND

В `index.html` рядок 2920:
```js
const BRAND = Object.freeze({
  name: "stanley_brand_ua",
  email: "stanley.brand.ua@gmail.com",   // ← поточна тимчасова
  phone: "+380 67 124 28 64",             // ← поточна тимчасова
  ...
});
```

Заміни на свої реальні. `Object.freeze` означає, що це константа — змінюй прямо у файлі перед deploy.
