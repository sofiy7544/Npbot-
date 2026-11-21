/* Дані для всіх картинок Instagram. Змінили ціну → `node build.js` → нові картинки в out/.
   Ціни — як на лендингу (stanley-landing/config.js). Умови доставки/оплати — з основного сайту.
   ПЕРЕВІРТЕ їх перед публікацією. */
module.exports = {
  handle: "@stanley_brand_ua",
  currency: "грн",

  models: [
    { key: "q40", family: "Quencher", size: "40 oz", ml: "1180 мл", cold: "11 год", hot: "7 год", lid: "FlowState, трубочка",
      price: 2200, hero: "q40-cream", tint: "#EADFCB",
      colors: [["q40-cream", "Ваніль", "#E6DDCC"], ["q40-rose", "Рожевий кварц", "#E3C9C3"], ["q40-black", "Чорний 2.0", "#1A1A1C"], ["q40-purple", "Пурпуровий пил", "#B3A9C6"]] },
    { key: "q30", family: "Quencher", size: "30 oz", ml: "887 мл", cold: "11 год", hot: "7 год", lid: "FlowState, трубочка",
      price: 1999, hero: "q30-navy", tint: "#DCE0E6",
      colors: [["q30-black", "Графітовий", "#1A1A18"], ["q30-navy", "Темно-синій", "#37414B"]] },
    { key: "pt30", family: "ProTour", size: "30 oz", ml: "887 мл", cold: "11 год", hot: "7 год", lid: "Flip Straw, не протікає",
      price: 3200, hero: "pt30-orchid", tint: "#E9DCEB",
      colors: [["pt30-cream", "Ваніль", "#E2DED2"], ["pt30-rose", "Рожевий кварц", "#E9DCD7"], ["pt30-frost", "Іній", "#D6DEDF"], ["pt30-orchid", "Орхідея", "#DEBBDE"], ["pt30-mocha", "Мокко-латте", "#A8705F"]] },
    { key: "pt20", family: "ProTour", size: "20 oz", ml: "591 мл", cold: "9 год", hot: "5 год", lid: "Flip Straw, не протікає",
      price: 2500, hero: "pt20-peach", tint: "#F3D9CC",
      colors: [["pt20-cream", "Ваніль", "#E5DED0"], ["pt20-peach", "Персик", "#F1B9B3"], ["pt20-rose", "Рожевий кварц", "#E8DBD6"], ["pt20-frost", "Іній", "#E3E6E9"], ["pt20-orchid", "Орхідея", "#DFBCDF"]] },
  ],

  /* Умови — з основного сайту stanley-brand-site (meta description і бекенд). Перевірте! */
  delivery: [
    ["Нова Пошта по всій Україні", "відділення, поштомат або курʼєр"],
    ["Відправка за 2–3 дні", "після підтвердження замовлення"],
    ["Безкоштовна доставка", "від 5 000 грн"],
  ],
  payment: [
    ["На карту", "повна оплата — Privat24, monobank"],
    ["Накладений платіж", "передплата 200 грн, решта — при отриманні"],
  ],
  warranty: "Гарантія магазину — 6 місяців",
};
