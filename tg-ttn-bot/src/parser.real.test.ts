/**
 * REAL production logs — the 10 actual messages the user sent to @Nono827272_bot in DM.
 * If this suite passes, the parser handles all observed real-world dropshipper formats.
 *
 * NB: messages are quoted VERBATIM from logs/bot.log (msg.received entries).
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
  {
    name: "REAL msg28 — Дацишин (Відправка на ім'я + comma after name)",
    text: `Синяя с бантиками, посмотреть крышку что бы была норм

Відправка на ім'я Дацишин Вікторія Вікторівна, 0680233230,
Нова пошта, місто Львів - відділення НП #32

Опл 2499`,
    expect: { name: "Дацишин Вікторія Вікторівна", phone: "+380680233230", city: "Львів", warehouseType: "branch", warehouseNumber: "32", cost: 2499 },
  },
  {
    name: "REAL msg30 — Цидиленко (lowercase city, postomat 48743, MUST NOT extract 'Крышка Фиолет' as name)",
    text: `Крышка фиолет

Цидиленко Далія Денисівна,
київ, поштомат 48743, +380974057092

Опл 300`,
    expect: { name: "Цидиленко Далія Денисівна", phone: "+380974057092", city: "Київ", warehouseType: "postomat", warehouseNumber: "48743", cost: 300 },
  },
  {
    name: "REAL msg32 — Попушой (Відділення 423)",
    text: `Роза кв и роз цветок

Попушой Валерія Романівна
Київ
Відділення 423
+380997860399

НАЛОЖКА 2200`,
    expect: { name: "Попушой Валерія Романівна", phone: "+380997860399", city: "Київ", warehouseType: "branch", warehouseNumber: "423", cost: 2200 },
  },
  {
    name: "REAL msg34 — Данилова (Нова почта 10, city before name)",
    text: `Cream

Дніпро
Нова почта 10
Данилова Ольга Валентинівна
0503632906

Опл 2200`,
    expect: { name: "Данилова Ольга Валентинівна", phone: "+380503632906", city: "Дніпро", warehouseType: "branch", warehouseNumber: "10", cost: 2200 },
  },
  {
    name: "REAL msg36 — Демидюк (Поштомат 23504 with parens extra)",
    text: `Крышка фиолет герметичная с трубочкой

Демидюк Аделіна Ігорівна
Місто Запоріжжя
Поштомат 23504 (соборний 166)
+380955164372

Опл 300`,
    expect: { name: "Демидюк Аделіна Ігорівна", phone: "+380955164372", city: "Запоріжжя", warehouseType: "postomat", warehouseNumber: "23504", cost: 300 },
  },
  {
    name: "REAL msg38 — Терещенко (+380 (99) 259 13 25 phone format — parens around operator without 0)",
    text: `Бутылка 700 мл

Терещенко Лілія Вікторівна
Київ
Поштомат 77777
+380 (99) 259 13 25

Опл 2499`,
    expect: { name: "Терещенко Лілія Вікторівна", phone: "+380992591325", city: "Київ", warehouseType: "postomat", warehouseNumber: "77777", cost: 2499 },
  },
  {
    name: "REAL msg40 — Рихаб (foreign 3-word Title Title lowercase + НАДОЖКА typo)",
    text: `Старбакс стакан белый

Рихаб Бен салах
С.ходосівка
Поштомат 38647
0639937430

НАДОЖКА 1800`,
    expect: { name: "Рихаб Бен Салах", phone: "+380639937430", warehouseType: "postomat", warehouseNumber: "38647", cost: 1800 },
    // city "С.ходосівка" intentionally unmatched — village, will need NP fuzzy lookup in prod
  },
  {
    name: "REAL msg42 — Кадай (trailing period in name + 'Н. П 37' + 'Опл 2200' MUST NOT leak as wh)",
    text: `Крем

Кадай Уляна Ігорівна.
 М. Львів
 Щирецька 36 Н. П 37. 0635076713

Опл 2200`,
    expect: { name: "Кадай Уляна Ігорівна", phone: "+380635076713", city: "Львів", warehouseType: "branch", warehouseNumber: "37", cost: 2200 },
  },
  {
    name: "REAL msg44 — Діаковська (number-first warehouse '52 НП')",
    text: `Синяя с бантиками

Діаковська Ганна
Запоріжжя
52 НП
066 663 4114

НАЛОЖКА 2300`,
    expect: { name: "Діаковська Ганна", phone: "+380666634114", city: "Запоріжжя", warehouseType: "branch", warehouseNumber: "52", cost: 2300 },
  },
];

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
process.stdout.write(`REAL log tests: ${passed}/${cases.length} passed (${failed} failed)\n`);
if (failed > 0) {
  process.stdout.write(`\n--- DETAILED FAILURES ---\n`);
  for (const f of failures) {
    process.stdout.write(`\n[${f.name}]\n${JSON.stringify(f.parsed, null, 2)}\n`);
  }
  process.exit(1);
}
