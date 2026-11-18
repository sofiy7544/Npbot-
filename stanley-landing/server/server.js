#!/usr/bin/env node
/**
 * Stanley landing — сервер прийому замовлень + роздача сайту.
 * Без залежностей: потрібен лише Node.js ≥ 18.
 *
 *   cd stanley-landing
 *   cp server/.env.example server/.env   # заповнити TG_BOT_TOKEN і TG_CHAT_ID
 *   node server/server.js                # → http://localhost:8080
 *
 * Що робить POST /api/order:
 *   1. Перевіряє дані (імʼя, прізвище, телефон UA, колір, кількість).
 *   2. Перераховує суму за цінами з config.js (ціні з браузера не довіряє).
 *   3. Відкидає дублікати (той самий orderId) і ботів (honeypot, ліміт запитів).
 *   4. Надсилає замовлення в Telegram і дописує рядок у server/data/orders.jsonl.
 *   Відповідає ok:true ЛИШЕ якщо замовлення реально збережено хоча б в одне місце.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const TG_BOT_TOKEN = (process.env.TG_BOT_TOKEN || "").trim();
const TG_CHAT_ID = (process.env.TG_CHAT_ID || "").trim();
const ORDERS_FILE = process.env.ORDERS_FILE === "off"
  ? ""
  : path.resolve(ROOT, process.env.ORDERS_FILE || "server/data/orders.jsonl");
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const RATE_MAX = Number(process.env.RATE_MAX) || 6;               // нових замовлень
const RATE_WINDOW_MS = (Number(process.env.RATE_WINDOW_MIN) || 10) * 60000;

/* ---------------- config.js (той самий файл, що й у браузері) ---------------- */
function loadConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { filename: "config.js", timeout: 500 });
  const cfg = sandbox.window.LANDING_CONFIG;
  if (!cfg || !cfg.product || !Array.isArray(cfg.colors)) throw new Error("config.js: LANDING_CONFIG некоректний");
  return cfg;
}
let CFG = loadConfig();
fs.watchFile(path.join(ROOT, "config.js"), { interval: 2000 }, () => {
  try { CFG = loadConfig(); console.log("↻ config.js перезавантажено"); }
  catch (e) { console.error("✗ config.js з помилкою, лишаю попередню версію:", e.message); }
});

/* ---------------- Дублікати / ліміти ---------------- */
const seen = new Map();          // orderId → { at, response }
const hits = new Map();          // ip → [timestamps]
if (ORDERS_FILE && fs.existsSync(ORDERS_FILE)) {
  for (const line of fs.readFileSync(ORDERS_FILE, "utf8").split("\n")) {
    try { const o = JSON.parse(line); if (o.orderId) seen.set(o.orderId, { at: Date.parse(o.receivedAt) || Date.now(), response: { ok: true, orderId: o.orderId } }); }
    catch (e) { /* порожній/битий рядок */ }
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of seen) if (now - v.at > 48 * 3600e3) seen.delete(k);
  for (const [k, v] of hits) { const f = v.filter(t => now - t < RATE_WINDOW_MS); f.length ? hits.set(k, f) : hits.delete(k); }
}, 10 * 60e3).unref();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  hits.set(ip, list);
  return list.length >= RATE_MAX;
}

/* ---------------- Валідація ---------------- */
const NAME_RE = /^[A-Za-zА-ЯЁа-яёІіЇїЄєҐґ][A-Za-zА-ЯЁа-яёІіЇїЄєҐґ'’ʼ`\- ]*[A-Za-zА-ЯЁа-яёІіЇїЄєҐґ]$/;
const cleanName = v => String(v || "").replace(/\s+/g, " ").trim();
const validName = v => v.length >= 2 && v.length <= 40 && NAME_RE.test(v);

function validate(body) {
  if (!body || typeof body !== "object") return { error: "bad_body" };
  const orderId = String(body.orderId || "");
  if (!/^[A-Za-z0-9-]{6,40}$/.test(orderId)) return { error: "bad_order_id" };

  const c = body.customer || {};
  const firstName = cleanName(c.firstName);
  const lastName = cleanName(c.lastName);
  const phone = String(c.phone || "").replace(/[^\d+]/g, "");
  if (!validName(firstName)) return { error: "invalid", field: "firstName" };
  if (!validName(lastName)) return { error: "invalid", field: "lastName" };
  if (!/^\+380[1-9]\d{8}$/.test(phone)) return { error: "invalid", field: "phone" };

  const P = CFG.product;
  if (body.product && body.product.id && body.product.id !== P.id) return { error: "unknown_product" };
  const color = CFG.colors.find(x => x.id === (body.color && body.color.id));
  if (!color) return { error: "invalid", field: "color" };
  const maxQty = Math.max(1, P.maxQty || 10);
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) return { error: "invalid", field: "qty" };

  const src = body.source && typeof body.source === "object" ? body.source : {};
  const source = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid", "referrer"]) {
    if (src[k]) source[k] = String(src[k]).slice(0, 300);
  }

  return {
    order: {
      orderId,
      product: { id: P.id, name: P.name },
      color: { id: color.id, name: color.name },
      qty,
      unitPrice: P.price,
      total: P.price * qty,
      currency: P.currency || "₴",
      customer: { firstName, lastName, phone },
      source,
    },
  };
}

/* ---------------- Куди зберігаємо замовлення ---------------- */
const escHtml = s => String(s).replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
const money = n => new Intl.NumberFormat("uk-UA").format(n).replace(/ | /g, " ");

function tgText(o) {
  const phonePretty = o.customer.phone.replace(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/, "+380 $1 $2 $3 $4");
  const lines = [
    `🛍 <b>НОВЕ ЗАМОВЛЕННЯ · ${escHtml(o.orderId)}</b>`,
    `<i>з лендингу (TikTok)</i>`,
    "",
    `<b>${escHtml(o.product.name)}</b>`,
    `Колір: ${escHtml(o.color.name)}`,
    `Кількість: ${o.qty} × ${money(o.unitPrice)} ${escHtml(o.currency)}`,
    `<b>Сума: ${money(o.total)} ${escHtml(o.currency)}</b>`,
    "",
    `👤 ${escHtml(o.customer.firstName)} ${escHtml(o.customer.lastName)}`,
    `📞 ${escHtml(phonePretty)}`,
    "",
    "Статус: потрібно зателефонувати й підтвердити (оплата та доставка не узгоджені).",
  ];
  const s = o.source;
  const utm = ["utm_source", "utm_campaign", "utm_content"].filter(k => s[k]).map(k => `${k}=${escHtml(s[k])}`);
  if (utm.length) lines.push("", `<code>${utm.join(" · ")}</code>`);
  return lines.join("\n");
}

async function sendTelegram(o) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: tgText(o), parse_mode: "HTML", disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(`Telegram ${r.status}: ${data.description || "unknown error"}`);
    return true;
  } finally { clearTimeout(t); }
}

function appendFile(o) {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.appendFileSync(ORDERS_FILE, JSON.stringify(o) + "\n");
  return true;
}

/* ---------------- HTTP ---------------- */
function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "?";
}

function sendJson(res, status, obj, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {}));
  res.end(JSON.stringify(obj));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

async function handleOrder(req, res) {
  const tgOn = !!(TG_BOT_TOKEN && TG_CHAT_ID);
  if (!tgOn && !ORDERS_FILE) return sendJson(res, 503, { ok: false, error: "not_configured" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10 * 1024) return sendJson(res, 413, { ok: false, error: "too_large" });
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad_json" }); }

  const v = validate(body);
  if (v.error) return sendJson(res, 400, { ok: false, error: v.error, field: v.field });
  const o = v.order;

  // Повтор того самого замовлення (подвійний клік, повтор після обриву звʼязку)
  const prev = seen.get(o.orderId);
  if (prev) return sendJson(res, 200, Object.assign({ duplicate: true }, prev.response));

  // Honeypot: бот заповнив приховане поле. Не зберігаємо.
  if (body.website) { console.log(`· honeypot ${o.orderId} відкинуто`); return sendJson(res, 200, { ok: true, orderId: o.orderId }); }

  const ip = clientIp(req);
  if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: "rate_limited" }, { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) });

  // Резервуємо orderId до відправлення — паралельний дубль не пройде
  const pending = { at: Date.now(), response: { ok: true, orderId: o.orderId } };
  seen.set(o.orderId, pending);

  const record = Object.assign({ receivedAt: new Date().toISOString(), ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 200) }, o);
  const result = { file: false, telegram: false };

  if (ORDERS_FILE) {
    try { result.file = appendFile(record); } catch (e) { console.error("✗ запис у файл:", e.message); }
  }
  if (tgOn) {
    try { result.telegram = await sendTelegram(o); } catch (e) { console.error("✗ Telegram:", e.message); }
  }

  if (!result.file && !result.telegram) {
    seen.delete(o.orderId);           // дозволяємо повторити з тим самим id
    return sendJson(res, 502, { ok: false, error: "delivery_failed" });
  }
  (hits.get(ip) || hits.set(ip, []).get(ip)).push(Date.now());
  console.log(`✓ ${o.orderId} · ${o.color.name} × ${o.qty} · ${o.total} ₴ · file=${result.file} tg=${result.telegram}`);
  return sendJson(res, 200, pending.response);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2", ".mp4": "video/mp4",
};

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(ROOT, rel));
  const relToRoot = path.relative(ROOT, file);
  // Не віддаємо сервер, дані замовлень, приховані файли та документацію
  if (relToRoot.startsWith("..") || /^(server|node_modules)([\\/]|$)|(^|[\\/])\./.test(relToRoot) || /\.md$/i.test(relToRoot)) {
    res.writeHead(404); return res.end("Not found");
  }
  const type = MIME[path.extname(file).toLowerCase()];
  fs.stat(file, (err, st) => {
    if (err || !st.isFile() || !type) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": /\.(webp|png|jpe?g|svg|woff2|mp4)$/i.test(file) ? "public, max-age=604800" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/order") {
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return handleOrder(req, res).catch(e => { console.error(e); sendJson(res, 500, { ok: false, error: "internal" }); });
  }
  if (url === "/api/health") {
    return sendJson(res, 200, { ok: true, telegram: !!(TG_BOT_TOKEN && TG_CHAT_ID), file: !!ORDERS_FILE });
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`✓ Лендинг: http://localhost:${PORT}`);
    console.log(`  Telegram: ${TG_BOT_TOKEN && TG_CHAT_ID ? "увімкнено" : "ВИМКНЕНО (TG_BOT_TOKEN / TG_CHAT_ID не задані)"}`);
    console.log(`  Файл замовлень: ${ORDERS_FILE || "вимкнено"}`);
    if (!(TG_BOT_TOKEN && TG_CHAT_ID) && !ORDERS_FILE) console.warn("⚠ Немає жодного каналу — сайт показуватиме, що прийом замовлень недоступний.");
  });
}
module.exports = { server, validate };

/* Мінімальний парсер .env (щоб не тягнути залежності) */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
