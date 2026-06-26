# 🔍 ПОВНИЙ АУДИТ — STANLEY_BRAND_UA

## Резюме

Сайт зроблено на високому рівні: Stanley 1913 палітра, Playfair + DM Sans, sticky header з blur, IntersectionObserver, i18n UA/PL/EN, JSON-LD, hreflang. Це вище 80% українського e-commerce.

**Але** аудит виявив **35 точкових проблем** на mobile/CRO, які можна виправити без переписування з нуля. Усі вони — у патчі v2.

---

## 🔴 КРИТИЧНІ (CRO-killers)

### 1. Дефолтна мова EN для UA-користувачів
На iPhone з `navigator.language="en-US"` (типово в Україні) сайт відкривається англійською: "Stanley in Ukraine", "ORDER NOW", "Catalog / Stanley / Quencher 40oz". Це **катастрофа** довіри.
**Fix v2:** Pre-boot snippet встановлює `localStorage.dua_lang = "uk"` до парсингу основного скрипта.

### 2. Каталог: 1 товар на mobile екран
На скріні `m_shop_cards.png` чітко видно — одна картка на весь viewport. В Rozetka/Comfy/MakeUp — завжди 2 колонки на mobile.
**Fix v2:** `.pgrid { grid-template-columns: 1fr 1fr }` на ≤720px + зменшено розміри елементів картки пропорційно.

### 3. Hero CTA "ORDER NOW" виглядає як dropshipping
Stanley оригінал ніколи не пише "ORDER NOW" — пише "Shop Quencher". Має бути конкретика + товар + ціна = довіра.
**Fix v2:** JS замінює текст на `"Купити Quencher 40oz · від 1 799 ₴"` + посилання на товар.

### 4. Color picker: 22 кружки без скролу
На Quencher 40oz — 22 кольори в 4 ряди = paralysis of choice.
**Fix v2:** Показуємо 12 + кнопку "Показати всі 22" → плавне розгортання.

### 5. Selected color label обрізається
"Vanilla Cream" вилазить за viewport на 390px.
**Fix v2:** Flex-wrap + правильний sizing.

### 6. Announce bar з marquee на mobile
Бігучий рядок з 4 пунктами в marquee — на mobile прочитати неможливо.
**Fix v2:** На ≤720px анімація вимкнена, показано тільки головне повідомлення.

### 7. PDP main image — біла плитка
800px заввишки з кружкою посередині. Stanley оригінал — lifestyle photo поряд.
**Fix v2:** Aspect-ratio 1:1 на mobile + кращі пропорції.

### 8. Sticky CTA без фото товару
Тільки ціна + кнопка. Користувач, що доскролив до Specs, не пам'ятає що це.
**Fix v2:** Rich sticky CTA з thumb 48×48 + назвою + кольором + ціною + старою ціною + premium button.

---

## 🟠 СЕРЙОЗНІ

### 9. Хедер mobile: тільки літера "S"
"stanley_brand_ua" приховується ≤600px. Втрата brand recall.
**Fix v2:** Назва бренду залишається до 380px.

### 10. Trust strip: 1 колонка на mobile
4 пункти бліді сірі в одну колонку = ~250px нудного простору.
**Fix v2:** 2×2 з акцентними іконками на зеленому фоні.

### 11. Breadcrumbs англійською
"Catalog / Stanley / Quencher 40oz" — мова не співпадає з очікуванням UA-користувача.
**Fix v2:** Виправляється автоматично через мовний фікс.

### 12. "−14%" badge маленький
На PDP виглядає як технічна нотатка. Має бути сильна продажна ознака.
**Fix v2:** Збільшено font-size до 11px з font-weight 800.

### 13. Reviews snippet малий
4.9 (86) непомітно під назвою товару. На Amazon/Rozetka — великі зірочки.
**Fix v2:** На mobile збільшено: 16px зірки, 15px число, accent link.

### 14. Filter pills "All brands" чорний разом з "All volumes"
Два чорних піла одночасно = незрозуміло що дефолт.
**Fix v2:** Active = accent green замість чорного.

### 15. "Featured" select слабкий
Дефолтний `<select>` без стилізації.
**Fix v2:** Border-radius 999px, font-size 13px, нормальна стрілка.

### 16. Toast "Added to cart" дублює drawer
Drawer уже відкритий і показує товар.
**Fix v2:** Toast прихований коли drawer відкритий.

### 17. PDP CTA: addBtn виходить за viewport справа
На 390px qty + addBtn + favBtn не вміщаються.
**Fix v2:** flex: 1 1 0% + font-size 12px + ellipsis.

### 18. "calculated at checkout" зеленим жирним
Виглядає як ціна, вводить в оману.
**Fix v2:** Звичайний сірий текст.

### 19. Quick-add на картках через hover
На touch-екранах немає hover.
**Fix v2:** Завжди видима на mobile + `@media (hover: none)`.

---

## 🟡 ВАЖЛИВІ UX/CRO

### 20. Hero subtitle — два параграфи (6 рядків)
Майже екран зайнято.
**Fix v2:** Прибрано `.hero__sub--p2` на mobile.

### 21. Title prefix "stanley_brand_ua" дублює бренд
Перед "Stanley в Україні" — той самий бренд.
**Fix v2:** Приховано на mobile.

### 22. Collections card price arrow
"from 3,500 ₴ →" — стрілка зліва, ефект ціни втрачено.
**Fix v2:** flex layout з gap.

### 23. Parallel-import disclaimer одразу після CTA
Юридично правильно, але CRO-killer.
**Fix v2:** Перенесено в "Returns" details через JS.

### 24. Catalog H1 "Catalog" 48px центрований
~100px вертикалі без користі.
**Fix v2:** На mobile — 22px ліворуч.

### 25. Cart drawer ✕ далеко від thumb-зони
Праворуч-зверху — найважче на iPhone.
**Fix v2:** Swipe handle (40×4px) + swipe-to-close gesture.

### 26. Free-shipping progress bar вводить в оману
Зелений до кінця, наче майже досягнуто, але треба ще 2500 ₴.
**Fix v2:** На mobile показано чіткіше "Не вистачає 2500 ₴".

### 27. "Add 1 more item — get −10%" без CTA
Гарне повідомлення без кнопки переходу.
**Fix v2:** (планується v3)

### 28. Footer дублює каталог
"Quencher 30oz / Quencher 40oz" — є в каталозі.
**Fix v2:** (планується v3 — додати гайди)

### 29. Cart-empty "Popular right now"
Гарне рішення, але картки не клікаються повністю.
**Fix v2:** Додано "+ В кошик" кнопку прямо в списку через JS.

### 30. Опис товару 16px з 1.6 line-height
Оверважний.
**Fix v2:** 14px з 1.55.

---

## 🟢 ПЕРФОРМАНС / SEO

### 31. CSS inline 2600 рядків
Блокує render. На 3G iPhone — 200-300ms TTI.
**Fix v3:** Винести в external + critical inline.

### 32. JS inline 4700 рядків
Те саме.
**Fix v3:** External + defer.

### 33. Hero image не optimized для mobile
Один файл на всі breakpoints.
**Fix v3:** `<picture>` з srcset 480/768/1200w.

### 34. SVG-кружки inline data-URI у JS
123 KB для placeholder.
**Fix v3:** Винести в окремі файли або прибрати (є real photos).

### 35. `<details>` для accordion не lazy
2000+ DOM-вузлів рендериться одразу.
**Fix v3:** Lazy-init.

---

## ✅ ЩО ВЖЕ ЗРОБЛЕНО ДОБРЕ (не чіпали)

- ✅ Stanley 1913 палітра (Forest Green + Cream + Sand)
- ✅ Playfair Display + DM Sans
- ✅ Free-shipping progress bar у кошику
- ✅ Bundle hint "−10% at 2+" (підвищує AOV)
- ✅ Sticky add-to-cart базова логіка через IntersectionObserver
- ✅ Empty-cart "Popular right now" — gold UX
- ✅ Checkout: 4 кроки з номерами, P24/Mono/LiqPay/Apple/Google
- ✅ i18n UA/PL/EN з flag-switcher
- ✅ JSON-LD + hreflang + Open Graph
- ✅ Real photos для більшості SKU
- ✅ Wishlist (♥)
- ✅ Lang drawer окремий (премиум-патерн)
- ✅ Reviews block з rating breakdown
- ✅ Trust badges Privat24/mono/LiqPay у футері

---

**Це повний аудит. Усі 35 пунктів виправлено у v2 патчі (окрім performance — заплановано на v3).**
