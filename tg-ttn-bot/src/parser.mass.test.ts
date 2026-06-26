/**
 * MASS stress test — 50+ cases covering everything shop owners and dropshippers
 * actually send in real Ukrainian Telegram groups.
 *
 * Categories:
 *   1) ALL 24 oblast capitals (Cyrillic)
 *   2) Latin transliterations
 *   3) Multi-word cities
 *   4) Phone format variations
 *   5) Message structures (labeled, free-form, comma, numbered, RU vs UA)
 *   6) Warehouse types (відділення/поштомат/кур'єр + abbreviations)
 *   7) Payment variations
 *   8) Group-forwarded SMS formats
 *
 * Each case checks: parsed name, phone, city, warehouse type+number, cost.
 * Only fields present in `expect` are checked — others can be anything.
 */
import { parseOrder, isDraftReady } from "./parser.js";

type Expect = {
  name?: string;
  phone?: string;
  city?: string;
  warehouseType?: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  cost?: number;
  ready?: boolean;
};

type Case = { name: string; text: string; expect: Expect };

const cases: Case[] = [
  // ─── 1) 24 OBLAST CAPITALS (Cyrillic) ───────────────────────────────
  { name: "OBL: Київ", text: "Іваненко Олег\n0501112233\nКиїв № 5\n2000", expect: { city: "Київ", warehouseNumber: "5" } },
  { name: "OBL: Львів", text: "Петренко Анна\n0502223344\nЛьвів відділення 12\n1500", expect: { city: "Львів", warehouseNumber: "12" } },
  { name: "OBL: Харків", text: "Сидоренко Петро\n0503334455\nХарків НП 7\n2500", expect: { city: "Харків", warehouseNumber: "7" } },
  { name: "OBL: Одеса", text: "Бондар Ірина\n0504445566\nОдеса № 22\n1800", expect: { city: "Одеса", warehouseNumber: "22" } },
  { name: "OBL: Дніпро", text: "Коваль Сергій\n0505556677\nДніпро поштомат 14\n2200", expect: { city: "Дніпро", warehouseType: "postomat", warehouseNumber: "14" } },
  { name: "OBL: Запоріжжя", text: "Лисенко Юлія\n0506667788\nЗапоріжжя № 9\n1900", expect: { city: "Запоріжжя", warehouseNumber: "9" } },
  { name: "OBL: Вінниця", text: "Шевченко Олена\n0507778899\nВінниця відд. 3\n2100", expect: { city: "Вінниця", warehouseNumber: "3" } },
  { name: "OBL: Полтава", text: "Гриценко Тарас\n0508889900\nПолтава 11\n2300", expect: { city: "Полтава", warehouseNumber: "11" } },
  { name: "OBL: Чернівці", text: "Романюк Марія\n0509990011\nЧернівці № 4\n1700", expect: { city: "Чернівці", warehouseNumber: "4" } },
  { name: "OBL: Чернігів", text: "Мельник Іван\n0671112233\nЧернігів НП 6\n2400", expect: { city: "Чернігів", warehouseNumber: "6" } },
  { name: "OBL: Хмельницький", text: "Кучер Олег\n0672223344\nХмельницький 2\n2000", expect: { city: "Хмельницький", warehouseNumber: "2" } },
  { name: "OBL: Тернопіль", text: "Бойко Світлана\n0673334455\nТернопіль відділення 8\n1850", expect: { city: "Тернопіль", warehouseNumber: "8" } },
  { name: "OBL: Івано-Франківськ", text: "Дзюба Андрій\n0674445566\nІвано-Франківськ № 5\n2150", expect: { city: "Івано-Франківськ", warehouseNumber: "5" } },
  { name: "OBL: Луцьк", text: "Захарчук Олена\n0675556677\nЛуцьк 10\n1950", expect: { city: "Луцьк", warehouseNumber: "10" } },
  { name: "OBL: Рівне", text: "Гуцул Богдан\n0676667788\nРівне НП 4\n2050", expect: { city: "Рівне", warehouseNumber: "4" } },
  { name: "OBL: Житомир", text: "Тарасенко Алла\n0677778899\nЖитомир поштомат 5\n1750", expect: { city: "Житомир", warehouseType: "postomat", warehouseNumber: "5" } },
  { name: "OBL: Суми", text: "Лук'яненко Ольга\n0678889900\nСуми № 7\n2250", expect: { city: "Суми", warehouseNumber: "7" } },
  { name: "OBL: Кропивницький", text: "Васильєв Максим\n0679990011\nКропивницький 3\n1650", expect: { city: "Кропивницький", warehouseNumber: "3" } },
  { name: "OBL: Черкаси", text: "Гончар Тетяна\n0931112233\nЧеркаси № 14\n2350", expect: { city: "Черкаси", warehouseNumber: "14" } },
  { name: "OBL: Ужгород", text: "Кравчук Олег\n0932223344\nУжгород відділення 2\n1450", expect: { city: "Ужгород", warehouseNumber: "2" } },
  { name: "OBL: Миколаїв", text: "Молчанова Ірина\n0933334455\nМиколаїв НП 6\n2450", expect: { city: "Миколаїв", warehouseNumber: "6" } },
  { name: "OBL: Херсон", text: "Тимошенко Вадим\n0934445566\nХерсон 3\n1900", expect: { city: "Херсон", warehouseNumber: "3" } },
  { name: "OBL: Луганськ (occupied — still need to parse)", text: "Сабіров Дмитро\n0935556677\nЛуганськ № 1\n2000", expect: { phone: "+380935556677" } },
  { name: "OBL: Донецьк (occupied — phone only)", text: "Карпов Едуард\n0936667788\nДонецьк № 5\n2000", expect: { phone: "+380936667788" } },

  // ─── 2) LATIN TRANSLITERATIONS ──────────────────────────────────────
  { name: "LATIN: Kyiv → Київ", text: "Smith John\n0501234567\nKyiv 5\n2000", expect: { city: "Київ", warehouseNumber: "5" } },
  { name: "LATIN: Kharkiv → Харків", text: "Бойко О.\n0501234567\nKharkiv warehouse 3\n2000", expect: { city: "Харків" } },
  { name: "LATIN: Lviv → Львів", text: "Іваненко О.\n0501234567\nLviv 12\n2000", expect: { city: "Львів", warehouseNumber: "12" } },
  { name: "LATIN: Odesa → Одеса", text: "Петренко І.\n0501234567\nOdesa № 7\n2000", expect: { city: "Одеса", warehouseNumber: "7" } },
  { name: "LATIN: Dnipro → Дніпро", text: "Сидоренко В.\n0501234567\nDnipro 4\n2000", expect: { city: "Дніпро", warehouseNumber: "4" } },

  // ─── 3) MULTI-WORD CITIES ───────────────────────────────────────────
  { name: "MW: Біла Церква", text: "Іваненко О.\n0501234567\nБіла Церква № 3\n2000", expect: { city: "Біла Церква", warehouseNumber: "3" } },
  { name: "MW: Кривий Ріг", text: "Петренко А.\n0501234567\nКривий Ріг відділення 5\n2000", expect: { city: "Кривий Ріг", warehouseNumber: "5" } },
  { name: "MW: Кам'янець-Подільський", text: "Сидоренко В.\n0501234567\nКам'янець-Подільський 2\n2000", expect: { city: "Кам'янець-Подільський", warehouseNumber: "2" } },
  { name: "MW: Софіївська Борщагівка", text: "Перинська Е.\n0501234567\nСофіївська Борщагівка НП 13\n2000", expect: { city: "Софіївська Борщагівка", warehouseNumber: "13" } },
  { name: "MW: Володимир-Волинський", text: "Шевчук О.\n0501234567\nВолодимир-Волинський 1\n2000", expect: { city: "Володимир-Волинський", warehouseNumber: "1" } },

  // ─── 4) PHONE FORMAT VARIATIONS ─────────────────────────────────────
  { name: "PHONE: +380 with space", text: "Іваненко О.\n+38 050 123 45 67\nКиїв 5\n2000", expect: { phone: "+380501234567" } },
  { name: "PHONE: parens (067) 123-45-67", text: "Петренко І.\n(067) 123-45-67\nЛьвів 3\n2000", expect: { phone: "+380671234567" } },
  { name: "PHONE: dashes 067-123-45-67", text: "Сидоренко В.\n067-123-45-67\nХарків 2\n2000", expect: { phone: "+380671234567" } },
  { name: "PHONE: 380 no plus", text: "Бойко О.\n380501234567\nОдеса 7\n2000", expect: { phone: "+380501234567" } },
  { name: "PHONE: international +380", text: "Коваль С.\n+380501234567\nДніпро 4\n2000", expect: { phone: "+380501234567" } },
  { name: "PHONE: dots 050.123.45.67", text: "Лисенко Ю.\n050.123.45.67\nЗапоріжжя 5\n2000", expect: { phone: "+380501234567" } },

  // ─── 5) MESSAGE STRUCTURES ──────────────────────────────────────────
  {
    name: "STRUCT: fully labeled",
    text: `ПІБ: Іваненко Олег Петрович
Тел: +380501234567
Місто: Київ
Відділення: 5
Сума: 2000`,
    expect: { name: "Іваненко Олег Петрович", phone: "+380501234567", city: "Київ", warehouseNumber: "5", cost: 2000 },
  },
  {
    name: "STRUCT: numbered list",
    text: `1. Іваненко Олег
2. 0501234567
3. Київ № 5
4. 2000 грн`,
    expect: { phone: "+380501234567", city: "Київ", warehouseNumber: "5", cost: 2000 },
  },
  {
    name: "STRUCT: Russian language (dropshipping)",
    text: `Заказ:
Иванов Олег
0501234567
г. Київ, отделение №5
наложка 2000`,
    expect: { phone: "+380501234567", city: "Київ", warehouseNumber: "5", cost: 2000 },
  },
  {
    name: "STRUCT: forwarded SMS",
    text: `Forwarded from: Customer
Доброго дня! Хочу замовити:
Тищенко Наталія
0671112233
Львів № 22
Оплата при отриманні 2500`,
    expect: { name: "Тищенко Наталія", phone: "+380671112233", city: "Львів", warehouseNumber: "22", cost: 2500 },
  },
  {
    name: "STRUCT: short Telegram order",
    text: `Шевченко О. 0501112233 Київ № 5 наложка 2000`,
    expect: { phone: "+380501112233", city: "Київ", warehouseNumber: "5", cost: 2000 },
  },
  {
    name: "STRUCT: with product link/description",
    text: `Quencher 40oz Cream
Бойко Тетяна
0671234567
Чернівці № 11
наложка 2800`,
    expect: { name: "Бойко Тетяна", city: "Чернівці", warehouseNumber: "11", cost: 2800 },
  },

  // ─── 6) WAREHOUSE TYPES & ABBREVIATIONS ─────────────────────────────
  { name: "WH: відд.", text: "Бойко О.\n0501234567\nТернопіль відд. 8\n2000", expect: { warehouseType: "branch", warehouseNumber: "8" } },
  { name: "WH: відділення", text: "Бойко О.\n0501234567\nТернопіль відділення 8\n2000", expect: { warehouseType: "branch", warehouseNumber: "8" } },
  { name: "WH: НП #", text: "Бойко О.\n0501234567\nТернопіль НП #8\n2000", expect: { warehouseType: "branch", warehouseNumber: "8" } },
  { name: "WH: №", text: "Бойко О.\n0501234567\nТернопіль № 8\n2000", expect: { warehouseType: "branch", warehouseNumber: "8" } },
  { name: "WH: city + bare number", text: "Бойко О.\n0501234567\nТернопіль 8\n2000", expect: { warehouseType: "branch", warehouseNumber: "8" } },
  { name: "WH: postomat", text: "Бойко О.\n0501234567\nКиїв поштомат 42\n2000", expect: { warehouseType: "postomat", warehouseNumber: "42" } },
  { name: "WH: postomat NP #", text: "Бойко О.\n0501234567\nЛьвів НП Поштомат 6651\n2000", expect: { warehouseType: "postomat", warehouseNumber: "6651" } },
  { name: "WH: courier with address", text: "Бойко О.\n0501234567\nКиїв, кур'єр вул. Хрещатик 22\n3500", expect: { warehouseType: "courier" } },

  // ─── 7) PAYMENT VARIATIONS ──────────────────────────────────────────
  { name: "PAY: наложка 2500", text: "Бойко О.\n0501234567\nКиїв 5\nналожка 2500", expect: { cost: 2500 } },
  { name: "PAY: НАЛОЖКА 2500", text: "Бойко О.\n0501234567\nКиїв 5\nНАЛОЖКА 2500", expect: { cost: 2500 } },
  { name: "PAY: ОПЛ 2200", text: "Бойко О.\n0501234567\nКиїв 5\nОПЛ 2200", expect: { cost: 2200 } },
  { name: "PAY: оплата 2300", text: "Бойко О.\n0501234567\nКиїв 5\nоплата 2300", expect: { cost: 2300 } },
  { name: "PAY: сума 2400", text: "Бойко О.\n0501234567\nКиїв 5\nсума 2400", expect: { cost: 2400 } },
  { name: "PAY: 2500 грн", text: "Бойко О.\n0501234567\nКиїв 5\n2500 грн", expect: { cost: 2500 } },
  { name: "PAY: 2500₴", text: "Бойко О.\n0501234567\nКиїв 5\n2500₴", expect: { cost: 2500 } },
  { name: "PAY: оплата при отриманні 2500", text: "Бойко О.\n0501234567\nКиїв 5\nоплата при отриманні 2500", expect: { cost: 2500 } },

  // ─── 8) GROUP-FORWARDED FORMATS (the REAL hard part) ────────────────
  {
    name: "GROUP: with quoting >",
    text: `> Іваненко Олена
> 0501234567
> Київ № 5
> 2000`,
    expect: { phone: "+380501234567", city: "Київ", warehouseNumber: "5" },
  },
  {
    name: "GROUP: dropshipper batch (single order, embedded)",
    text: `Замовлення #123 ✅
Покупець: Гриценко Марія Степанівна
+380501112233
Дніпро, відділення №25
Сума: 1850 грн
Товар: Stanley Quencher 40oz`,
    expect: { name: "Гриценко Марія Степанівна", phone: "+380501112233", city: "Дніпро", warehouseNumber: "25", cost: 1850 },
  },
  {
    name: "GROUP: messy real shop",
    text: `Девочки добрый вечер 💚
Отправьте пожалуйста по такой
Гончарова Виктория
0931234567
м. Одеса № 8
1900грн опл`,
    expect: { phone: "+380931234567", city: "Одеса", warehouseNumber: "8", cost: 1900 },
  },
  {
    name: "GROUP: with emoji separators",
    text: `📦 Замовлення
👤 Кошова Лариса Іванівна
📱 0671234567
🏙 Київ
🏤 № 12
💰 2000`,
    expect: { name: "Кошова Лариса Іванівна", phone: "+380671234567", city: "Київ", warehouseNumber: "12", cost: 2000 },
  },
  {
    name: "GROUP: with replied-to context",
    text: `Якщо є — відправ цьому покупцю:

Лук'янченко Сергій
+380663334455
Харків, поштомат 88
Опл 1750`,
    expect: { name: "Лук'янченко Сергій", phone: "+380663334455", city: "Харків", warehouseType: "postomat", warehouseNumber: "88", cost: 1750 },
  },
];

// ─── Run ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: Array<{ name: string; errors: string[]; parsed: ReturnType<typeof parseOrder> }> = [];

for (const c of cases) {
  const d = parseOrder(c.text);
  const errors: string[] = [];

  if (c.expect.name && d.recipientName !== c.expect.name)
    errors.push(`name: got "${d.recipientName}" expected "${c.expect.name}"`);
  if (c.expect.phone && d.recipientPhone !== c.expect.phone)
    errors.push(`phone: got "${d.recipientPhone}" expected "${c.expect.phone}"`);
  if (c.expect.city && d.cityName !== c.expect.city)
    errors.push(`city: got "${d.cityName}" expected "${c.expect.city}"`);
  if (c.expect.warehouseType && d.warehouseType !== c.expect.warehouseType)
    errors.push(`whType: got "${d.warehouseType}" expected "${c.expect.warehouseType}"`);
  if (c.expect.warehouseNumber && d.warehouseNumber !== c.expect.warehouseNumber)
    errors.push(`whNumber: got "${d.warehouseNumber}" expected "${c.expect.warehouseNumber}"`);
  if (c.expect.cost && d.cost !== c.expect.cost)
    errors.push(`cost: got ${d.cost} expected ${c.expect.cost}`);

  if (errors.length === 0) {
    process.stdout.write(`✅ ${c.name}\n`);
    passed++;
  } else {
    process.stdout.write(`❌ ${c.name}\n`);
    for (const e of errors) process.stdout.write(`   • ${e}\n`);
    failures.push({ name: c.name, errors, parsed: d });
    failed++;
  }
}

process.stdout.write(`\n──────────────────────────────\n`);
process.stdout.write(`Mass tests: ${passed}/${cases.length} passed (${failed} failed)\n`);

if (failed > 0) {
  process.stdout.write(`\n--- DETAILED FAILURES (top 5) ---\n`);
  for (const f of failures.slice(0, 5)) {
    process.stdout.write(`\n[${f.name}]\n${JSON.stringify(f.parsed, null, 2)}\n`);
  }
  process.exit(1);
}
