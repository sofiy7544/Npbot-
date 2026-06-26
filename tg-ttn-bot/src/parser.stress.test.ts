/**
 * Stress tests — edge cases that real shop owners often produce.
 * These are NOT the original 6 — they are additional patterns to cover.
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
    name: "Latin city: Kyiv",
    text: `Іванова Олена
+380501234567
Kyiv 5
2500`,
    expect: { name: "Іванова Олена", phone: "+380501234567", city: "Київ", warehouseType: "branch", warehouseNumber: "5" },
  },
  {
    name: "Latin city: Lviv postomat",
    text: `Петренко Іван
0671112233
Lviv поштомат 42
наложка 1800`,
    expect: { name: "Петренко Іван", phone: "+380671112233", city: "Львів", warehouseType: "postomat", warehouseNumber: "42", cost: 1800 },
  },
  {
    name: "Phone with parens (067) 123-45-67",
    text: `Сидоренко Марія
(067) 123-45-67
Одеса 3
2200`,
    expect: { phone: "+380671234567", city: "Одеса", warehouseNumber: "3" },
  },
  {
    name: "Phone 380 no plus",
    text: `Коваль Петро
380501234567
Харків № 7
наложка 2500`,
    expect: { phone: "+380501234567", city: "Харків", warehouseNumber: "7" },
  },
  {
    name: "All on one line, comma-separated",
    text: `Іванова О., 0501234567, Київ № 42, сума 2500`,
    expect: { name: "Іванова О.", phone: "+380501234567", city: "Київ", warehouseNumber: "42", cost: 2500 },
  },
  {
    name: "Apostrophe variant (curly): Кам'янець",
    text: `Гавриленко Юлія
0631112233
Кам'янець-Подільський 2
2700`,
    expect: { city: "Кам'янець-Подільський", warehouseNumber: "2" },
  },
  {
    name: "відд. abbreviation",
    text: `Боженко О.
+380671234567
Тернопіль відд. 8
наложка 2100`,
    expect: { city: "Тернопіль", warehouseType: "branch", warehouseNumber: "8" },
  },
  {
    name: "Courier with street address",
    text: `Левченко Анастасія
0501234567
Київ, кур'єр вул. Хрещатик 22
3500`,
    expect: { name: "Левченко Анастасія", city: "Київ", warehouseType: "courier" },
  },
  {
    name: "Stanley Quencher description",
    text: `Бойко Тетяна
0671234567
Чернівці № 11
наложка 2800
Quencher 40oz Cream`,
    expect: { city: "Чернівці", warehouseNumber: "11", cost: 2800 },
  },
  {
    name: "Multi-line with preamble noise",
    text: `Доброго дня!
Замовлення:
Шевченко Олексій Петрович
+380931112233
Запоріжжя поштомат 15
оплата при отриманні 2500`,
    expect: { name: "Шевченко Олексій Петрович", city: "Запоріжжя", warehouseType: "postomat", warehouseNumber: "15", cost: 2500 },
  },
  {
    name: "REAL: Дацишин — 'Відправка на ім'я <ПІБ>, <phone>'",
    text: `Синяя с бантиками, посмотреть крышку что бы була норм

Відправка на ім'я Дацишин Вікторія Вікторівна, 0680233230,
Нова пошта, місто Львів - відділення НП #32

Опл 2499`,
    expect: {
      name: "Дацишин Вікторія Вікторівна",
      phone: "+380680233230",
      city: "Львів",
      warehouseType: "branch",
      warehouseNumber: "32",
      cost: 2499,
    },
  },
  {
    name: "Prefix 'Отримувач:' + comma-separated phone+name",
    text: `Отримувач: Коваленко Марія Іванівна
+380501234567
м. Київ, № 5
Опл 1500`,
    expect: {
      name: "Коваленко Марія Іванівна",
      phone: "+380501234567",
      city: "Київ",
      warehouseType: "branch",
      warehouseNumber: "5",
      cost: 1500,
    },
  },
  {
    name: "Prefix 'ПІБ:' + single line city+wh",
    text: `ПІБ: Бондаренко Олена Сергіївна
0671112233
Полтава відділення №12
1900`,
    expect: {
      name: "Бондаренко Олена Сергіївна",
      phone: "+380671112233",
      city: "Полтава",
      warehouseType: "branch",
      warehouseNumber: "12",
    },
  },
];

let passed = 0;
let failed = 0;
const failures: { name: string; errors: string[]; parsed: ReturnType<typeof parseOrder> }[] = [];

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

  if (errors.length === 0) {
    console.log(`✅ ${c.name}`);
    passed++;
  } else {
    console.log(`❌ ${c.name}`);
    console.log(errors.join("\n"));
    failures.push({ name: c.name, errors, parsed: d });
    failed++;
  }
}

console.log(`\n──────────────────────────────`);
console.log(`Stress tests: ${passed}/${cases.length} passed`);
if (failed > 0) {
  console.log(`\nFailure details:`);
  for (const f of failures) {
    console.log(`\n--- ${f.name} ---`);
    console.log(JSON.stringify(f.parsed, null, 2));
  }
}
