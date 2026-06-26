/**
 * Stanley Brand UA — backend
 *
 * Endpoints:
 *   POST /api/mono/create   — create a Monobank invoice (returns pageUrl + invoiceId)
 *   POST /api/mono/webhook  — Monobank server-to-server status callback
 *   GET  /api/mono/status   — poll invoice status (used by the success page)
 *   POST /api/tg/order      — forward an order to the Telegram group with photos
 *
 * Run locally:
 *   cp .env.example .env   # fill in tokens
 *   npm install
 *   npm start
 *
 * Production deployment (recommended):
 *   - Railway / Render / Fly.io / VPS with HTTPS
 *   - Set MONOBANK_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID as env vars
 *   - Point frontend STANLEY_CONFIG.apiBase to this server's HTTPS URL
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8787;
const MONOBANK_TOKEN = process.env.MONOBANK_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://stanleybrandua.com").replace(/\/$/, "");
const PUBLIC_REDIRECT_URL = process.env.PUBLIC_REDIRECT_URL || (PUBLIC_ORIGIN + "/#payment-result");
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || PUBLIC_ORIGIN)
  .split(",").map(s => s.trim()).filter(Boolean);

if (!MONOBANK_TOKEN) console.warn("⚠ MONOBANK_TOKEN is not set — /api/mono/create will fail.");
if (!TELEGRAM_BOT_TOKEN) console.warn("⚠ TELEGRAM_BOT_TOKEN is not set — Telegram forwarding disabled.");
if (!TELEGRAM_CHAT_ID) console.warn("⚠ TELEGRAM_CHAT_ID is not set — Telegram forwarding disabled.");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/health
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*")) return cb(null, true);
    cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: false,
}));

/* In-memory invoice → order map (good enough for low volume; swap for SQLite/Redis at scale) */
const INVOICES = new Map();

/* ============================================================
   Monobank — Create invoice
   Docs: https://api.monobank.ua/docs/acquiring.html#tag/Subroutines-for-merchants/operation/postMerchantInvoiceCreate
   ============================================================ */
app.post("/api/mono/create", async (req, res) => {
  if (!MONOBANK_TOKEN) return res.status(500).json({ error: "Server not configured (MONOBANK_TOKEN missing)" });
  const body = req.body || {};
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ error: "Invalid amount" });

  const orderId = String(body.orderId || ("ORD-" + Date.now().toString(36).toUpperCase()));

  const payload = {
    amount: Math.round(amount),                        // копійки
    ccy: Number(body.ccy) || 980,                       // 980 = UAH
    merchantPaymInfo: {
      reference: orderId,
      destination: (body.merchantPaymInfo && body.merchantPaymInfo.destination) || `Stanley Brand UA · ${orderId}`,
      comment: "stanleybrandua.com",
    },
    redirectUrl: body.redirectUrl || `${PUBLIC_REDIRECT_URL}?orderId=${encodeURIComponent(orderId)}`,
    webHookUrl: body.webHookUrl || `${req.protocol}://${req.get("host")}/api/mono/webhook`,
    validity: 3600,
    paymentType: "debit",
  };

  try {
    const r = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": MONOBANK_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Monobank create error:", r.status, data);
      return res.status(502).json({ error: "Monobank error", details: data });
    }
    /* Save mapping invoiceId → order so the webhook + status endpoints can find it */
    INVOICES.set(data.invoiceId, {
      orderId,
      order: body.order || null,
      status: "created",
      createdAt: Date.now(),
    });

    res.json({ invoiceId: data.invoiceId, pageUrl: data.pageUrl, orderId });
  } catch (err) {
    console.error("Monobank create exception:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ============================================================
   Monobank — Webhook (status updates from Monobank servers)
   ============================================================ */
app.post("/api/mono/webhook", async (req, res) => {
  /* Monobank may not always send a signature; we treat the webhook as
     advisory — we always verify status via GET /status before fulfillment. */
  const { invoiceId, status, failureReason, amount, reference } = req.body || {};
  if (!invoiceId) return res.sendStatus(400);

  const rec = INVOICES.get(invoiceId) || { orderId: reference, order: null, status: "unknown" };
  rec.status = status;
  rec.failureReason = failureReason;
  INVOICES.set(invoiceId, rec);

  /* If paid → forward the order to Telegram */
  if (status === "success" || status === "hold") {
    if (rec.order && !rec.tgSent) {
      try {
        await sendOrderToTelegram(rec.order, { paymentVerified: true });
        rec.tgSent = true;
      } catch (e) { console.error("TG forward (webhook) failed:", e); }
    }
  }
  res.sendStatus(200);
});

/* ============================================================
   Monobank — Status (called by frontend after redirect)
   ============================================================ */
app.get("/api/mono/status", async (req, res) => {
  if (!MONOBANK_TOKEN) return res.status(500).json({ error: "Server not configured" });
  const invoiceId = req.query.invoiceId;
  if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });
  try {
    const r = await fetch(`https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`, {
      headers: { "X-Token": MONOBANK_TOKEN },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: "Monobank error", details: data });

    /* Mirror into local state and forward to TG if just transitioned to success */
    const rec = INVOICES.get(invoiceId);
    if (rec) {
      rec.status = data.status;
      rec.failureReason = data.failureReason;
      if ((data.status === "success" || data.status === "hold") && rec.order && !rec.tgSent) {
        try {
          await sendOrderToTelegram(rec.order, { paymentVerified: true });
          rec.tgSent = true;
        } catch (e) { console.error("TG forward (status) failed:", e); }
      }
    }
    res.json(data);
  } catch (err) {
    console.error("Monobank status exception:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ============================================================
   Telegram — Direct order forward (for COD / non-Monobank payments)
   ============================================================ */
app.post("/api/tg/order", async (req, res) => {
  const order = req.body && req.body.order;
  if (!order) return res.status(400).json({ error: "order required" });
  try {
    await sendOrderToTelegram(order, { paymentVerified: false });
    res.json({ ok: true });
  } catch (err) {
    console.error("TG forward (direct) failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Health
   ============================================================ */
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Stanley API</title>
    <style>body{font-family:system-ui;padding:40px;color:#1F1F1F;background:#F5F0E8;}h1{font-family:Georgia,serif;}code{background:#fff;padding:2px 6px;border-radius:4px;}</style>
    <h1>Stanley Brand UA · backend</h1>
    <p>Status: running</p>
    <p>Endpoints: <code>POST /api/mono/create</code> · <code>POST /api/mono/webhook</code> · <code>GET /api/mono/status</code> · <code>POST /api/tg/order</code></p>
  `);
});

/* ============================================================
   Send order to Telegram group — text + media group with product photos
   ============================================================ */
async function sendOrderToTelegram(order, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram not configured, skipping forward");
    return;
  }
  const { text, photos } = buildOrderMessage(order, opts);
  const api = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  /* If we have publicly accessible photo URLs, send a media group with caption.
     The first item carries the caption (Telegram API constraint). */
  const usable = photos.filter(p => /^https?:\/\//.test(p.url)).slice(0, 10);
  if (usable.length) {
    const media = usable.map((p, i) => ({
      type: "photo",
      media: p.url,
      ...(i === 0 ? { caption: text, parse_mode: "HTML" } : {}),
    }));
    const r = await fetch(`${api}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, media }),
    });
    if (r.ok) return;
    const errBody = await r.text();
    console.warn("sendMediaGroup failed, falling back to sendMessage. Details:", errBody);
  }

  /* Fallback — plain text */
  const r2 = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!r2.ok) {
    const errBody = await r2.text();
    throw new Error("Telegram sendMessage failed: " + errBody);
  }
}

function buildOrderMessage(order, opts = {}) {
  const fmt = (n) => new Intl.NumberFormat("uk-UA").format(Math.round(Number(n) || 0)) + " ₴";

  const shipMap = {
    "np-branch":  "Нова Пошта · відділення",
    "np-locker":  "Нова Пошта · поштомат",
    "np-courier": "Нова Пошта · курʼєр",
    "ukrposhta":  "Укрпошта",
  };
  const payMap = {
    "privat24": "Privat24",
    "mono":     "Monobank (Apple/Google Pay)",
    "liqpay":   "LiqPay (Visa/MC)",
    "apple":    "Apple Pay",
    "google":   "Google Pay",
    "cod":      "Накладений платіж (передплата 200 ₴ → решта при отриманні)",
  };

  const lines = [];
  const verifiedMark = opts.paymentVerified ? " · 💳 ОПЛАЧЕНО" : "";
  lines.push(`🛍 <b>НОВЕ ЗАМОВЛЕННЯ · ${escapeHtml(order.id)}${verifiedMark}</b>`);
  lines.push("");
  lines.push("<b>Товари:</b>");

  const photos = [];
  (order.items || []).forEach(it => {
    const meta = resolveItemMeta(it, order);
    lines.push(`• ${escapeHtml(meta.name)}${meta.volume ? " · " + escapeHtml(meta.volume) : ""}${meta.color ? " · " + escapeHtml(meta.color) : ""} × ${it.qty || 1} — ${fmt(meta.lineTotal)}`);
    if (meta.imageUrl) photos.push({ url: meta.imageUrl, name: meta.name });
  });

  lines.push("");
  lines.push(`<b>Сума товарів:</b> ${fmt(order.subtotal)}`);
  if (Number(order.discount) > 0) lines.push(`<b>Знижка bundle:</b> −${fmt(order.discount)}`);
  lines.push(`<b>Доставка:</b> ${fmt(order.shippingCost)}${Number(order.shippingCost) === 0 ? " (безкоштовно)" : ""}`);
  if (Number(order.codFee) > 0) lines.push(`<b>Комісія НП:</b> ${fmt(order.codFee)}`);
  lines.push(`<b>РАЗОМ: ${fmt(order.total)}</b>`);

  const pmt = order.payment || "—";
  let payLine = payMap[pmt] || pmt;
  if (pmt === "cod") payLine += " · <b>передплата 200 ₴</b>";
  else if (["mono","privat24","liqpay","apple","google"].includes(pmt)) payLine += " · <b>повна оплата</b>";
  lines.push(`<b>Оплата:</b> ${payLine}`);

  lines.push("");
  const sh = order.shipping || {};
  lines.push("<b>Контакт:</b>");
  lines.push(`👤 ${escapeHtml((sh.firstName || "") + " " + (sh.lastName || "")).trim() || "—"}`);
  if (order.contact && order.contact.phone)  lines.push(`📞 ${escapeHtml(order.contact.phone)}`);
  if (order.contact && order.contact.email)  lines.push(`✉️ ${escapeHtml(order.contact.email)}`);

  lines.push("");
  lines.push("<b>Доставка:</b>");
  lines.push(`🚚 ${escapeHtml(shipMap[sh.method] || sh.method || "—")}`);
  lines.push(`📍 ${escapeHtml((sh.city || "—") + ", " + (sh.locker || "—"))}`);

  lines.push("");
  lines.push(`<i>stanleybrandua.com · ${new Date(order.createdAt || Date.now()).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}</i>`);

  return { text: lines.join("\n"), photos };
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Backends do NOT have access to the storefront's PRODUCTS array (it lives in
 * index.html). The frontend sends each item with enough info that we can build
 * a useful Telegram message and photo URLs.
 *
 * What the frontend sends in order.items[i]:
 *   { id, qty, color, name?, volume?, imageRel?, price? }
 *
 * If imageRel is provided (e.g. "img/cases/case-rose-1.webp"), we prepend
 * PUBLIC_ORIGIN to make it absolute. If price is provided, we use it; otherwise
 * we fall back to total/qty math (best-effort).
 */
function resolveItemMeta(item, order) {
  const qty = Number(item.qty || 1);
  const price = Number(item.price) || (Number(order.total || 0) / Math.max(1, (order.items || []).reduce((a, b) => a + (b.qty || 1), 0)));
  let imageUrl = null;
  if (item.imageRel) {
    imageUrl = /^https?:\/\//.test(item.imageRel) ? item.imageRel : (PUBLIC_ORIGIN + "/" + item.imageRel.replace(/^\/+/, ""));
  }
  return {
    name: item.name || item.id || "Item",
    color: item.color || "",
    volume: item.volume || "",
    lineTotal: price * qty,
    imageUrl,
  };
}

app.listen(PORT, () => {
  console.log(`✓ Stanley backend running on http://localhost:${PORT}`);
  console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
