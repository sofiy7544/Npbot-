/**
 * Multi-order segmenter tests — split message with N orders into N drafts.
 */
import { segmentOrders } from "./infrastructure/parser/order-segmenter.js";

const cases: Array<{ name: string; text: string; expectCount: number }> = [
  {
    name: "Single order — paragraph",
    text: `Іванова Олена
0501234567
Київ № 5
2000`,
    expectCount: 1,
  },
  {
    name: "Two orders — separated by double newline",
    text: `Іванова Олена
0501234567
Київ № 5
2000

Петренко Іван
0671112233
Львів № 12
2500`,
    expectCount: 2,
  },
  {
    name: "Three orders — numbered list",
    text: `1. Іванова Олена
0501234567
Київ № 5
2000

2. Петренко Іван
0671112233
Львів № 12
2500

3. Сидоренко Тарас
0931112233
Харків № 7
1800`,
    expectCount: 3,
  },
  {
    name: "Single order — no phone",
    text: `Іванова Олена
Київ № 5
2000`,
    expectCount: 1,
  },
  {
    name: "Garbage between orders — filter out empty segments",
    text: `Доброго дня!

Іванова Олена
0501234567
Київ № 5
2000

----

Петренко Іван
0671112233
Львів № 12
2500`,
    expectCount: 2,
  },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const segs = segmentOrders(c.text);
  if (segs.length === c.expectCount) {
    console.log(`✅ ${c.name} (got ${segs.length})`);
    passed++;
  } else {
    console.log(`❌ ${c.name}\n   expected ${c.expectCount}, got ${segs.length}`);
    for (const s of segs) console.log(`   - hasPhone=${s.hasPhone} hasCity=${s.hasCity} isReady=${s.isReady} | ${s.text.slice(0, 60).replace(/\n/g, " | ")}`);
    failed++;
  }
}
console.log(`\nSegmenter: ${passed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
