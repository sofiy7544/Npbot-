/**
 * Performance test — parser throughput.
 * Production target: 1000 parses/sec on a single core (= 60k msg/min).
 * This is more than enough for any realistic Telegram load.
 */
import { parseOrder } from "./parser.js";

const samples = [
  `Перинська Елізабетта Юріївна
Софіївська Борщагівка
НП 13 Мартинова
0932377723
НАЛОЖКА 2800`,
  `Крышка фиолет
Цидиленко Далія Денисівна,
київ, поштомат 48743, +380974057092
Опл 300`,
  `Шостакова крістіна
0966434122
Київ 70
НАЛОЖКА 2000`,
  `Дюн и белый цветок
Нп 925. Бровари. Ляльчук Вікторія Володимирівна  0632637849
Опл 2200`,
  `1. Іванова Олена 0501234567 Київ № 5 2000`,
];

const ITERATIONS = 1000;

console.log(`Parsing ${ITERATIONS} messages (${samples.length} distinct samples cycled)...`);

const t0 = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  parseOrder(samples[i % samples.length]);
}
const elapsedNs = Number(process.hrtime.bigint() - t0);
const elapsedMs = elapsedNs / 1_000_000;
const perMsg = elapsedNs / ITERATIONS;
const throughput = (ITERATIONS / elapsedMs) * 1000;

console.log(``);
console.log(`Total time:    ${elapsedMs.toFixed(1)} ms`);
console.log(`Per message:   ${(perMsg / 1000).toFixed(1)} μs`);
console.log(`Throughput:    ${Math.round(throughput).toLocaleString()} msg/sec`);
console.log(``);

const targetMsgPerSec = 1000;
if (throughput >= targetMsgPerSec) {
  console.log(`✅ Throughput target (${targetMsgPerSec}/sec) reached`);
  process.exit(0);
} else {
  console.log(`❌ Throughput ${Math.round(throughput)}/sec is BELOW target ${targetMsgPerSec}/sec`);
  process.exit(1);
}
