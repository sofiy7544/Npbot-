/**
 * REAL log v5 — Кляхіна case (Чубинське + 5-digit postomat 44600 inline with phone).
 */
import { parseOrder } from "./parser.js";

const cases: Array<{ name: string; text: string; expect: Record<string, unknown> }> = [
  {
    name: "REAL: Кляхіна (Чубинське 44600 inline with phone, 5-digit = postomat)",
    text: `Голубой 30 оз

Кляхіна Анастасія
+380 (63) 683 78 25 Чубинське 44600

Опл 2999`,
    expect: {
      name: "Кляхіна Анастасія",
      phone: "+380636837825",
      city: "Чубинське",
      warehouseType: "postomat",
      warehouseNumber: "44600",
      cost: 2999,
    },
  },
  {
    name: "Regression: Київ 70 → branch (1-4 digit)",
    text: `Шостакова крістіна
0966434122
Київ 70
НАЛОЖКА 2000`,
    expect: { warehouseType: "branch", warehouseNumber: "70" },
  },
  {
    name: "Regression: Київ 12345 → postomat (5-digit)",
    text: `Іванова О.
0501234567
Київ 12345
2000`,
    expect: { warehouseType: "postomat", warehouseNumber: "12345" },
  },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const d = parseOrder(c.text);
  const errors: string[] = [];
  for (const [k, v] of Object.entries(c.expect)) {
    const actual = (d as Record<string, unknown>)[k === "name" ? "recipientName" : k === "phone" ? "recipientPhone" : k === "city" ? "cityName" : k];
    if (actual !== v) errors.push(`${k}: got "${String(actual)}" expected "${String(v)}"`);
  }
  if (errors.length === 0) { console.log(`✅ ${c.name}`); passed++; }
  else { console.log(`❌ ${c.name}`); for (const e of errors) console.log(`   • ${e}`); console.log(`   parsed: ${JSON.stringify(d)}`); failed++; }
}
console.log(`\nREAL log v5: ${passed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
