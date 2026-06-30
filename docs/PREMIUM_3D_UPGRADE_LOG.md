# PREMIUM 3D UPGRADE — LOG

Прогресивне 3D/анімаційне покращення. Сайт статичний (GitHub Pages, без збірки)
→ бібліотеки через CDN ESM, як progressive enhancement з фолбеком.

## Принципи
- НЕ ламати існуюче. 3D — поверх статичного hero (`<img id="heroImg">` лишається як LCP/фолбек).
- Якщо немає WebGL / `prefers-reduced-motion` / слабкий пристрій / CDN недоступний → тихо лишається фото.
- Жодних build-кроків; `assets/*.js` як `type="module"`, import з jsDelivr.
- Кожну зміну дублювати в `docs/`.

## Бібліотеки (CDN, дозволяють комерц.)
- three@0.160 (MIT) — 3D-ядро
- (план) gsap + ScrollTrigger (безкошт. для standard) / або CSS-анімації
- (план) lenis (MIT) — smooth scroll

## Батчі
1. ✅ 3D-герой: процедурна чашка (Three.js) поверх фото, авто-обертання + parallax, фолбек. Файл `assets/hero3d.js`, canvas у `.stage`.
2. ⬜ Smooth scroll (Lenis) + покращені reveal/parallax (GSAP або CSS).
3. ⬜ Секція «термос у розрізі» (cutaway, шари + підписи).
4. ✅ Каталог: swatch-зміна кольору (Батч C, `assets/catalog-swatch.js`) + 3D hover-preview (`assets/catalog-3d.js`).
5. ⬜ Сторінка товару нового рівня (3D-preview, sticky-buy, специфікації).

## Як перевірити
- Локально: `python3 -m http.server` → відкрити `index.html` на десктопі (WebGL) → чашка обертається; на слабкому/без WebGL → фото.
- Заміна на справжню модель: у `assets/hero3d.js` функція `buildCup()` → замінити на `GLTFLoader` + `.glb` (підготовлено коментарем).

## Команди
- Перегляд: `python3 -m http.server 8080`
- Нічого збирати не треба.

## Статус (остання сесія)
- Батч1 3D-герой ✅  Батч A smooth(Lenis) ✅  Батч B cutaway ✅  Батч C swatch-колір ✅
- Батч C: `assets/catalog-swatch.js` (+ smooth.js підключено в catalog.html).
  Згортає одно-продуктові колірні картки в 1 картку з рядком клік-свотчів
  (фото/назва/колір/цінова крапка міняються). Progressive enhancement, фолбек —
  оригінальні картки. Перевірено: Термокухлі 11→1(11 свотчів), Пляшки 23→2(15+8),
  Лімітки 4→1(4), Аксесуари/Колаборації без змін.
- Батч GSAP-reveal ✅: `assets/reveal.js` — апгрейдить наявний `.reveal`
  (CSS + inline IO) до плавних СТАГЕР-ревілів через GSAP+ScrollTrigger з CDN.
  Безпечно: reduced-motion / CDN-блок → нічого не робить, лишається CSS-ревіл;
  бере лише ще-не-показані елементи (без миготіння above-the-fold). Підключено в index.html.
- Батч 3D-каталог ✅: `assets/catalog-3d.js` — pointer-tilt 3D + парал-зсув фото
  на картках каталогу. Тільки fine-pointer, reduced-motion → no-op; на leave
  чистить inline-transform (базовий hover повертається). Йде ПІСЛЯ swatch.
- Батч product-page ✅ (обрано варіант 1 — нова standalone `product.html`):
  data-driven з `catalog-data.json` за `?id=`. 3D-tilt галерея, свотчі кольорів
  (зміна фото/назви/ціни/URL без перезавантаження), thumbs, характеристики,
  переваги-чіпи, FAQ (details), схожі товари, sticky buy-bar, динамічний
  SEO (title/desc/canonical/og) + JSON-LD Product. shop.html НЕ чіпали.
  Фолбеки: reduced-motion / touch → без tilt; невідомий id → перший товар / меседж.
- Батч лінкування ✅: `catalog-swatch.js` тепер фетчить `catalog-data.json`,
  будує мапу img→id і робить фото+назву кожної картки лінком на `product.html?id=`.
  Колапс лишається синхронним (без миготіння), лінки активуються після фетчу;
  href оновлюється при кліку свотча. Картка без товару в даних (Starbucks ig-09)
  лишається без лінка. Сумісно з catalog-3d (tilt працює поверх).
- РОАДМАП ВИКОНАНО: 3D-герой, smooth, cutaway, swatch, GSAP-reveal, 3D-каталог,
  сторінка товару, лінкування.
- Батч 3D-related ✅: tilt на картках «Схожі товари» в product.html.
- Батч галерея-ракурси + чистка ✅: product.html тепер показує мульти-ракурс
  (спереду/ззаду/кришка) — пробує похідні імена `-back/-lid`, рядок thumbs
  з'являється лише якщо ракурси існують (37/40 товарів мають). Це повертає в обіг
  «невикористані» -back/-lid фото. Видалено 38 справді-сирих файлів (img/IMG_*
  не-référenced + cases/*@thumb дублі) з root і docs — ТІЛЬКИ з перевіреного
  списку (НЕ глобом: частина IMG_* використовується shop/admin).
- AVIF/srcset: НЕ зроблено — у цій пісочниці немає енкодерів (avifenc/cwebp/sharp)
  і немає мережі для встановлення. webp вже сучасний і легкий (16–24KB). Робити
  на машині з енкодерами; <picture> з AVIF підключати ЛИШЕ після генерації файлів.
- Батч shop-преміум ✅: `assets/shop-premium.js` — 3D-tilt на `.pcard__media`
  у магазині, з ре-скануванням на hashchange + MutationObserver (SPA ре-рендерить
  картки). Тільки fine-pointer; reduced-motion → no-op. НЕ чіпає чекаут/кошик:
  inline-transform на елементі без власного transform (hover-lift і scale цілі).
  shop.html уже мав swatches/reveal/sticky-CTA/premium-patch — додано лише tilt.
- Батч AVIF (готово до активації) ✅: додано пайплайн без ламання:
  - `scripts/make-avif.mjs` — генерує `.avif` поряд з кожним `.webp` під `img/`
    і пише `img/avif-manifest.json` (потрібен sharp: `npm i -D sharp`).
  - `assets/avif.js` — апгрейдить webp→avif у рантаймі ТІЛЬКИ для шляхів з
    маніфесту і ТІЛЬКИ якщо браузер підтримує avif. Без маніфесту — no-op (0 запитів),
    битих картинок не буває (свопаємо src, не <picture>). Підключено на
    index/catalog/product/shop (+docs).
  - ЯК АКТИВУВАТИ (на машині з тулзами/мережею): `npm i -D sharp` →
    `node scripts/make-avif.mjs` → `cp -r img/* docs/img/` → commit (avif + manifest).
- Далі (опц.): мобільна поліровка; srcset (кілька ширин) якщо знадобиться.
- Продовжувати в НОВОМУ чаті за цим логом + PROJECT_HANDOVER.md.
