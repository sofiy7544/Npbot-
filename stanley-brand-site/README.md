# DailyUA — інтернет-магазин drinkware зі США

Single-page Web app + admin panel. Без backend, без build-step.

## 📁 Файли

```
index.html         ← Магазин для клієнтів (338 KB)
admin.html         ← Адмінка для тебе (103 KB)
img/               ← 123 фото (3.6 MB)
og-image.png       ← Картинка для соцмереж
robots.txt + sitemap.xml
INSTRUCTIONS.md    ← 📖 Читай першим! Повна інструкція власника
CHANGELOG.md       ← Що змінилось у v2 і v3
```

## 🚀 Швидкий старт

1. Завантаж усю папку на хостинг (Netlify Drop / Cloudflare Pages / GitHub Pages)
2. Відкрий `/admin.html` — увійди з паролем `admin1234`
3. **Зміни пароль** у розділі Brand → Безпека
4. Налаштуй контакти (Telegram username для отримання замовлень)
5. Готово!

Детальна інструкція — у [`INSTRUCTIONS.md`](INSTRUCTIONS.md).

## 🛍 Що вміє магазин

- **12 SKU** Stanley/Owala/Hydro Flask
- **3 мови** (UK/PL/EN), автодетект
- **Telegram-checkout** — замовлення приходять у твій Telegram
- **CRO-фічі** — bundle-знижка, free shipping bar, social proof, sticky CTA, recently viewed
- **SEO** — sitemap, JSON-LD, hreflang, og:image
- **Mobile-first** — адаптивний від iPhone SE до 4K
- **Швидкість** — 75 KB gzip, завантаження <1 сек на 3G

## 🔐 Що вміє адмінка

- Додавати/редагувати товари без коду
- Завантажувати фото (drag & drop, авто-оптимізація)
- Управляти банерами і промо
- Бачити всі замовлення з фільтрами
- Аналітика (топ товарів, виторг, AOV)
- Експорт у код (JS-snippet або patch.js)
- Бекапи і відновлення (JSON-дамп)
- Пароль захист, безпечно для одного користувача

## ⚙️ Технічно

- **Stack:** Vanilla HTML/CSS/JS, без фреймворків
- **State:** localStorage (адмін overrides + замовлення + фото base64)
- **Шрифти:** Playfair Display + DM Sans (з Google Fonts)
- **Hash routing:** SPA з `#shop`, `#product?id=...`, тощо
- **Доступність:** ARIA, focus-visible, prefers-reduced-motion, prefers-color-scheme
- **Сумісність:** всі сучасні браузери (Chrome 90+, Safari 14+, Firefox 88+)

## 📞 Підтримка

Питання — у `INSTRUCTIONS.md` секція FAQ. Технічні баги — в issue tracker.
