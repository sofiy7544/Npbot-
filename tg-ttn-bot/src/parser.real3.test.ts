/**
 * REAL production logs v3 — msg88-102 from 2026-05-22 06:29.
 * Tests new edge cases: typo cities (Харкрів), one-line orders with name after city.
 */
import { parseOrder } from "./parser.js";

type Expect = {
  name?: string;
  phone?: string;
  city?: string;
  warehouseType?: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  cost?: number;
};

const cases: Array<{ name: string; text: string; expect: Expect }> = [
  {
    name: "msg88 — Ніцкулич (Поштомат + parens annotation)",
    text: `Роза кв

Ніцкулич Стелла
Ужгород
Поштомат 58687 (біля магазину амбар)

0663947644

Опл 2200`,
    expect: { name: "Ніцкулич Стелла", phone: "+380663947644", city: "Ужгород", warehouseType: "postomat", warehouseNumber: "58687", cost: 2200 },
  },
  {
    name: "msg90 — Вальчук (phone first, M Харків, Нова пошта 23034)",
    text: `Дюн и роз мишка

0990971503
М Харків
Нова пошта 23034
Вальчук Микола

Опл 2400`,
    expect: { name: "Вальчук Микола", phone: "+380990971503", city: "Харків", warehouseType: "branch", warehouseNumber: "23034", cost: 2400 },
  },
  {
    name: "msg92 — Явніков (Харкрів typo → fuzzy match to Харків + phone with spaces)",
    text: `Блек

ПІБ: Явніков Роман Дмитрович
Місто: Харкрів
Відділення нової пошти: №116 (вул. Павлова Академіка, 120)
Номер: +380 98 98 15 900

Опл 2200`,
    expect: { name: "Явніков Роман Дмитрович", city: "Харків", warehouseType: "branch", warehouseNumber: "116", cost: 2200 },
  },
  {
    name: "msg94 — Максимяк (М.Тернопіль no space + НП 6)",
    text: `Зеленая

Максимяк Євгенія Володимирівна
М.Тернопіль
НП 6
0964928721

НАЛОЖКА 2000`,
    expect: { name: "Максимяк Євгенія Володимирівна", phone: "+380964928721", city: "Тернопіль", warehouseType: "branch", warehouseNumber: "6", cost: 2000 },
  },
  {
    name: "msg96 — Артемук (098 820 34 96 spaced phone)",
    text: `Крем

Артемук Юлія Іванівна
098 820 34 96
Тернопіль
Поштомат 57389

Опл 2200`,
    expect: { name: "Артемук Юлія Іванівна", phone: "+380988203496", city: "Тернопіль", warehouseType: "postomat", warehouseNumber: "57389", cost: 2200 },
  },
  {
    name: "msg98 — Ляльчук (ALL on ONE line: 'Нп 925. Бровари. Ляльчук ... 0632637849')",
    text: `Дюн и белый цветок

Нп 925. Бровари. Ляльчук Вікторія Володимирівна  0632637849

Опл 2200`,
    expect: { name: "Ляльчук Вікторія Володимирівна", phone: "+380632637849", city: "Бровари", warehouseType: "branch", warehouseNumber: "925", cost: 2200 },
  },
  {
    name: "msg100 — Артемук short (no description, no cost)",
    text: `Артемук Юлія Іванівна
098 820 34 96
Тернопіль
Поштомат 57389`,
    expect: { name: "Артемук Юлія Іванівна", phone: "+380988203496", city: "Тернопіль", warehouseType: "postomat", warehouseNumber: "57389" },
  },
  {
    name: "msg102 — Білецька (Ірпінь, 2 — city + bare number same line)",
    text: `Цветочный

Білецька Валентина Валеріівна
Ірпінь, 2
0964949959

Опл 2999`,
    expect: { name: "Білецька Валентина Валеріівна", phone: "+380964949959", city: "Ірпінь", warehouseType: "branch", warehouseNumber: "2", cost: 2999 },
  },
];

let passed = 0, failed = 0;
const failures: Array<{ name: string; errors: string[]; parsed: ReturnType<typeof parseOrder> }> = [];

for (const c of cases) {
  const d = parseOrder(c.text);
  const errors: string[] = [];
  if (c.expect.name && d.recipientName !== c.expect.name) errors.push(`name: got "${d.recipientName}" expected "${c.expect.name}"`);
  if (c.expect.phone && d.recipientPhone !== c.expect.phone) errors.push(`phone: got "${d.recipientPhone}" expected "${c.expect.phone}"`);
  if (c.expect.city && d.cityName !== c.expect.city) errors.push(`city: got "${d.cityName}" expected "${c.expect.city}"`);
  if (c.expect.warehouseType && d.warehouseType !== c.expect.warehouseType) errors.push(`whType: got "${d.warehouseType}" expected "${c.expect.warehouseType}"`);
  if (c.expect.warehouseNumber && d.warehouseNumber !== c.expect.warehouseNumber) errors.push(`whNumber: got "${d.warehouseNumber}" expected "${c.expect.warehouseNumber}"`);
  if (c.expect.cost && d.cost !== c.expect.cost) errors.push(`cost: got ${d.cost} expected ${c.expect.cost}`);
  if (errors.length === 0) { process.stdout.write(`✅ ${c.name}\n`); passed++; }
  else { process.stdout.write(`❌ ${c.name}\n`); for (const e of errors) process.stdout.write(`   • ${e}\n`); failures.push({ name: c.name, errors, parsed: d }); failed++; }
}
process.stdout.write(`\n──────────────────────────────\nREAL log v3 tests: ${passed}/${cases.length} passed (${failed} failed)\n`);
if (failed > 0) { for (const f of failures) process.stdout.write(`\n[${f.name}]\n${JSON.stringify(f.parsed, null, 2)}\n`); process.exit(1); }
