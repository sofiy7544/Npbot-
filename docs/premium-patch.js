/* =====================================================================
   PREMIUM PATCH · JS · v1
   - Replaces the broken white-square lightbox with a premium cream viewer
   - Adds keyboard / swipe navigation, thumbnail strip, zoom
   - Adds image skeleton loading on PDP
   - Adds Monobank "Pay" button to checkout (calls backend)
   - Hooks order submit so it sends a rich payload to a Telegram bot
   ===================================================================== */

(function () {
  "use strict";

  /* ===== Config (override from window.STANLEY_CONFIG before this file loads) ===== */
  const cfg = Object.assign({
    /* Where your backend is deployed. Used for Monobank + Telegram bot.
       Leave empty to fall back to the old in-app behaviour (open t.me link). */
    apiBase: "",          // e.g. "https://api.stanleybrandua.com"
    monoEnabled: true,     // show "Pay with Monobank" in checkout
    /* For dev/preview: if backend is not deployed yet, we still want the order
       to land in Telegram. Set telegramBotToken + telegramChatId to enable
       direct (browser-side) sending. THIS IS NOT RECOMMENDED FOR PRODUCTION
       — anyone can read your token by viewing source. Use backend in production. */
    telegramBotToken: "",
    telegramChatId: "",
  }, window.STANLEY_CONFIG || {});
  /* Auto-enable Mono Pay only when a backend is configured */
  if (cfg.apiBase && cfg.monoEnabled !== false) cfg.monoEnabled = true;
  if (!cfg.apiBase) cfg.monoEnabled = false;
  window.STANLEY_CONFIG = cfg;

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ================================================================
     1. PREMIUM LIGHTBOX (replaces the stock one in index.html)
     ================================================================ */

  let lb = null;          // host
  let lbState = {
    images: [],           // [{src, alt}]
    idx: 0,
    isOpen: false,
    isZoomed: false,
    touchStartX: 0,
    touchStartY: 0,
    touchActive: false,
  };

  function buildLb() {
    if (lb) return lb;
    lb = document.createElement("div");
    lb.id = "premium-lb";
    lb.className = "glb";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Product image");
    lb.innerHTML = `
      <div class="glb__stage">
        <div class="glb__cream-stage" data-stage>
          <img alt="" data-img />
        </div>
      </div>
      <span class="glb__hint" data-hint>ESC · ← → · swipe</span>
      <button class="glb__close" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <button class="glb__nav glb__nav--prev" data-prev aria-label="Previous">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <button class="glb__nav glb__nav--next" data-next aria-label="Next">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <div class="glb__counter" data-counter>1 / 1</div>
      <div class="glb__thumbs" data-thumbs></div>
    `;
    document.body.appendChild(lb);

    /* Close on backdrop click (anywhere except image / nav / close) */
    lb.addEventListener("click", (e) => {
      const stage = lb.querySelector("[data-stage]");
      const img = lb.querySelector("[data-img]");
      if (e.target === lb || e.target.classList.contains("glb__stage")) {
        closeLb();
      } else if (e.target === stage) {
        closeLb();
      } else if (e.target === img) {
        toggleZoom();
      }
    });
    lb.querySelector("[data-close]").addEventListener("click", closeLb);
    lb.querySelector("[data-prev]").addEventListener("click", () => navLb(-1));
    lb.querySelector("[data-next]").addEventListener("click", () => navLb(1));

    /* Keyboard */
    document.addEventListener("keydown", (e) => {
      if (!lbState.isOpen) return;
      if (e.key === "Escape") closeLb();
      else if (e.key === "ArrowLeft") navLb(-1);
      else if (e.key === "ArrowRight") navLb(1);
    });

    /* Touch swipe on the stage */
    const stageEl = lb.querySelector("[data-stage]");
    stageEl.addEventListener("touchstart", (e) => {
      if (lbState.isZoomed) return;
      lbState.touchActive = true;
      lbState.touchStartX = e.touches[0].clientX;
      lbState.touchStartY = e.touches[0].clientY;
    }, { passive: true });
    stageEl.addEventListener("touchend", (e) => {
      if (!lbState.touchActive || lbState.isZoomed) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - lbState.touchStartX;
      const dy = t.clientY - lbState.touchStartY;
      lbState.touchActive = false;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        navLb(dx < 0 ? 1 : -1);
      } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
        closeLb();
      }
    });

    return lb;
  }

  function openLb(images, startIdx) {
    buildLb();
    lbState.images = (images || []).filter(Boolean).map(o => typeof o === "string" ? { src: o, alt: "" } : o);
    if (!lbState.images.length) return;
    lbState.idx = Math.max(0, Math.min(startIdx || 0, lbState.images.length - 1));
    lbState.isOpen = true;
    lbState.isZoomed = false;
    document.body.style.overflow = "hidden";
    lb.classList.add("is-open");
    lb.classList.toggle("has-thumbs", lbState.images.length > 1);
    renderLb();
  }
  function closeLb() {
    if (!lb) return;
    lb.classList.remove("is-open");
    lb.classList.remove("is-zoomed");
    document.body.style.overflow = "";
    lbState.isOpen = false;
    lbState.isZoomed = false;
  }
  function navLb(dir) {
    const n = lbState.images.length;
    if (n < 2) return;
    lbState.idx = (lbState.idx + dir + n) % n;
    lbState.isZoomed = false;
    lb.classList.remove("is-zoomed");
    renderLb();
  }
  function toggleZoom() {
    lbState.isZoomed = !lbState.isZoomed;
    lb.classList.toggle("is-zoomed", lbState.isZoomed);
  }
  function renderLb() {
    const cur = lbState.images[lbState.idx];
    if (!cur) return;
    const img = lb.querySelector("[data-img]");
    img.src = cur.src;
    img.alt = cur.alt || "";
    lb.querySelector("[data-counter]").textContent = (lbState.idx + 1) + " / " + lbState.images.length;

    /* Thumbs (only when more than one image) */
    const thumbs = lb.querySelector("[data-thumbs]");
    if (lbState.images.length > 1) {
      thumbs.style.display = "";
      thumbs.innerHTML = lbState.images.map((im, i) =>
        `<button class="glb__thumbs-item${i === lbState.idx ? " active" : ""}" type="button" data-go="${i}" aria-label="Image ${i+1}"><img src="${im.src}" alt=""/></button>`
      ).join("");
      thumbs.querySelectorAll("[data-go]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          lbState.idx = parseInt(btn.getAttribute("data-go"), 10) || 0;
          lbState.isZoomed = false;
          lb.classList.remove("is-zoomed");
          renderLb();
        });
      });
      const active = thumbs.querySelector(".active");
      if (active) active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    } else {
      thumbs.style.display = "none";
    }

    /* Nav arrows hide if single image */
    lb.querySelector("[data-prev]").classList.toggle("is-hidden", lbState.images.length < 2);
    lb.querySelector("[data-next]").classList.toggle("is-hidden", lbState.images.length < 2);
  }

  /* ====== HOOK: replace the stock binding ====== */
  /* The stock bindGallery in index.html binds clicks to elements with [data-glb-src].
     We hijack at the document level (capture phase) so our handler fires first
     and the stock one is short-circuited. */
  document.addEventListener("click", function (e) {
    const cell = e.target.closest && e.target.closest("[data-glb-src]");
    if (!cell) return;

    /* Build the image list for context:
       - PDP: use the active main image + all thumbnails (in their order)
       - Gallery section / grid: just the clicked image (or all data-glb-src cells in same scope) */
    let images = [];
    let startIdx = 0;

    const pdpMedia = document.getElementById("pdpMediaWrap");
    if (pdpMedia && (cell === pdpMedia || pdpMedia.contains(cell))) {
      const mainImg = pdpMedia.querySelector("img");
      const thumbs = Array.from(document.querySelectorAll("#pdpThumbs [data-thumb]"));
      if (thumbs.length) {
        images = thumbs.map(t => ({ src: t.getAttribute("data-thumb"), alt: (t.querySelector("img") && t.querySelector("img").alt) || (mainImg && mainImg.alt) || "" }));
        /* Start on currently active thumb */
        const activeIdx = thumbs.findIndex(t => t.classList.contains("active"));
        startIdx = activeIdx >= 0 ? activeIdx : 0;
      } else {
        images = [{ src: pdpMedia.getAttribute("data-glb-src") || (mainImg && mainImg.src), alt: (mainImg && mainImg.alt) || "" }];
      }
    } else {
      /* Gallery / other: collect all data-glb-src in current viewport scope */
      const all = Array.from(document.querySelectorAll("[data-glb-src]"))
        .filter(el => !el.closest("#pdpMediaWrap"));
      images = all.map(el => {
        const im = el.querySelector("img");
        return { src: el.getAttribute("data-glb-src") || (im && im.src), alt: (im && im.alt) || "" };
      });
      startIdx = all.indexOf(cell);
      if (startIdx < 0) startIdx = 0;
    }

    e.stopPropagation();
    e.preventDefault();
    openLb(images, startIdx);
  }, true /* capture phase — beats the stock handler */);

  /* Hide the stock glb element if it exists, so it never flashes */
  const stockGlbHide = () => {
    const stock = document.getElementById("glb-host");
    if (stock) stock.style.display = "none";
  };
  setInterval(stockGlbHide, 500);
  document.addEventListener("DOMContentLoaded", stockGlbHide);

  /* ================================================================
     2. IMAGE LOADING SKELETON ON PDP
     ================================================================ */
  function bindPdpImageLoading() {
    const wrap = document.getElementById("pdpMediaWrap");
    if (!wrap) return;
    const img = wrap.querySelector("img");
    if (!img) return;
    const apply = () => {
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add("is-loaded");
        wrap.classList.remove("is-loading");
      } else {
        wrap.classList.add("is-loading");
        img.classList.remove("is-loaded");
      }
    };
    apply();
    img.addEventListener("load", () => {
      img.classList.add("is-loaded");
      wrap.classList.remove("is-loading");
    });
    img.addEventListener("error", () => {
      wrap.classList.remove("is-loading");
    });
  }

  /* Watch the SPA for PDP renders */
  const pdpObserver = new MutationObserver(() => bindPdpImageLoading());
  pdpObserver.observe(document.body, { childList: true, subtree: true });

  /* ================================================================
     2.5 COLOR-AWARE GALLERY — when selecting a different color on PDP,
     swap the thumbnail strip to show only that color's photos.
     Useful for products like acc-carrier-case where gallery has 4 photos × 4 colors.
     We use a naming convention: gallery URLs that include the color slug
     (e.g. "/case-rose-1.webp", "/case-rose-2.webp") are grouped by color.
     ================================================================ */
  const COLOR_GROUPS = {
    /* product-id : function(gallery, color) -> filtered gallery */
    "acc-carrier-case": function (gallery, color) {
      const filtered = (gallery || []).filter(src => new RegExp("[-/]" + color + "[-.]", "i").test(src));
      return filtered.length ? filtered : gallery;
    },
  };

  function applyColorAwareGallery() {
    const thumbs = document.getElementById("pdpThumbs");
    const wrap = document.getElementById("pdpMediaWrap");
    if (!thumbs || !wrap) return;
    const PRODUCTS = window.PRODUCTS || [];
    /* Resolve current product id from URL hash */
    const hash = location.hash || "";
    const m = hash.match(/[?&]id=([^&]+)/);
    if (!m) return;
    const pid = decodeURIComponent(m[1]);
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p || !COLOR_GROUPS[pid]) return;

    /* Detect currently selected color from the active swatch */
    const activeColor = document.querySelector("#colorRow [aria-checked='true']");
    const color = activeColor ? activeColor.getAttribute("data-color") : (p.colors && p.colors[0]);
    if (!color) return;

    const filtered = COLOR_GROUPS[pid](p.gallery || [], color);
    /* Rebuild thumb strip in-place — preserves the click handler binding from the page */
    thumbs.innerHTML = filtered.map((src, i) =>
      `<button type="button" class="pdp__thumb${i === 0 ? " active" : ""}" data-thumb="${src}" aria-label="${p.id} — ракурс ${i+1}"><img src="${src}" alt="" loading="lazy"/></button>`
    ).join("");
    /* Re-bind clicks */
    Array.from(thumbs.querySelectorAll("[data-thumb]")).forEach(b => {
      b.addEventListener("click", () => {
        const src = b.getAttribute("data-thumb");
        const im = document.getElementById("pdpImg");
        if (im) im.src = src;
        wrap.setAttribute("data-glb-src", src);
        Array.from(thumbs.querySelectorAll("[data-thumb]")).forEach(x => x.classList.toggle("active", x === b));
      });
    });
    /* Update main image to first photo of this color */
    if (filtered[0]) {
      const im = document.getElementById("pdpImg");
      if (im) im.src = filtered[0];
      wrap.setAttribute("data-glb-src", filtered[0]);
    }
  }

  /* Hook color clicks (delegated, after the page's own handler runs) */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("#colorRow [data-color]");
    if (!btn) return;
    setTimeout(applyColorAwareGallery, 30);
  });
  /* Initial application on PDP render — only run once per hash change */
  let lastPdpHash = "";
  function maybeApplyColorAware() {
    const hash = location.hash || "";
    if (hash === lastPdpHash) return;
    if (document.getElementById("pdpThumbs") && document.getElementById("colorRow")) {
      lastPdpHash = hash;
      applyColorAwareGallery();
    }
  }
  window.addEventListener("hashchange", () => { lastPdpHash = ""; setTimeout(maybeApplyColorAware, 100); });
  const colorGalleryObs = new MutationObserver(() => maybeApplyColorAware());
  colorGalleryObs.observe(document.body, { childList: true, subtree: true });

  /* ================================================================
     3. PDP MOBILE SWIPE — convert main image into swipeable when on phone
     ================================================================ */
  function bindPdpSwipe() {
    const wrap = document.getElementById("pdpMediaWrap");
    if (!wrap || window.innerWidth > 720) return;
    if (wrap.__swipeBound) return;
    wrap.__swipeBound = true;

    let sx = 0, sy = 0, active = false;
    wrap.addEventListener("touchstart", (e) => {
      active = true;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      /* swipe → click next/prev thumb */
      const thumbs = Array.from(document.querySelectorAll("#pdpThumbs .pdp__thumb"));
      if (thumbs.length < 2) return;
      const idx = thumbs.findIndex(t => t.classList.contains("active"));
      const dir = dx < 0 ? 1 : -1;
      const next = thumbs[(idx + dir + thumbs.length) % thumbs.length];
      if (next) next.click();
    });
  }
  const pdpSwipeObs = new MutationObserver(() => bindPdpSwipe());
  pdpSwipeObs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(bindPdpSwipe, 200));

  /* ================================================================
     4. MONOBANK PAYMENT FLOW (frontend → your backend)
     ================================================================ */

  /* Inject a "Pay with Monobank" option into the checkout payment list */
  function injectMonoPay() {
    if (!cfg.monoEnabled) return;
    const list = document.querySelector(".checkout-payments, [data-payment-list], #paymentList");
    /* The site uses [data-payment] radio-like buttons. We find that group. */
    const group = document.querySelector("[data-payment]");
    if (!group) return;
    const groupContainer = group.parentElement;
    if (!groupContainer) return;
    if (groupContainer.querySelector("[data-payment='mono']")) return; // already present

    const existing = groupContainer.querySelector("[data-payment='privat24']") || group;
    const node = existing.cloneNode(true);
    node.setAttribute("data-payment", "mono");
    /* Visually customise: bring text to "Monobank" */
    const lbl = node.querySelector(".text, span, label");
    if (lbl) lbl.textContent = "Monobank · Apple Pay / Google Pay";
    node.setAttribute("aria-label", "Pay with Monobank");
    /* Insert right after Privat24 (or at the top) */
    if (existing.nextSibling) {
      groupContainer.insertBefore(node, existing.nextSibling);
    } else {
      groupContainer.appendChild(node);
    }
  }
  const monoInjObs = new MutationObserver(() => injectMonoPay());
  monoInjObs.observe(document.body, { childList: true, subtree: true });

  /* The actual "create invoice + redirect" call. Called from the patched placeOrder. */
  window.startMonobankPayment = async function (order) {
    const overlay = showPaymentOverlay("Готуємо безпечну оплату Monobank…");
    try {
      /* Enrich items for backend → Telegram message */
      const products = (window.PRODUCTS || []);
      const COLORS = window.COLORS || {};
      const enrichedOrder = Object.assign({}, order, {
        items: (order.items || []).map(it => {
          const p = products.find(pp => pp.id === it.id);
          const name = p ? ((p.shortName && p.shortName.uk) || (p.name && p.name.uk) || it.id) : it.id;
          const volume = (p && p.volume && p.volume !== "—") ? p.volume : "";
          const colorName = it.color ? ((COLORS[it.color] && COLORS[it.color].name_uk) || it.color) : "";
          const imageRel = (p && p.images && (p.images[it.color] || p.images[Object.keys(p.images)[0]])) || "";
          const price = p ? Number(p.price) : 0;
          return Object.assign({}, it, { name, volume, color: colorName, imageRel, price });
        }),
      });
      const res = await fetch(cfg.apiBase + "/api/mono/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          amount: Math.round(order.total * 100), // копійки
          ccy: 980,
          description: `Замовлення ${order.id} · stanleybrandua.com`,
          redirectUrl: window.location.origin + window.location.pathname + "#payment-result?orderId=" + encodeURIComponent(order.id),
          webHookUrl: cfg.apiBase + "/api/mono/webhook",
          merchantPaymInfo: {
            reference: order.id,
            destination: "Stanley Brand UA · " + order.id,
          },
          order: enrichedOrder, // full enriched order for backend to forward to TG on success
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.pageUrl) throw new Error("No pageUrl from Monobank");
      /* Save invoice id so we can poll on return */
      try { localStorage.setItem("dua_pending_payment", JSON.stringify({ invoiceId: data.invoiceId, orderId: order.id })); } catch (e) {}
      window.location.href = data.pageUrl;
    } catch (err) {
      hidePaymentOverlay();
      console.error("Mono payment failed:", err);
      alert("Не вдалося створити платіж: " + err.message + "\nСпробуйте інший спосіб оплати.");
    }
  };

  function showPaymentOverlay(message) {
    let host = document.getElementById("payment-processing");
    if (!host) {
      host = document.createElement("div");
      host.id = "payment-processing";
      host.className = "payment-processing";
      document.body.appendChild(host);
    }
    host.innerHTML = `
      <div class="payment-processing__card">
        <div class="payment-processing__spinner"></div>
        <h2>Зачекайте…</h2>
        <p>${message || "Готуємо оплату"}</p>
      </div>`;
    document.body.style.overflow = "hidden";
    return host;
  }
  function hidePaymentOverlay() {
    const host = document.getElementById("payment-processing");
    if (host) host.remove();
    document.body.style.overflow = "";
  }

  /* ================================================================
     5. ORDER SUBMIT INTERCEPTOR — send to Telegram bot (group) with media
     ================================================================ */

  /* The stock placeOrder calls sendOrderToTelegram which opens a t.me link
     manually. We want a bot to post into a group automatically.
     We hook at the localStorage write — every new order placed will be
     forwarded once (either via our backend, or directly via the bot if
     bot token + chatId are configured).

     This watches dua_orders. The newest entry (index 0) is the just-placed
     order. */

  const ORDERS_KEY = "dua_orders";
  const SENT_KEY   = "dua_orders_sent_tg";
  function getSentSet() {
    try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function markSent(id) {
    const s = getSentSet();
    s.add(id);
    try { localStorage.setItem(SENT_KEY, JSON.stringify(Array.from(s))); } catch (e) {}
  }

  function buildOrderMessage(order) {
    /* Try to enrich with names / images from PRODUCTS if available */
    const products = (window.PRODUCTS || []);
    const COLORS = window.COLORS || {};
    const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n) + " ₴";

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
      "cod":      "Накладений платіж (передплата)",
    };

    const lines = [];
    lines.push("🛍 <b>НОВЕ ЗАМОВЛЕННЯ · " + order.id + "</b>");
    lines.push("");
    lines.push("<b>Товари:</b>");
    const photos = []; // array of urls for media group
    (order.items || []).forEach((it) => {
      const p = products.find(pp => pp.id === it.id);
      const name = p ? (p.shortName && p.shortName.uk) || (p.name && p.name.uk) || it.id : it.id;
      const colorLbl = it.color ? (COLORS[it.color] ? COLORS[it.color].name_uk : it.color) : "";
      const vol = p && p.volume && p.volume !== "—" ? " · " + p.volume : "";
      const price = p ? fmt(p.price * it.qty) : "?";
      lines.push("• " + name + vol + (colorLbl ? " · " + colorLbl : "") + " × " + it.qty + " — " + price);
      /* Photo */
      if (p && p.images) {
        let src = (it.color && p.images[it.color]) || p.images[Object.keys(p.images)[0]];
        if (src) {
          if (!/^https?:\/\//.test(src)) src = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, "/") + src.replace(/^\.?\//, "");
          photos.push({ url: src, caption: name + (colorLbl ? " · " + colorLbl : "") + " × " + it.qty });
        }
      }
    });
    lines.push("");
    lines.push("<b>Сума:</b> " + fmt(order.subtotal || 0));
    if (order.discount > 0)         lines.push("<b>Знижка bundle:</b> −" + fmt(order.discount));
    lines.push("<b>Доставка:</b> " + fmt(order.shippingCost || 0) + (order.shippingCost === 0 ? " (безкоштовно)" : ""));
    if (order.codFee > 0)           lines.push("<b>Комісія НП:</b> " + fmt(order.codFee));
    lines.push("<b>РАЗОМ:</b> " + fmt(order.total || 0));

    /* Payment kind explanation */
    const pmt = order.payment || "—";
    let payLine = payMap[pmt] || pmt;
    if (pmt === "cod") {
      payLine += " · 200 ₴ передплата → решта при отриманні";
    } else if (pmt === "mono" || pmt === "privat24" || pmt === "liqpay" || pmt === "apple" || pmt === "google") {
      payLine += " · ПОВНА ОПЛАТА";
    }
    lines.push("<b>Оплата:</b> " + payLine);

    lines.push("");
    const sh = order.shipping || {};
    lines.push("<b>Контакт:</b>");
    lines.push("👤 " + (sh.firstName || "") + " " + (sh.lastName || ""));
    lines.push("📞 " + ((order.contact && order.contact.phone) || "—"));
    lines.push("✉️ " + ((order.contact && order.contact.email) || "—"));
    lines.push("");
    lines.push("<b>Доставка:</b>");
    lines.push("🚚 " + (shipMap[sh.method] || sh.method || "—"));
    lines.push("📍 " + (sh.city || "—") + ", " + (sh.locker || "—"));
    lines.push("");
    lines.push("<i>stanleybrandua.com · " + new Date(order.createdAt || Date.now()).toLocaleString("uk-UA") + "</i>");

    return { text: lines.join("\n"), photos };
  }

  async function sendOrderToBackend(order) {
    if (!cfg.apiBase) return false;
    try {
      /* Enrich items with name/volume/imageRel/price for the backend message */
      const products = (window.PRODUCTS || []);
      const COLORS = window.COLORS || {};
      const enriched = Object.assign({}, order, {
        items: (order.items || []).map(it => {
          const p = products.find(pp => pp.id === it.id);
          const name = p ? ((p.shortName && p.shortName.uk) || (p.name && p.name.uk) || it.id) : it.id;
          const volume = (p && p.volume && p.volume !== "—") ? p.volume : "";
          const colorName = it.color ? ((COLORS[it.color] && COLORS[it.color].name_uk) || it.color) : "";
          const imageRel = (p && p.images && (p.images[it.color] || p.images[Object.keys(p.images)[0]])) || "";
          const price = p ? Number(p.price) : 0;
          return Object.assign({}, it, { name, volume, color: colorName, imageRel, price });
        }),
      });
      const r = await fetch(cfg.apiBase + "/api/tg/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: enriched }),
      });
      return r.ok;
    } catch (e) {
      console.warn("Backend TG send failed:", e);
      return false;
    }
  }

  async function sendOrderDirectToBot(order) {
    if (!cfg.telegramBotToken) return false;

    /* Auto-detect chat_id if missing: query getUpdates and cache the latest chat. */
    let chatId = cfg.telegramChatId;
    if (!chatId) {
      try { chatId = localStorage.getItem("dua_tg_chat_id") || ""; } catch (e) {}
    }
    if (!chatId) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/getUpdates`);
        if (r.ok) {
          const data = await r.json();
          if (data.ok && Array.isArray(data.result)) {
            /* Find the most recent group/supergroup chat — preferred over private chat */
            const groupChat = data.result.reverse().find(u =>
              u.message && u.message.chat && (u.message.chat.type === "group" || u.message.chat.type === "supergroup")
            );
            const anyChat = data.result.find(u => u.message && u.message.chat);
            const found = groupChat || anyChat;
            if (found) {
              chatId = String(found.message.chat.id);
              try { localStorage.setItem("dua_tg_chat_id", chatId); } catch (e) {}
              cfg.telegramChatId = chatId;
              console.log("[Stanley] Auto-detected Telegram chat_id:", chatId);
            }
          }
        }
      } catch (e) { /* network or token issue — fall through */ }
    }
    if (!chatId) return false;

    const { text, photos } = buildOrderMessage(order);
    try {
      /* If we have photos and they're publicly reachable URLs (https), send a media group with caption.
         Otherwise just send text. */
      const usableUrls = photos.filter(p => /^https:\/\//.test(p.url));
      if (usableUrls.length) {
        const media = usableUrls.slice(0, 10).map((p, i) => ({
          type: "photo",
          media: p.url,
          ...(i === 0 ? { caption: text, parse_mode: "HTML" } : {}),
        }));
        const r = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMediaGroup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, media }),
        });
        if (r.ok) return true;
        const errText = await r.text();
        console.warn("[Stanley] sendMediaGroup failed:", errText);
        /* If sendMediaGroup fails (often because URLs are http or unreachable), fall through to sendMessage */
      }
      const r2 = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });
      if (!r2.ok) {
        const errText = await r2.text();
        console.warn("[Stanley] sendMessage failed:", errText);
      }
      return r2.ok;
    } catch (e) {
      console.warn("[Stanley] Direct bot send failed:", e);
      return false;
    }
  }

  async function dispatchOrderToTelegram(order) {
    if (!order || !order.id) return;
    const sent = getSentSet();
    if (sent.has(order.id)) return;
    /* Prefer backend (secure). Fallback to direct bot (only if you configured token in window.STANLEY_CONFIG). */
    let ok = await sendOrderToBackend(order);
    if (!ok) ok = await sendOrderDirectToBot(order);
    if (ok) markSent(order.id);
    else console.warn("[Stanley] Order " + order.id + " was NOT forwarded to Telegram. Check STANLEY_CONFIG.telegramChatId or apiBase.");
  }

  /* ============================================================
     TG DEBUG PAGE — open #tg-debug to test bot connection,
     auto-detect chat_id, and send a sample order to verify.
     ============================================================ */
  async function renderTgDebug() {
    if (!/^#?tg-debug/.test(location.hash || "")) return;
    let host = document.getElementById("tg-debug-host");
    if (!host) {
      host = document.createElement("section");
      host.id = "tg-debug-host";
      host.style.cssText = "max-width: 720px; margin: 40px auto; padding: 24px; background: #fff; border-radius: 16px; border: 1px solid rgba(31,31,31,0.1); font-family: 'DM Sans', system-ui, sans-serif;";
      const container = document.querySelector("main") || document.body;
      container.prepend(host);
    }
    host.innerHTML = `
      <h1 style="font-family: 'Playfair Display', Georgia, serif; font-size: 28px; margin: 0 0 8px;">Telegram bot · діагностика</h1>
      <p style="color: rgba(31,31,31,0.6); margin: 0 0 24px;">Сторінка для адміна. Перевір, чи бот привʼязаний та куди прийдуть замовлення.</p>

      <h3 style="margin-top: 20px;">1. Перевірка токена</h3>
      <div id="tg-bot-info" style="padding: 12px 14px; background: #F4F4EF; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 13px;">завантаження...</div>

      <h3 style="margin-top: 24px;">2. Доступні чати (з getUpdates)</h3>
      <p style="font-size: 13px; color: rgba(31,31,31,0.6); margin: 0 0 10px;">Напиши боту або в групу будь-яке повідомлення, потім онови цю сторінку.</p>
      <div id="tg-chats" style="padding: 12px 14px; background: #F4F4EF; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 13px;">завантаження...</div>

      <h3 style="margin-top: 24px;">3. Поточний chat_id</h3>
      <div id="tg-current" style="padding: 12px 14px; background: #F4F4EF; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 13px;"></div>

      <h3 style="margin-top: 24px;">4. Тест відправки</h3>
      <button id="tg-test-btn" style="background: #1C3A2E; color: #fff; padding: 12px 24px; border-radius: 999px; border: none; font-weight: 600; cursor: pointer;">Надіслати тестове повідомлення</button>
      <div id="tg-test-result" style="margin-top: 12px; font-family: ui-monospace, monospace; font-size: 13px;"></div>
    `;

    /* 1. Bot info via /getMe */
    const token = cfg.telegramBotToken;
    const info = document.getElementById("tg-bot-info");
    if (!token) {
      info.textContent = "❌ STANLEY_CONFIG.telegramBotToken не заданий";
    } else {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const d = await r.json();
        if (d.ok) {
          info.innerHTML = `✓ Бот: <b>@${d.result.username}</b> (id ${d.result.id}, "${d.result.first_name}")`;
        } else {
          info.textContent = "❌ Токен невалідний: " + JSON.stringify(d);
        }
      } catch (e) {
        info.textContent = "❌ Не вдалось перевірити токен: " + e.message;
      }
    }

    /* 2. Chats from getUpdates */
    const chatsHost = document.getElementById("tg-chats");
    if (!token) {
      chatsHost.textContent = "—";
    } else {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
        const d = await r.json();
        if (d.ok && Array.isArray(d.result) && d.result.length) {
          const chats = {};
          d.result.forEach(u => {
            const m = u.message || u.channel_post;
            if (m && m.chat) {
              chats[m.chat.id] = m.chat;
            }
          });
          const rows = Object.values(chats).map(c => {
            const name = c.title || (c.first_name || "") + " " + (c.last_name || "") || c.username || "";
            return `<div style="padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; gap: 12px;">
              <code style="background: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${c.id}</code>
              <span>${c.type}</span>
              <span style="flex: 1;">${name.trim() || "—"}</span>
              <button data-set-chat="${c.id}" style="background: #1C3A2E; color: #fff; padding: 6px 12px; border-radius: 999px; border: none; font-size: 12px; cursor: pointer;">Використати</button>
            </div>`;
          }).join("");
          chatsHost.innerHTML = rows;
          chatsHost.querySelectorAll("[data-set-chat]").forEach(btn => {
            btn.addEventListener("click", () => {
              const id = btn.getAttribute("data-set-chat");
              try { localStorage.setItem("dua_tg_chat_id", id); } catch (e) {}
              cfg.telegramChatId = id;
              renderTgDebug();
            });
          });
        } else {
          chatsHost.innerHTML = "Поки що жодних чатів. <b>Напиши боту або в групі</b> будь-яке повідомлення → онови сторінку.";
        }
      } catch (e) {
        chatsHost.textContent = "❌ Помилка: " + e.message;
      }
    }

    /* 3. Current chat_id */
    const current = document.getElementById("tg-current");
    const savedChat = (() => { try { return localStorage.getItem("dua_tg_chat_id"); } catch (e) { return null; }})();
    const activeChat = cfg.telegramChatId || savedChat;
    if (activeChat) {
      current.innerHTML = `<code style="background: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${activeChat}</code> ${cfg.telegramChatId ? "(з STANLEY_CONFIG)" : "(автодетект, збережено локально)"}`;
    } else {
      current.textContent = "❌ Не задано. Натисни \"Використати\" біля потрібного чату вище.";
    }

    /* 4. Test send */
    const testBtn = document.getElementById("tg-test-btn");
    const testRes = document.getElementById("tg-test-result");
    testBtn?.addEventListener("click", async () => {
      testRes.textContent = "⏳ Відправляємо...";
      const testOrder = {
        id: "TEST-" + Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(),
        payment: "privat24",
        items: [{ id: "test", qty: 1, color: "Ваніль", name: "Тестовий товар", volume: "30oz", price: 100, imageRel: "" }],
        contact: { phone: "+380 67 124 28 64", email: "test@test.com" },
        shipping: { method: "np-branch", firstName: "Тест", lastName: "Тестовий", city: "Київ", locker: "Тестова" },
        subtotal: 100, discount: 0, shippingCost: 0, codFee: 0, total: 100,
      };
      const ok = await sendOrderDirectToBot(testOrder);
      testRes.innerHTML = ok ? "✓ Успішно — перевір чат у Telegram" : "❌ Не вдалося. Дивись console для деталей.";
    });
  }
  window.addEventListener("hashchange", renderTgDebug);
  setTimeout(renderTgDebug, 600);

  /* Wrap localStorage.setItem so we capture every dua_orders write */
  (function patchOrderHook() {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const ret = origSet.apply(this, arguments);
      if (key === ORDERS_KEY) {
        try {
          const arr = JSON.parse(value);
          if (Array.isArray(arr) && arr.length) {
            const last = arr[0];
            /* If payment is Monobank — start the payment flow instead of just messaging TG.
               The TG forward will happen on the backend webhook after payment succeeds. */
            if (last.payment === "mono") {
              /* Skip auto-dispatch; user is being redirected to Monobank. */
              setTimeout(() => {
                if (typeof window.startMonobankPayment === "function") {
                  window.startMonobankPayment(last);
                }
              }, 100);
            } else {
              /* For all other payment methods → dispatch to Telegram immediately */
              setTimeout(() => dispatchOrderToTelegram(last), 50);
            }
          }
        } catch (e) { /* noop */ }
      }
      return ret;
    };
  })();

  /* ================================================================
     6. PAYMENT RESULT ROUTE — minimal SPA page on #payment-result
     ================================================================ */
  function renderPaymentResult() {
    const hash = location.hash || "";
    if (!/^#payment-result/.test(hash)) return;
    const orderId = (hash.match(/orderId=([^&]+)/) || [])[1];
    const main = document.querySelector("main") || document.body;
    /* Hide everything else briefly while we render */
    let host = document.getElementById("payment-result-host");
    if (!host) {
      host = document.createElement("section");
      host.id = "payment-result-host";
      host.className = "payment-result";
      /* Insert as first child */
      const container = document.querySelector("main") || document.body;
      container.prepend(host);
    }
    host.innerHTML = `
      <div class="payment-result__icon payment-result__icon--success">
        <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 13 4 4L19 7"/></svg>
      </div>
      <h1>Перевіряємо оплату…</h1>
      <p>Замовлення <strong>${orderId ? decodeURIComponent(orderId) : ""}</strong></p>
      <div style="margin: 24px auto 0; max-width: 220px;">
        <div class="payment-processing__spinner" style="margin: 0 auto;"></div>
      </div>
    `;

    /* Poll backend for status (if backend is configured) */
    let tries = 0;
    const pending = (() => { try { return JSON.parse(localStorage.getItem("dua_pending_payment") || "null"); } catch (e) { return null; } })();
    async function poll() {
      if (!cfg.apiBase || !pending || !pending.invoiceId) {
        /* No backend? just show generic success after a moment */
        setTimeout(() => showResult(true), 1200);
        return;
      }
      try {
        const r = await fetch(cfg.apiBase + "/api/mono/status?invoiceId=" + encodeURIComponent(pending.invoiceId));
        if (r.ok) {
          const data = await r.json();
          if (data.status === "success" || data.status === "hold") {
            showResult(true);
            try { localStorage.removeItem("dua_pending_payment"); } catch (e) {}
            return;
          }
          if (data.status === "failure" || data.status === "expired" || data.status === "reversed") {
            showResult(false, data.failureReason);
            return;
          }
        }
      } catch (e) { /* keep polling */ }
      tries++;
      if (tries < 18) setTimeout(poll, 1500);
      else showResult(false, "Не вдалося отримати статус. Звʼяжіться з нами в Telegram.");
    }
    function showResult(ok, reason) {
      host.innerHTML = ok ? `
        <div class="payment-result__icon payment-result__icon--success">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 13 4 4L19 7"/></svg>
        </div>
        <h1>Дякуємо!</h1>
        <p>Оплату отримано. Ми починаємо збирати ваше замовлення<br><strong>${orderId ? decodeURIComponent(orderId) : ""}</strong>.</p>
        <a href="#home" class="btn btn-primary" style="margin-top: 8px;">На головну</a>
      ` : `
        <div class="payment-result__icon payment-result__icon--fail">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </div>
        <h1>Оплата не пройшла</h1>
        <p>${reason ? String(reason) : "Спробуйте інший спосіб оплати або повторіть спробу."}</p>
        <a href="#checkout" class="btn btn-primary" style="margin-top: 8px;">Повернутися до оплати</a>
      `;
    }
    poll();
  }
  window.addEventListener("hashchange", renderPaymentResult);
  document.addEventListener("DOMContentLoaded", renderPaymentResult);
  setTimeout(renderPaymentResult, 200);

  /* ================================================================
     7. SETUP HEADER + IMAGE PRELOAD (LCP boost)
     ================================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    /* Mark all PDP product images for preload upgrade */
    bindPdpImageLoading();
    bindPdpSwipe();
  });

  /* ================================================================
     8. ANNOUNCE BAR — ensure marquee runs on mobile too (some old
     UAs were pausing animation due to reduced-motion auto-detect).
     ================================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    /* Already runs by CSS. We just nudge to make sure track is laid out
       (duplicate group if not already duplicated). */
    const track = document.querySelector(".announce__track");
    if (!track) return;
    const groups = track.querySelectorAll(".announce__group");
    if (groups.length === 1) {
      track.appendChild(groups[0].cloneNode(true));
    }
  });

  /* ================================================================
     9. SCROLL HEADER — premium shadow on scroll
     ================================================================ */
  let lastY = 0;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const h = document.querySelector("header.site-header, .site-header, header");
    if (h) h.classList.toggle("is-scrolled", y > 8);
    lastY = y;
  }, { passive: true });

})();
