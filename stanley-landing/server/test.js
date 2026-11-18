/* Тести сервера замовлень: node server/test.js
   Піднімає server.js у кількох конфігураціях на випадкових портах. Telegram не викликається по-справжньому. */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let fails = 0;
const check = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: "127.0.0.1", TG_BOT_TOKEN: "", TG_CHAT_ID: "" }, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((res, rej) => {
    proc.stdout.on("data", d => { if (String(d).includes("Лендинг")) res({ proc, base: `http://127.0.0.1:${port}` }); });
    proc.on("exit", c => rej(new Error("server exited " + c)));
  });
}
const order = (o = {}) => Object.assign({
  orderId: "T" + Math.random().toString(36).slice(2, 10),
  product: { id: "stanley-quencher-40" }, color: { id: "cream" }, qty: 2, unitPrice: 1, total: 2,
  customer: { firstName: "Олена", lastName: "Коваль", phone: "+380671234567" },
}, o);
const post = (base, body) => fetch(base + "/api/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "landing-"));
  const file = path.join(tmp, "orders.jsonl");

  /* 1. Файл увімкнено, Telegram ні */
  let s = await start({ ORDERS_FILE: file, RATE_MAX: "3" });
  let r = await post(s.base, order({ orderId: "PRICE-TEST-1" }));
  const saved = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n").pop());
  check(r.status === 200 && r.data.ok, "валідне замовлення приймається");
  check(saved.total === 5000 && saved.unitPrice === 2500, "сума перерахована з config.js (клієнт прислав total=2)");

  r = await post(s.base, order({ orderId: "PRICE-TEST-1" }));
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").length;
  check(r.status === 200 && r.data.duplicate && lines === 1, "повтор того самого orderId не створює дубль");

  for (const [field, patch] of [
    ["phone", { customer: { firstName: "Олена", lastName: "Коваль", phone: "+38067123" } }],
    ["phone", { customer: { firstName: "Олена", lastName: "Коваль", phone: "+380071234567" } }],
    ["firstName", { customer: { firstName: "<script>", lastName: "Коваль", phone: "+380671234567" } }],
    ["color", { color: { id: "gold" } }],
    ["qty", { qty: 0 }],
    ["qty", { qty: 999 }],
  ]) {
    r = await post(s.base, order(patch));
    check(r.status === 400 && r.data.field === field, `невалідне поле ${field} → 400 (${JSON.stringify(patch).slice(0, 60)})`);
  }
  r = await fetch(s.base + "/api/order", { method: "POST", body: "not json" });
  check(r.status === 400, "битий JSON → 400");
  r = await fetch(s.base + "/api/order", { method: "POST", body: "x".repeat(20000) });
  check(r.status === 413, "завеликий запит → 413");

  const before = fs.readFileSync(file, "utf8").trim().split("\n").length;
  r = await post(s.base, order({ website: "http://spam" }));
  check(r.status === 200 && fs.readFileSync(file, "utf8").trim().split("\n").length === before, "honeypot: бот не потрапляє в замовлення");

  await post(s.base, order()); await post(s.base, order());
  r = await post(s.base, order());
  check(r.status === 429, "ліміт: 4-те нове замовлення з IP за 10 хв → 429");

  r = await fetch(s.base + "/server/server.js");
  check(r.status === 404, "код сервера не віддається як статика");
  r = await fetch(s.base + "/server/data/orders.jsonl");
  check(r.status === 404, "файл замовлень не доступний з браузера");
  r = await fetch(s.base + "/../CLAUDE.md");
  check(r.status === 404, "вихід за межі папки неможливий");
  s.proc.kill();

  /* 2. Нічого не налаштовано → 503 (сайт покаже «не надіслано») */
  s = await start({ ORDERS_FILE: "off" });
  r = await post(s.base, order());
  check(r.status === 503 && !r.data.ok, "без Telegram і без файлу → 503, не ok");
  s.proc.kill();

  /* 3. Telegram з неробочим токеном, файл вимкнено → 502 */
  s = await start({ ORDERS_FILE: "off", TG_BOT_TOKEN: "000:fake", TG_CHAT_ID: "-1" });
  r = await post(s.base, order({ orderId: "TG-FAIL-1" }));
  check(r.status === 502 && !r.data.ok, "Telegram не відповів і файлу нема → 502 (успіх НЕ показується)");
  r = await post(s.base, order({ orderId: "TG-FAIL-1" }));
  check(r.status === 502, "після збою той самий orderId можна повторити");
  s.proc.kill();

  /* 4. Telegram не працює, але файл є → замовлення збережено */
  s = await start({ ORDERS_FILE: file, TG_BOT_TOKEN: "000:fake", TG_CHAT_ID: "-1" });
  r = await post(s.base, order({ orderId: "TG-FAIL-FILE" }));
  check(r.status === 200 && fs.readFileSync(file, "utf8").includes("TG-FAIL-FILE"), "Telegram недоступний, але замовлення збережено у файл");
  s.proc.kill();

  console.log(fails ? `\n${fails} перевірок не пройшло` : "\nУсі перевірки пройшли");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
