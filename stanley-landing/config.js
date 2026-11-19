/* =====================================================================
   НАЛАШТУВАННЯ ЛЕНДИНГУ — єдиний файл, який треба редагувати.
   Моделі, ціни, кольори, фото, характеристики, тексти, прийом замовлень.

   Правила:
   • Рядки — у лапках "…". Після кожного елемента — кома.
   • Порожнє значення ("" або null) = блок/рядок НЕ показується на сайті.
   • Фото кладіть у папку img/ і пишіть шлях "img/назва.webp".
   • Цей самий файл читає сервер (server/server.js), щоб перерахувати суму
     замовлення — тому ціну міняти ТІЛЬКИ тут.

   Посилання на конкретну модель (для різних реклам у TikTok):
     https://ваш-сайт/?model=q40   ← Quencher 40 oz
     https://ваш-сайт/?model=q30   ← Quencher 30 oz
     https://ваш-сайт/?model=pt30  ← ProTour 30 oz
     https://ваш-сайт/?model=pt20  ← ProTour 20 oz
   (slug — поле "slug" у кожної моделі нижче)

   Характеристики та фото — з основного сайту stanley-brand-site.
   Ціни — з прайсу (листопад 2026). Перевірте перед запуском реклами.
   ===================================================================== */
window.LANDING_CONFIG = {

  /* ---------- Бренд ---------- */
  brand: {
    name: "stanley_brand_ua",
    instagram: "https://www.instagram.com/stanley_brand_ua/",
    telegram: "https://t.me/stanley_brand_ua",
    phone: "",            // напр. "+380 67 123 45 67"
    email: "",
  },

  currency: "₴",
  maxQty: 10,             // максимум штук в одному замовленні
  defaultModel: "q40",    // яка модель відкривається без ?model=

  /* ---------- Моделі ----------
     Порядок у списку = порядок кнопок вибору моделі.
     oldPrice — стара (закреслена) ціна; null — без знижки.
     colors: перший колір — за замовчуванням; images: перше фото — головне. */
  products: [
    {
      slug: "q40",
      id: "stanley-quencher-40",
      name: "Stanley Quencher 40 oz",
      short: "Quencher 40 oz",
      tagline: "Термокружка на цілий день: 1180 мл, холод до 11 годин.",
      description: "Лінія 2.0 — оновлена палітра й покриття. Кришка FlowState з трьома позиціями, ручка, трубочка. Поміщається у підстаканник авто.",
      price: 2200,
      oldPrice: null,
      badge: "Хіт продажів",
      colors: [
        { id: "cream",  name: "Ваніль",         hex: "#E6DDCC", images: ["img/q40-cream-front.webp", "img/q40-cream-back.webp", "img/q40-cream-lid.webp"] },
        { id: "rose",   name: "Рожевий кварц",  hex: "#E3C9C3", images: ["img/q40-rose-front.webp", "img/q40-rose-back.webp"] },
        { id: "black",  name: "Чорний 2.0",     hex: "#1A1A1C", images: ["img/q40-black-front.webp", "img/q40-black-back.webp", "img/q40-black-lid.webp"] },
        { id: "purple", name: "Пурпуровий пил", hex: "#B3A9C6", images: ["img/q40-purple-front.webp", "img/q40-purple-back.webp"] },
      ],
      highlights: [
        { icon: "cold",   value: "11 год",  label: "тримає холод" },
        { icon: "hot",    value: "7 год",   label: "тримає тепло" },
        { icon: "volume", value: "1180 мл", label: "обʼєм (40 oz)" },
        { icon: "steel",  value: "18/8",    label: "нержавіюча сталь" },
      ],
      specs: [
        { label: "Обʼєм",        value: "1180 мл (40 oz)" },
        { label: "Тримає холод", value: "до 11 годин" },
        { label: "Тримає тепло", value: "до 7 годин" },
        { label: "Тримає лід",   value: "до 2 діб" },
        { label: "Матеріал",     value: "Нержавіюча сталь 18/8, подвійні стінки" },
        { label: "Кришка",       value: "FlowState, 3 позиції" },
        { label: "Висота",       value: "36 см" },
        { label: "Діаметр",      value: "верх 9,5 см · низ 7 см" },
        { label: "Вага",         value: "600 г" },
        { label: "Догляд",       value: "Можна мити в посудомийці" },
        { label: "Безпека",      value: "BPA-free" },
        { label: "Гарантія",     value: "" },
      ],
      inBox: ["Термокружка — 1 шт.", "Кришка FlowState", "Трубочка"],
    },

    {
      slug: "q30",
      id: "stanley-quencher-30",
      name: "Stanley Quencher 30 oz",
      short: "Quencher 30 oz",
      tagline: "Класичний Quencher: 887 мл, холод до 11 годин.",
      description: "Подвійні стінки з нержавіючої сталі 18/8. Кришка FlowState з трьома позиціями, ручка, трубочка. Поміщається у підстаканник авто.",
      price: 1999,
      oldPrice: null,
      badge: "",
      colors: [
        { id: "black", name: "Графітовий",  hex: "#1A1A18", images: ["img/q30-black-front.webp"] },
        { id: "navy",  name: "Темно-синій", hex: "#37414B", images: ["img/q30-navy-front.webp"] },
      ],
      highlights: [
        { icon: "cold",   value: "11 год", label: "тримає холод" },
        { icon: "hot",    value: "7 год",  label: "тримає тепло" },
        { icon: "volume", value: "887 мл", label: "обʼєм (30 oz)" },
        { icon: "car",    value: "Авто",   label: "поміщається у підстаканник" },
      ],
      specs: [
        { label: "Обʼєм",        value: "887 мл (30 oz)" },
        { label: "Тримає холод", value: "до 11 годин" },
        { label: "Тримає тепло", value: "до 7 годин" },
        { label: "Тримає лід",   value: "до 2 діб" },
        { label: "Матеріал",     value: "Нержавіюча сталь 18/8, подвійні стінки" },
        { label: "Кришка",       value: "FlowState, 3 позиції" },
        { label: "Висота",       value: "31 см" },
        { label: "Діаметр",      value: "верх 9 см · низ 7 см" },
        { label: "Вага",         value: "510 г" },
        { label: "Догляд",       value: "Можна мити в посудомийці" },
        { label: "Безпека",      value: "BPA-free" },
        { label: "Гарантія",     value: "" },
      ],
      inBox: ["Термокружка — 1 шт.", "Кришка FlowState", "Трубочка"],
    },

    {
      slug: "pt30",
      id: "stanley-protour-30",
      name: "Stanley ProTour 30 oz",
      short: "ProTour 30 oz",
      tagline: "Відкидна трубочка Flip Straw — не протікає навіть у сумці.",
      description: "Натиснув кнопку — трубочка відкрилась, попив, закрив. Не протікає у будь-якому положенні. 887 мл, поміщається у підстаканник авто.",
      price: 3200,
      oldPrice: null,
      badge: "Новинка",
      colors: [
        { id: "cream",  name: "Ваніль",        hex: "#E2DED2", images: ["img/pt30-cream-front.webp", "img/pt30-cream-back.webp", "img/pt30-cream-lid.webp"] },
        { id: "rose",   name: "Рожевий кварц", hex: "#E9DCD7", images: ["img/pt30-rose-front.webp", "img/pt30-rose-back.webp"] },
        { id: "frost",  name: "Іній",          hex: "#D6DEDF", images: ["img/pt30-frost-front.webp", "img/pt30-frost-back.webp"] },
        { id: "orchid", name: "Орхідея",       hex: "#DEBBDE", images: ["img/pt30-orchid-front.webp", "img/pt30-orchid-back.webp"] },
        { id: "mocha",  name: "Мокко-латте",   hex: "#A8705F", images: ["img/pt30-mocha-front.webp", "img/pt30-mocha-back.webp"] },
      ],
      highlights: [
        { icon: "lid",    value: "Flip Straw", label: "не протікає" },
        { icon: "cold",   value: "11 год",     label: "тримає холод" },
        { icon: "hot",    value: "7 год",      label: "тримає тепло" },
        { icon: "volume", value: "887 мл",     label: "обʼєм (30 oz)" },
      ],
      specs: [
        { label: "Обʼєм",        value: "887 мл (30 oz)" },
        { label: "Тримає холод", value: "до 11 годин" },
        { label: "Тримає тепло", value: "до 7 годин" },
        { label: "Кришка",       value: "Flip Straw з фіксацією" },
        { label: "Герметичність", value: "Не протікає у будь-якому положенні" },
        { label: "Матеріал",     value: "Нержавіюча сталь 18/8" },
        { label: "Висота",       value: "30 см" },
        { label: "Діаметр",      value: "верх 9 см · низ 7 см" },
        { label: "Вага",         value: "540 г" },
        { label: "Догляд",       value: "Можна мити в посудомийці" },
        { label: "Безпека",      value: "BPA-free" },
        { label: "Гарантія",     value: "" },
      ],
      inBox: ["Термокружка — 1 шт.", "Кришка Flip Straw", "Трубочка"],
    },

    {
      slug: "pt20",
      id: "stanley-protour-20",
      name: "Stanley ProTour 20 oz",
      short: "ProTour 20 oz",
      tagline: "Компактна 591 мл з кришкою Flip Straw — для авто, спорту, поїздок.",
      description: "Натиснув кнопку — трубочка відкрилась, попив, закрив. Не протікає у сумці. Поміщається у будь-який підстаканник.",
      price: 2500,
      oldPrice: null,
      badge: "Новинка",
      colors: [
        { id: "cream",  name: "Ваніль",        hex: "#E5DED0", images: ["img/pt20-cream-front.webp", "img/pt20-cream-back.webp", "img/pt20-cream-lid.webp"] },
        { id: "peach",  name: "Персик",        hex: "#F1B9B3", images: ["img/pt20-peach-front.webp", "img/pt20-peach-back.webp"] },
        { id: "rose",   name: "Рожевий кварц", hex: "#E8DBD6", images: ["img/pt20-rose-front.webp", "img/pt20-rose-back.webp"] },
        { id: "frost",  name: "Іній",          hex: "#E3E6E9", images: ["img/pt20-frost-front.webp", "img/pt20-frost-back.webp"] },
        { id: "orchid", name: "Орхідея",       hex: "#DFBCDF", images: ["img/pt20-orchid-front.webp", "img/pt20-orchid-back.webp"] },
      ],
      highlights: [
        { icon: "lid",    value: "Flip Straw", label: "не протікає" },
        { icon: "cold",   value: "9 год",      label: "тримає холод" },
        { icon: "hot",    value: "5 год",      label: "тримає тепло" },
        { icon: "volume", value: "591 мл",     label: "обʼєм (20 oz)" },
      ],
      specs: [
        { label: "Обʼєм",        value: "591 мл (20 oz)" },
        { label: "Тримає холод", value: "до 9 годин" },
        { label: "Тримає тепло", value: "до 5 годин" },
        { label: "Кришка",       value: "Flip Straw з фіксацією" },
        { label: "Герметичність", value: "Не протікає у сумці" },
        { label: "Матеріал",     value: "Нержавіюча сталь 18/8" },
        { label: "Висота",       value: "24 см" },
        { label: "Діаметр",      value: "верх 8 см · низ 6,5 см" },
        { label: "Вага",         value: "410 г" },
        { label: "Догляд",       value: "Можна мити в посудомийці" },
        { label: "Безпека",      value: "BPA-free" },
        { label: "Гарантія",     value: "" },
      ],
      inBox: ["Термокружка — 1 шт.", "Кришка Flip Straw", "Трубочка"],
    },
  ],

  /* Фото «в житті» під галереєю. "" — не показувати. */
  lifestyleImage: "img/hero-stanley-pastel.webp",

  /* Короткі пункти довіри під кнопкою «Купити». [] — не показувати. */
  trust: [
    "Доставка Новою Поштою по Україні",
    "Оплата після підтвердження менеджером",
  ],

  /* ---------- Прийом замовлень ----------
     "/api/order" — вбудований сервер server/server.js (рекомендовано)
     ""           — прийом не налаштовано: сайт чесно покаже, що замовлення
                    не відправлено, і запропонує написати в Instagram/Telegram. */
  order: {
    endpoint: "/api/order",
    timeoutMs: 15000,
    repeatWindowMin: 15,
  },

  tiktokPixelId: "",       // ID пікселя TikTok Ads — "" вимикає

  /* ---------- Тексти інтерфейсу ---------- */
  texts: {
    buy: "КУПИТИ",
    submit: "ОФОРМИТИ ЗАМОВЛЕННЯ",
    sending: "Надсилаємо…",
    discount: "Знижка",
    model: "Модель",
    modelsTitle: "Інші моделі",
    color: "Колір",
    galleryTitle: "З усіх боків",
    highlightsTitle: "Чому її обирають",
    specsTitle: "Характеристики",
    inBoxTitle: "У комплекті",
    orderTitle: "Оформлення замовлення",
    orderLead: "Залиште контакти — менеджер зателефонує, підтвердить замовлення та уточнить доставку.",
    firstName: "Імʼя",
    lastName: "Прізвище",
    phone: "Телефон",
    qty: "Кількість",
    summaryTitle: "Ваше замовлення",
    total: "Разом",
    note: "Натискаючи кнопку, ви підтверджуєте замовлення. Оплата — лише після дзвінка менеджера.",
    successTitle: "Дякуємо! Ваше замовлення прийнято.",
    successText: "Ми звʼяжемося з вами для підтвердження.",
    orderNo: "Номер замовлення",
    newOrder: "Оформити ще одне",
    errName: "Вкажіть імʼя (лише літери)",
    errLastName: "Вкажіть прізвище (лише літери)",
    errPhone: "Введіть номер повністю: +380 XX XXX XX XX",
    errNetwork: "Не вдалося надіслати замовлення. Перевірте інтернет і спробуйте ще раз.",
    errServer: "Замовлення не надіслано через помилку сервера. Спробуйте ще раз або напишіть нам.",
    errNotConfigured: "Онлайн-прийом замовлень тимчасово недоступний. Замовлення НЕ надіслано — напишіть нам, і ми все оформимо.",
    errRateLimit: "Забагато спроб. Зачекайте кілька хвилин і спробуйте ще раз.",
    repeatWarn: "Ви вже оформили таке замовлення {min} хв тому (№ {id}). Надіслати ще одне?",
    writeUs: "Написати нам",
  },
};
