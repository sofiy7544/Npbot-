/**
 * Quick offline test runner for parser.ts against the 6 real shop-owner formats
 * the user provided. Run with: npx tsx src/parser.test.ts
 */
import { parseOrder, isDraftReady } from "./parser.js";

type Case = {
  name: string;
  text: string;
  expect: {
    name?: string;
    phone?: string;
    city?: string;
    warehouseType?: "branch" | "postomat" | "courier";
    warehouseNumber?: string;
    cost?: number;
  };
};

const cases: Case[] = [
  {
    name: "Перинська (Софіївська Борщагівка + НП 13)",
    text: `Перинська Елізабетта Юріївна
Софіївська Борщагівка
НП 13 Мартинова
0932377723
НАЛОЖКА 2800`,
    expect: {
      name: "Перинська Елізабетта Юріївна",
      phone: "+380932377723",
      city: "Софіївська Борщагівка",
      warehouseType: "branch",
      warehouseNumber: "13",
      cost: 2800,
    },
  },
  {
    name: "Соколова (Дніпро нп 112)",
    text: `Соколова Валерія
0631234567
Дніпро нп 112
наложка 2500`,
    expect: {
      name: "Соколова Валерія",
      phone: "+380631234567",
      city: "Дніпро",
      warehouseType: "branch",
      warehouseNumber: "112",
      cost: 2500,
    },
  },
  {
    name: "Маркевич (Поштомат Львів 6651)",
    text: `Дані отримувача мої:
Маркевич Вікторія Олександрівна
+380633096360
НП Поштомат Львів 6651
Опл 2200`,
    expect: {
      name: "Маркевич Вікторія Олександрівна",
      phone: "+380633096360",
      city: "Львів",
      warehouseType: "postomat",
      warehouseNumber: "6651",
      cost: 2200,
    },
  },
  {
    name: "Кудінова (Київ 70 одной строкой)",
    text: `Кудінова Інна
0671112233
Київ 70
наложка 2000`,
    expect: {
      name: "Кудінова Інна",
      phone: "+380671112233",
      city: "Київ",
      warehouseType: "branch",
      warehouseNumber: "70",
      cost: 2000,
    },
  },
  {
    name: "Шостакова крістіна (lowercase second name)",
    text: `Шостакова крістіна
0966434122
Київ 70
НАЛОЖКА 2000`,
    expect: {
      name: "Шостакова Крістіна",
      phone: "+380966434122",
      city: "Київ",
      warehouseType: "branch",
      warehouseNumber: "70",
      cost: 2000,
    },
  },
  {
    name: "Іванова О. (Surname + initial)",
    text: `Іванова О.
+380501234567
Харків відділення 5
сума 2500`,
    expect: {
      name: "Іванова О.",
      phone: "+380501234567",
      city: "Харків",
      warehouseType: "branch",
      warehouseNumber: "5",
      cost: 2500,
    },
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  const d = parseOrder(c.text);
  const errors: string[] = [];

  if (c.expect.name && d.recipientName !== c.expect.name)
    errors.push(`  name:     got "${d.recipientName}" — expected "${c.expect.name}"`);
  if (c.expect.phone && d.recipientPhone !== c.expect.phone)
    errors.push(`  phone:    got "${d.recipientPhone}" — expected "${c.expect.phone}"`);
  if (c.expect.city && d.cityName !== c.expect.city)
    errors.push(`  city:     got "${d.cityName}" — expected "${c.expect.city}"`);
  if (c.expect.warehouseType && d.warehouseType !== c.expect.warehouseType)
    errors.push(`  whType:   got "${d.warehouseType}" — expected "${c.expect.warehouseType}"`);
  if (c.expect.warehouseNumber && d.warehouseNumber !== c.expect.warehouseNumber)
    errors.push(`  whNumber: got "${d.warehouseNumber}" — expected "${c.expect.warehouseNumber}"`);
  if (c.expect.cost && d.cost !== c.expect.cost)
    errors.push(`  cost:     got ${d.cost} — expected ${c.expect.cost}`);

  const ready = isDraftReady(d);
  if (!ready) errors.push(`  isDraftReady: false (missing required fields)`);

  if (errors.length === 0) {
    console.log(`✅ ${c.name}`);
    passed++;
  } else {
    console.log(`❌ ${c.name}`);
    console.log(errors.join("\n"));
    console.log(`   parsed:`, JSON.stringify(d, null, 2));
    failures.push(c.name);
    failed++;
  }
}

console.log(`\n──────────────────────────────`);
console.log(`Total: ${passed}/${cases.length} passed`);
if (failed > 0) {
  console.log(`Failed:`, failures);
  process.exit(1);
}
