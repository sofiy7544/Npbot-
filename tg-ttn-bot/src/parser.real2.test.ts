/**
 * REAL production logs v2 — 10 actual messages from 2026-05-22.
 * Quoted VERBATIM from logs/bot.log (msg.received).
 *
 * These messages exposed 5 new categories of bugs:
 *   1) "Почтомат"/"Паштомат" typos (POSTOMAT_RE only had Ukrainian "ш")
 *   2) "Затычки набор" leaked as name (PRODUCT_NOUN_RE incomplete)
 *   3) "Відділення номер 2" extra word "номер" between keyword and digit
 *   4) "73 від Нова пошта"/"Від 4 нової почти" bare "від" suffix
 *   5) "460" bare number on own line — needs heuristic to recognize as warehouse
 */
import { parseOrder, isDraftReady } from "./parser.js";

type Expect = {
  name?: string;
  phone?: string;
  city?: string;
  warehouseType?: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  cost?: number;
};

type Case = { name: string; text: string; expect: Expect };

const cases: Case[] = [
  {
    name: "msg50 — Шовкомуд (Почтомат RU typo, must parse as postomat)",
    text: `Блек

Шовкомуд Нино Теймуразовна
0635315967
Одеса
Почтомат 24813

НАЛОЖКА 2000`,
    expect: { name: "Шовкомуд Нино Теймуразовна", phone: "+380635315967", city: "Одеса", warehouseType: "postomat", warehouseNumber: "24813", cost: 2000 },
  },
  {
    name: "msg52 — Тупісь (м. Дубляни — small city + 'Відділення номер 2')",
    text: `Пинк

Тупісь Роман Віталійович
м. Дубляни
Вул, Коцюбинського ,2
Відділення номер 2
380981047986

НАЛОЖКА 2000`,
    expect: { name: "Тупісь Роман Віталійович", phone: "+380981047986", city: "Дубляни", warehouseType: "branch", warehouseNumber: "2", cost: 2000 },
  },
  {
    name: "msg54 — Зєнков (73 від Нова пошта — number-first bare 'від')",
    text: `Пинк

0933404080
Київ
Зєнков Олексій
73 від Нова пошта

Опл 2200`,
    expect: { name: "Зєнков Олексій", phone: "+380933404080", city: "Київ", warehouseType: "branch", warehouseNumber: "73", cost: 2200 },
  },
  {
    name: "msg56 — Демеш (НП2 no space — already passed but kept for regression)",
    text: `Стакан сердечко Старбакс

Демеш Адріана Іванівна
Ужгород
НП2
0951238460

НАЛОЖКА 1300`,
    expect: { name: "Демеш Адріана Іванівна", phone: "+380951238460", city: "Ужгород", warehouseType: "branch", warehouseNumber: "2", cost: 1300 },
  },
  {
    name: "msg58 — Климчук (м.Київ no space, НАДОЖКА typo — already passing)",
    text: `Молочный  и затычки

Климчук Катерина Сергіївна
0674688218
м.Київ
Відділення НП 451

НАДОЖКА 2200`,
    expect: { name: "Климчук Катерина Сергіївна", phone: "+380674688218", city: "Київ", warehouseType: "branch", warehouseNumber: "451", cost: 2200 },
  },
  {
    name: "msg60 — Кучеренко (Нова Пошта 110 — already passing)",
    text: `Пинк

Кучеренко Дмитро Олегович
місто Київ
Нова Пошта 110
0678709854

НАЛОЖка 2000`,
    expect: { name: "Кучеренко Дмитро Олегович", phone: "+380678709854", city: "Київ", warehouseType: "branch", warehouseNumber: "110", cost: 2000 },
  },
  {
    name: "msg62 — Білявська (м Коростень + 'Від 4 нової почти')",
    text: `Пинк

м Коростень Житомисрької області
Від 4 нової почти
0937982783
Білявська Олена

Опл 2200`,
    expect: { name: "Білявська Олена", phone: "+380937982783", city: "Коростень", warehouseType: "branch", warehouseNumber: "4", cost: 2200 },
  },
  {
    name: "msg64 — Давиденко ('Затычки набор' MUST NOT leak as name)",
    text: `Затычки набор
Колпачки бантик и цветок с желтой серединкой
Ледница

Давиденко Ольга
Київ, відділення 230
0636660202

НАЛОЖКА 900`,
    expect: { name: "Давиденко Ольга", phone: "+380636660202", city: "Київ", warehouseType: "branch", warehouseNumber: "230", cost: 900 },
  },
  {
    name: "msg66 — Коротницька (Паштомат typo + phone with parens)",
    text: `Пинк

Коротницька Марія
+380 (63) 322 17 17

Хмельницький
Паштомат 24191

Опл 2200`,
    expect: { name: "Коротницька Марія", phone: "+380633221717", city: "Хмельницький", warehouseType: "postomat", warehouseNumber: "24191", cost: 2200 },
  },
  {
    name: "msg68 — Шевченко (bare number '460' on own line as warehouse)",
    text: `Роза кв

Шевченко Андрій Вікторович
Київ
460
380633367332

Опл 2200`,
    expect: { name: "Шевченко Андрій Вікторович", phone: "+380633367332", city: "Київ", warehouseType: "branch", warehouseNumber: "460", cost: 2200 },
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
process.stdout.write(`REAL log v2 tests: ${passed}/${cases.length} passed (${failed} failed)\n`);
if (failed > 0) {
  process.stdout.write(`\n--- DETAILED FAILURES ---\n`);
  for (const f of failures) {
    process.stdout.write(`\n[${f.name}]\n${JSON.stringify(f.parsed, null, 2)}\n`);
  }
  process.exit(1);
}
