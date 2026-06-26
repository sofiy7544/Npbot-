/**
 * REAL production logs v4 — msg70-86 from 2026-05-22 06:26–06:29.
 * New edge cases:
 *   - msg74: "Блек хром" leaked as name (PRODUCT_NOUN missing 'блек', 'хром')
 *   - msg78: one-line in multi-line message ("Романська ... 0951047738 м Львів НП 24 Зелена 186")
 *   - msg84: "АДРЕСНАЯ ДОСТАВКА" — must trigger courier mode, not branch
 */
import { parseOrder } from "./parser.js";

type Expect = {
  name?: string;
  phone?: string;
  city?: string;
  warehouseType?: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  courierAddress?: string;
  cost?: number;
};

const cases: Array<{ name: string; text: string; expect: Expect }> = [
  {
    name: "msg70 — Давиденко (already passing — sanity check)",
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
    name: "msg74 — Черник (Блек хром MUST NOT leak as name)",
    text: `Блек хром

Черник Дзвенислава Назарівна
М.Львів
Поштомат 35536
0503869688

Опл 2200`,
    expect: { name: "Черник Дзвенислава Назарівна", phone: "+380503869688", city: "Львів", warehouseType: "postomat", warehouseNumber: "35536", cost: 2200 },
  },
  {
    name: "msg78 — Романська (ALL on one line: name + phone + city + НП + extra)",
    text: `Чашка Старбакс

Романська Марія Ігорівна 0951047738 м Львів НП 24 Зелена 186

Опл 2499`,
    expect: { name: "Романська Марія Ігорівна", phone: "+380951047738", city: "Львів", warehouseType: "branch", warehouseNumber: "24", cost: 2499 },
  },
  {
    name: "msg80 — Садовий (м.Чернігів + Нова Пошта 24)",
    text: `Шелл

Садовий Олег
м.Чернігів
Нова Пошта 24
+380633774673

НАЛОЖКА 2000`,
    expect: { name: "Садовий Олег", phone: "+380633774673", city: "Чернігів", warehouseType: "branch", warehouseNumber: "24", cost: 2000 },
  },
  {
    name: "msg84 — Іволга (АДРЕСНАЯ ДОСТАВКА → courier with street)",
    text: `Крем

М. Київ вул. Саксаганского 53/80
Іволга Світлана
096 685 45 09

Опл 2200

АДРЕСНАЯ ДОСТАВКА`,
    expect: { name: "Іволга Світлана", phone: "+380966854509", city: "Київ", warehouseType: "courier", cost: 2200 },
  },
  {
    name: "msg86 — Головкова (sanity check Поштомат 32960)",
    text: `Роза кв

Головкова Аліна Анатоліївна
Київ
Поштомат 32960
0638883010

Опл 2200`,
    expect: { name: "Головкова Аліна Анатоліївна", phone: "+380638883010", city: "Київ", warehouseType: "postomat", warehouseNumber: "32960", cost: 2200 },
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
process.stdout.write(`\n──────────────────────────────\nREAL log v4 tests: ${passed}/${cases.length} passed (${failed} failed)\n`);
if (failed > 0) { for (const f of failures) process.stdout.write(`\n[${f.name}]\n${JSON.stringify(f.parsed, null, 2)}\n`); process.exit(1); }
