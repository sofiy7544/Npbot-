# PROJECT_HANDOVER

## Overview
dua — преміум-магазин Stanley (UA). Репо `sofiy7544/Npbot-`, гілка
`claude/claude-md-docs-tkeav6`. GitHub Pages (root) → також домен
`stanleybrand.com.ua` (CNAME готовий, DNS за власником).

## Структура (live = root)
- `index.html` — флагман-лендінг (головна)
- `shop.html` — робочий магазин (кошик/чекаут, SPA, hash-routing) — НЕ ламати
- `catalog.html` — каталог (генерується з `catalog-data.json`)
- `docs/` — ДЗЕРКАЛО root для Pages (синхронізувати кожну зміну!)
- `stanley-brand-site/` — архів вихідного проєкту (не чіпати)
- `tg-ttn-bot/` — Telegram→Nova Poshta бот (окремо)
- `img/` — фото товарів; `img/ig/ig-01..14.webp` — реальні IG-фото
- `catalog-data.json` — товари; `catalog-audience.json`, `catalog-ig-analysis.json` — інсайти

## Зроблено
- Флагман = головна; shop.html = магазин; catalog.html.
- Telegram @stanley_brand_ua (FAB, футер, CTA). CNAME stanleybrand.com.ua. SEO+JSON-LD.
- IG-аналіз: 211 фото → 14 у стрічці. 178 DM-переписок → реальні ціни + аудиторія.
- Реальні ціни: Quencher40=2200, ProTour=2999, LSF=2499, Quencher30=1999.
- Секції: hero, trust, хіти, bento, дроп+таймер, stats, відгуки, IG, Чому ми,
  Доставка&Оплата, FAQ, B2B/опт, CTA. Мобільний bottom-nav, «щойно купили» toast.

## Бізнес-правила (з переписок)
- Сильний B2B/опт: ЄДРПОУ(108×), рахунок. Питання: наявність→ціна→оплата→доставка→колір.
- Попит: аксесуари > Quencher > Camp Mug > ProTour > Starbucks.
- Оплата: передоплата/рахунок + Нова Пошта. Тон формально-ввічливий UA.
- НЕ публікувати сирі переписки (PII) — лише агрегати.

## Готчі
- 32MB ліміт запиту (накопичений контекст+скріни). Працювати малими батчами,
  мінімальними правками, не слати великі картинки, не регенерувати великі файли.
- Мої push НЕ тригерять Pages-білд → інколи потрібен ручний Save у Pages settings.
- Кожну зміну root дублювати в docs/.

## TODO (батчами)
1. ✅ B2B-секція (homepage) — застосовано
2. ✅ «В наявності» бейджі (homepage cards) — застосовано
3. ✅ FAQ опт+наявність — застосовано
4. ⬜ Каталог: бейдж «в наявності» + підняти Аксесуари вище (reorder)
5. ⬜ Нові лінії в каталог: Starbucks, Camp Mug, Transit 16oz, LSF 20oz (фото з IG)
6. ⬜ Мобільна поліровка / перевірка
7. ⬜ Перенести преміум-стиль у shop.html
8. ⬜ srcset/AVIF; прибрати невикористані фото

## Наступний крок
Закоммітити батч 1–3, далі батч 4 (каталог: in-stock + аксесуари вище).
