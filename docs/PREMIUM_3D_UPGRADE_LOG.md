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
4. ⬜ Каталог: 3D/preview hover, swatch-зміна кольору.
5. ⬜ Сторінка товару нового рівня (3D-preview, sticky-buy, специфікації).

## Як перевірити
- Локально: `python3 -m http.server` → відкрити `index.html` на десктопі (WebGL) → чашка обертається; на слабкому/без WebGL → фото.
- Заміна на справжню модель: у `assets/hero3d.js` функція `buildCup()` → замінити на `GLTFLoader` + `.glb` (підготовлено коментарем).

## Команди
- Перегляд: `python3 -m http.server 8080`
- Нічого збирати не треба.

## Статус (остання сесія)
- Батч1 3D-герой ✅  Батч A smooth(Lenis) ✅  Батч B cutaway ✅
- Перевірено текстом: index/catalog/shop — 0 помилок, cutaway на index присутній.
- Далі: C swatch-колір у каталозі; GSAP reveal; сторінка товару; 3D у каталозі.
- Продовжувати в НОВОМУ чаті за цим логом + PROJECT_HANDOVER.md.
