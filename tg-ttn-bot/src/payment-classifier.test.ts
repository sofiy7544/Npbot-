/**
 * Payment classifier tests — all cases from spec + edge cases from real logs.
 */
import { classifyPayment } from "./infrastructure/parser/payment-classifier.js";

type Case = { name: string; text: string; expectCod: boolean; minScore?: number; maxScore?: number };

const cases: Case[] = [
  // ═══ COD (spec required) ═══
  { name: "Наложка 2800", text: "Наложка 2800 Новая Почта 13 Иван Петров 067...", expectCod: true, minScore: 0.7 },
  { name: "COD 1500 грн", text: "COD 1500 грн Киев НП 5", expectCod: true, minScore: 0.6 },
  { name: "Оплата при получении 3200", text: "Оплата при получении 3200", expectCod: true, minScore: 0.6 },
  { name: "наложка small (нал.)", text: "Іванова О. 0501234567 Київ № 5 нал. 2500", expectCod: true },
  { name: "післяплата UA", text: "Петренко І. 0671234567 Львів 12 післяплата 2200", expectCod: true },
  { name: "опл 2200 shorthand", text: "Шевченко А. 0501234567 Київ 5 Опл 2200", expectCod: true },
  { name: "оплата на пошті", text: "Бойко О. 0501234567 Одеса 7 оплата на пошті 2500", expectCod: true },
  { name: "НАДОЖКА typo", text: "Іванова О. 0501234567 Київ 5 НАДОЖКА 2000", expectCod: true },

  // ═══ NON-COD (spec required) ═══
  { name: "Предоплата (RU)", text: "Предоплата, отправка после оплаты", expectCod: false, maxScore: -0.5 },
  { name: "100% оплачено", text: "100% оплачено, Іванова Олена, +380501234567, Київ 5", expectCod: false, maxScore: -0.5 },
  { name: "Paid", text: "Paid, отправляйте", expectCod: false, maxScore: -0.5 },
  { name: "Передоплата UA", text: "Передоплата зроблена. Шевченко А. 0501234567 Київ 5", expectCod: false },
  { name: "Без наложки", text: "Без наложки! Іванова О. 0501234567 Київ 5 2500", expectCod: false },
  { name: "Тільки передоплата", text: "Тільки передоплата на карту", expectCod: false },
  { name: "Сплачено UA", text: "Сплачено через моно. Петренко 067... Львів 5", expectCod: false },
  { name: "Карта", text: "Оплата картою через Приват24. Бойко 0501234567 Київ 5", expectCod: false },

  // ═══ EDGE CASES (spec required) ═══
  // "2800 grn + delivery" — has amount but no explicit COD/Prepaid signal. Default = NonCash (score < 0.3).
  // Important: a bare number/amount alone should NOT trigger COD.
  { name: "amount only, no payment word", text: "Іван 0501234567 Київ № 12 2800", expectCod: false },
  { name: "address with numbers (no COD signal)", text: "Київ, НП 5, 067...", expectCod: false },
  { name: "сума with amount", text: "Гончар Т. 0671234567 Чернівці 11 сума 2800", expectCod: false }, // sum only ≠ COD
  { name: "2500 ₴ generic", text: "Бойко О. 0501234567 Київ 5 2500 ₴", expectCod: false }, // generic ≠ COD

  // ═══ AMBIGUOUS — winning side ═══
  // "наложка" but ALSO "оплачено" — the "paid" signal wins (priority 80 vs 70)
  { name: "ambiguous: оплачено overrides наложка", text: "Іванова О. наложка 2800 але вже оплачено", expectCod: false },
  // "оплата при отриманні" should still beat "100%" depending on weight
  { name: "тільки cash on delivery", text: "Тільки cash on delivery 2200", expectCod: true },

  // ═══ REAL LOGS (regression — must match what bot did before) ═══
  { name: "REAL msg32 НАЛОЖКА", text: `Роза кв и роз цветок
Попушой Валерія Романівна
Київ
Відділення 423
+380997860399
НАЛОЖКА 2200`, expectCod: true },
  { name: "REAL msg34 Опл", text: `Cream
Дніпро
Нова почта 10
Данилова Ольга Валентинівна
0503632906
Опл 2200`, expectCod: true },
  { name: "REAL msg58 НАДОЖКА typo", text: `Молочный  и затычки
Климчук Катерина Сергіївна
0674688218
м.Київ
Відділення НП 451
НАДОЖКА 2200`, expectCod: true },

  // ═══ LANGUAGE MIX ═══
  { name: "ukr+rus mix", text: "Іванова Олена, по почте 2500 наложка, м. Київ", expectCod: true },
  { name: "english + cyrillic", text: "Petrov Ivan 0501234567 Kyiv 5, COD 2000", expectCod: true },
  { name: "english prepay", text: "Petrov Ivan 0501234567 Kyiv 5, prepaid", expectCod: false },
];

let passed = 0, failed = 0;
const failures: Array<{ name: string; got: ReturnType<typeof classifyPayment> }> = [];

for (const c of cases) {
  const r = classifyPayment(c.text);
  const errors: string[] = [];
  if (r.isCod !== c.expectCod) errors.push(`isCod: got ${r.isCod}, expected ${c.expectCod}`);
  if (c.minScore !== undefined && r.score < c.minScore) errors.push(`score ${r.score} < min ${c.minScore}`);
  if (c.maxScore !== undefined && r.score > c.maxScore) errors.push(`score ${r.score} > max ${c.maxScore}`);
  if (errors.length === 0) {
    console.log(`✅ ${c.name} (score=${r.score})`);
    passed++;
  } else {
    console.log(`❌ ${c.name}`);
    for (const e of errors) console.log(`   • ${e}`);
    console.log(`   reasoning: ${JSON.stringify(r.reasoning)}`);
    failures.push({ name: c.name, got: r });
    failed++;
  }
}

console.log(`\n──────────────────────────────`);
console.log(`Payment classifier: ${passed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
