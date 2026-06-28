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
- Далі: сторінка товару нового рівня — ВІДКРИТЕ ПИТАННЯ архітектури
  (нова standalone product.html vs покращити SPA-картку в shop.html — НЕ ламати чекаут).
- Продовжувати в НОВОМУ чаті за цим логом + PROJECT_HANDOVER.md.
