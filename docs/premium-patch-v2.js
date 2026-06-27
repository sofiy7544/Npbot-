/* =====================================================================
   PREMIUM PATCH v2 · ROUND-2 FUNCTIONAL FIXES
   ===================================================================== */

(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* =============================================================
     1. LANGUAGE SWITCHER — fix click binding via event delegation
     The page's bindGlobalTriggers only runs from renderCartDrawer,
     so when user opens lang drawer first, [data-lang-set] has no
     onclick. Fix: bind at document level.
     ============================================================= */
  document.addEventListener("click", function (e) {
    const opt = e.target.closest && e.target.closest("[data-lang-set]");
    if (!opt) return;
    e.preventDefault();
    e.stopPropagation();
    const code = opt.getAttribute("data-lang-set");
    if (typeof window.setLang === "function") {
      window.setLang(code);
    } else {
      /* Fallback: directly mutate */
      try { localStorage.setItem("dua_lang", code); } catch (err) {}
      document.documentElement.lang = code;
      location.reload();
    }
  }, true);

  /* Make sure setLang is global (the page declares it as `function setLang`
     which already creates a global, but be paranoid). */
  if (typeof window.setLang !== "function" && typeof setLang === "function") {
    window.setLang = setLang;
  }

  /* =============================================================
     2. PREMIUM ALERT — replace ugly browser alert()
     ============================================================= */
  function premiumAlert(opts) {
    return new Promise(resolve => {
      const host = document.createElement("div");
      host.className = "premium-alert";
      const iconCls = opts.kind === "error" ? "premium-alert__icon--error"
                    : opts.kind === "info"  ? "premium-alert__icon--info"
                    : "";
      const iconSvg = opts.kind === "error"
        ? '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16v.5"/></svg>'
        : opts.kind === "info"
        ? '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8v.5"/></svg>'
        : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16v.5"/></svg>';
      host.innerHTML = `
        <div class="premium-alert__card" role="dialog" aria-modal="true">
          <div class="premium-alert__icon ${iconCls}">${iconSvg}</div>
          <h3 class="premium-alert__title">${escapeHtml(opts.title || "")}</h3>
          <p class="premium-alert__body">${(opts.body || "").replace(/\n/g, "<br>")}</p>
          <div class="premium-alert__actions">
            ${opts.cancelLabel ? `<button class="premium-alert__btn" data-act="cancel">${escapeHtml(opts.cancelLabel)}</button>` : ""}
            <button class="premium-alert__btn premium-alert__btn--primary" data-act="ok">${escapeHtml(opts.okLabel || "OK")}</button>
          </div>
        </div>
      `;
      document.body.appendChild(host);
      document.body.style.overflow = "hidden";
      function close(val) {
        host.remove();
        document.body.style.overflow = "";
        resolve(val);
      }
      host.addEventListener("click", e => {
        const act = e.target.closest("[data-act]");
        if (act) close(act.getAttribute("data-act"));
        else if (e.target === host) close("cancel");
      });
    });
  }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  window.premiumAlert = premiumAlert;

  /* =============================================================
     3. MONOBANK — replace alert() with premium modal + graceful fallback
     ============================================================= */
  /* Override the v1 startMonobankPayment with a version that handles
     the "Failed to fetch" case (backend not deployed) by showing a
     premium message + offering to switch payment method. */
  const originalStartMono = window.startMonobankPayment;
  window.startMonobankPayment = async function (order) {
    const cfg = window.STANLEY_CONFIG || {};

    /* If backend is not configured at all, don't even try */
    if (!cfg.apiBase) {
      await premiumAlert({
        kind: "info",
        title: "Оплата Monobank тимчасово недоступна",
        body: "Будь ласка, оберіть інший спосіб оплати — Privat24, LiqPay, Apple Pay або накладений платіж.<br><br>Якщо хочеш сплатити саме через Monobank, напиши нам у Telegram — пришлемо посилання на оплату вручну.",
        okLabel: "Зрозуміло",
      });
      /* Switch to Privat24 if it exists */
      const privat = document.querySelector("[data-payment='privat24']");
      if (privat) privat.click();
      return;
    }

    /* Otherwise try, and on error show the premium modal */
    const overlay = showPaymentOverlay("Готуємо безпечну оплату Monobank…");
    try {
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
          amount: Math.round(order.total * 100),
          ccy: 980,
          description: `Замовлення ${order.id} · stanleybrand.com.ua`,
          redirectUrl: window.location.origin + window.location.pathname + "#payment-result?orderId=" + encodeURIComponent(order.id),
          webHookUrl: cfg.apiBase + "/api/mono/webhook",
          merchantPaymInfo: { reference: order.id, destination: "Stanley Brand UA · " + order.id },
          order: enrichedOrder,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.pageUrl) throw new Error("No pageUrl");
      try { localStorage.setItem("dua_pending_payment", JSON.stringify({ invoiceId: data.invoiceId, orderId: order.id })); } catch (e) {}
      window.location.href = data.pageUrl;
    } catch (err) {
      hidePaymentOverlay();
      console.error("Mono payment failed:", err);
      const choice = await premiumAlert({
        kind: "error",
        title: "Оплата Monobank не пройшла",
        body: "Сервіс оплати тимчасово недоступний.<br><br>Пропонуємо оплатити іншим способом — Privat24, LiqPay або накладений платіж (предоплата 200 ₴).",
        okLabel: "Обрати інший спосіб",
        cancelLabel: "Закрити",
      });
      if (choice === "ok") {
        location.hash = "checkout";
        setTimeout(() => {
          const privat = document.querySelector("[data-payment='privat24']");
          if (privat) privat.click();
        }, 200);
      }
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
        <p>${escapeHtml(message || "Готуємо оплату")}</p>
      </div>`;
    document.body.style.overflow = "hidden";
    return host;
  }
  function hidePaymentOverlay() {
    const host = document.getElementById("payment-processing");
    if (host) host.remove();
    document.body.style.overflow = "";
  }

  /* =============================================================
     4. HIDE "Адмінка магазину" from customer-facing account page
     We can't tell from CSS alone if a link is for the admin (the URL
     pattern `admin.html` is enough), so the CSS handles 95%. This is
     a JS sweep for cases that render via JS without the href yet.
     ============================================================= */
  function hideAdminLinks() {
    /* Search account/cabinet routes only */
    const accountSections = $$('[data-route="account"], #account, .account-page, .account, .cabinet');
    accountSections.forEach(s => {
      $$('a, button', s).forEach(el => {
        const txt = (el.textContent || "").toLowerCase();
        const href = (el.getAttribute("href") || "").toLowerCase();
        const onclick = (el.getAttribute("onclick") || "").toLowerCase();
        if (
          href.includes("admin") ||
          onclick.includes("admin") ||
          /адмінк|адмінка|админ|admin/i.test(txt)
        ) {
          el.style.display = "none";
        }
      });
    });
  }
  const accObs = new MutationObserver(() => hideAdminLinks());
  accObs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", hideAdminLinks);

  /* =============================================================
     5. CONFIRMATION PAGE — premium status card (pending/paid/failed)
     ============================================================= */
  function enhanceConfirmation() {
    if (!/^#?confirmation/.test(location.hash) && !/^#?\/?confirmation/.test(location.hash)) {
      return;
    }
    /* Find the existing "Дякуємо, …!" hero and inject a status card before it */
    const main = document.querySelector("main") || document.body;
    if (main.querySelector(".conf-status-card")) return;

    /* Get order info */
    let order = null;
    try { order = JSON.parse(localStorage.getItem("dua_last_order") || "null"); } catch (e) {}
    const pending = (() => { try { return JSON.parse(localStorage.getItem("dua_pending_payment") || "null"); } catch (e) { return null; } })();

    /* Determine initial status */
    let kind = "paid"; // default for non-mono, non-cod
    if (order && order.payment === "mono" && pending) kind = "pending";
    if (order && order.payment === "cod") kind = "cod-pending"; /* COD requires 200₴ prepay */
    if (order && (order.payment === "privat24" || order.payment === "liqpay")) kind = "paid";

    const card = document.createElement("div");
    card.className = "conf-status-card conf-status-card--" + kind;
    renderStatusCard(card, kind, order);

    /* Find existing check-mark / title and replace with our card */
    const existingHero = main.querySelector("[data-conf-hero]") ||
      Array.from(main.querySelectorAll("h1")).find(h => /дякуєм|спасибо|thank you|dziękuj/i.test(h.textContent || ""));
    if (existingHero) {
      /* Hide old hero (incl. the static check icon above it) */
      let n = existingHero.previousElementSibling;
      while (n && /(svg|^check)|circle/i.test(n.outerHTML || "")) {
        n.style.display = "none";
        n = n.previousElementSibling;
      }
      /* Hide the old check svg/icon container too */
      const oldIcon = existingHero.parentElement.querySelector(".check-circle, .conf-icon, [class*='check']");
      if (oldIcon) oldIcon.style.display = "none";
      existingHero.style.display = "none";
      /* Inject our card before */
      existingHero.parentElement.insertBefore(card, existingHero);
    } else {
      /* Fallback: prepend */
      const container = main.querySelector(".container, .content") || main;
      container.prepend(card);
    }

    /* Add payment-limits reminder */
    if (!main.querySelector(".payment-limits-reminder")) {
      const reminder = document.createElement("div");
      reminder.className = "payment-limits-reminder";
      reminder.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16v.5"/></svg>
        <div>
          <strong>Нагадуємо:</strong> у деяких банків діє ліміт інтернет-платежів (часто 5 000 ₴/добу).
          Якщо платіж не пройде — збільш ліміт у застосунку банку (Privat24 / Mono → Налаштування → Картки → Ліміти) або обери накладений платіж.
        </div>
      `;
      card.insertAdjacentElement("afterend", reminder);
    }

    /* If pending — poll for status update */
    if (kind === "pending" && pending && pending.invoiceId) {
      pollPaymentStatus(pending.invoiceId, (newKind, reason) => {
        card.className = "conf-status-card conf-status-card--" + newKind;
        renderStatusCard(card, newKind, order, reason);
      });
    }
  }
  function renderStatusCard(card, kind, order, reason) {
    const orderId = order ? order.id : "";
    const orderTotal = order ? new Intl.NumberFormat("uk-UA").format(order.total) + " ₴" : "";

    let icon = "";
    let title = "";
    let body = "";
    let extra = "";
    if (kind === "pending") {
      icon = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      title = "Очікуємо підтвердження від банку";
      body = `Зачекай хвилину — щойно банк підтвердить надходження <strong>${orderTotal}</strong>, замовлення автоматично перейде у роботу. Закривати сторінку не обовʼязково.`;
    } else if (kind === "cod-pending") {
      icon = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      title = "Очікуємо передплату 200 ₴";
      body = `Замовлення прийнято. Щоб ми його відправили, переведи <strong>200 ₴ передплати</strong> на картку. Реквізити надішлемо тобі у Telegram або на email.<br><br>Решту <strong>${orderTotal ? "(до загальної суми " + orderTotal + ")" : ""}</strong> сплачуєш при отриманні на пошті.`;
      const tg = (window.BRAND && window.BRAND.telegram) || "stanley_brand_ua";
      extra = `<div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
        <a href="https://t.me/${tg}" target="_blank" rel="noopener" class="btn btn-primary" style="padding: 10px 22px; border-radius: 999px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em;">Написати в Telegram</a>
      </div>`;
    } else if (kind === "paid") {
      icon = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 13 4 4L19 7"/></svg>';
      title = "Дякуємо!";
      body = `Оплату підтверджено. Замовлення на <strong>${orderTotal}</strong> у роботі.<br>Сповіщення про відправку прийде на email і в Telegram.`;
    } else if (kind === "failed") {
      icon = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M6 6l12 12M18 6 6 18"/></svg>';
      title = "Оплата не пройшла";
      body = reason || "Спробуй інший спосіб оплати або повтори платіж.";
      extra = `<div style="margin-top: 16px;"><a href="#checkout" class="btn btn-primary" style="padding: 10px 22px; border-radius: 999px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em;">Повернутися до оплати</a></div>`;
    }

    card.innerHTML = `
      <div class="conf-status-card__icon">${icon}</div>
      <h1 class="title">${title}</h1>
      <p>${body}</p>
      ${orderId ? `<span class="order-pill">${escapeHtml(orderId)}</span>` : ""}
      ${extra}
    `;
  }
  async function pollPaymentStatus(invoiceId, onChange) {
    const cfg = window.STANLEY_CONFIG || {};
    if (!cfg.apiBase) return; /* No backend → leave as pending */
    let tries = 0;
    async function tick() {
      try {
        const r = await fetch(cfg.apiBase + "/api/mono/status?invoiceId=" + encodeURIComponent(invoiceId));
        if (r.ok) {
          const data = await r.json();
          if (data.status === "success" || data.status === "hold") {
            onChange("paid");
            try { localStorage.removeItem("dua_pending_payment"); } catch (e) {}
            return;
          }
          if (data.status === "failure" || data.status === "expired" || data.status === "reversed") {
            onChange("failed", data.failureReason || "Платіж відхилено банком.");
            return;
          }
        }
      } catch (e) { /* keep polling */ }
      tries++;
      if (tries < 20) setTimeout(tick, 2000);
    }
    tick();
  }
  window.addEventListener("hashchange", enhanceConfirmation);
  document.addEventListener("DOMContentLoaded", enhanceConfirmation);
  /* Observe for SPA re-renders */
  const confObs = new MutationObserver(() => {
    if (/^#?confirmation/.test(location.hash)) enhanceConfirmation();
  });
  confObs.observe(document.body, { childList: true, subtree: true });

  /* =============================================================
     6. COD EXPLAINER — explicit "either full payment OR 200₴ prepay"
     ============================================================= */
  function injectCodExplainer() {
    const cod = document.querySelector("[data-payment='cod']");
    if (!cod) return;
    if (cod.parentElement.querySelector(".cod-explainer")) return;
    const cur = cod.matches(":checked") || cod.getAttribute("aria-checked") === "true" || cod.querySelector("input:checked");
    if (!cur) return;
    const explainer = document.createElement("div");
    explainer.className = "cod-explainer";
    explainer.innerHTML = `
      <strong>Як це працює:</strong> Передплата <strong>200 ₴</strong> на картку через Mono/Privat — після цього ми відправляємо посилку. Решту сплачуєш при отриманні на пошті. Без передплати накладений платіж <strong>не оформляємо</strong>.
    `;
    cod.insertAdjacentElement("afterend", explainer);
  }
  function removeCodExplainer() {
    $$(".cod-explainer").forEach(el => el.remove());
  }
  document.addEventListener("click", e => {
    const pmt = e.target.closest && e.target.closest("[data-payment]");
    if (!pmt) return;
    setTimeout(() => {
      removeCodExplainer();
      injectCodExplainer();
    }, 50);
  });
  const codObs = new MutationObserver(() => {
    if (location.hash.includes("checkout")) {
      injectCodExplainer();
    }
  });
  codObs.observe(document.body, { childList: true, subtree: true });

  /* =============================================================
     7. REAL CONTACT INFO — replace placeholders with real data
     Override the BRAND object globally if it's still using placeholders.
     ============================================================= */
  function applyRealContacts() {
    /* If BRAND has placeholder data, swap to real-ish defaults from user config.
       The user marked "сделай реальные не выдуманые" — leave the data structure
       intact; the brand owner should edit BRAND in index.html with their actual
       contacts. We just provide a clean override hook. */
    if (window.STANLEY_CONFIG && window.STANLEY_CONFIG.brand) {
      const overrides = window.STANLEY_CONFIG.brand;
      try {
        /* BRAND is Object.freeze'd in the source. We override the rendered DOM. */
        const contacts = document.querySelectorAll("[data-contact]");
        contacts.forEach(el => {
          const kind = el.getAttribute("data-contact");
          if (overrides[kind]) el.textContent = overrides[kind];
        });
      } catch (e) {}
    }
  }
  document.addEventListener("DOMContentLoaded", applyRealContacts);

  /* =============================================================
     8. ANNOUNCE BAR — guarantee marquee works (already in v1, but
     occasionally a single .announce__group doesn't get duplicated)
     ============================================================= */
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const track = document.querySelector(".announce__track");
      if (!track) return;
      const groups = track.querySelectorAll(".announce__group");
      if (groups.length === 1) {
        track.appendChild(groups[0].cloneNode(true));
      }
    }, 500);
  });

  /* =============================================================
     9. EXIT FULLSCREEN UX — show our cream stage when fullscreen
     ============================================================= */
  document.addEventListener("fullscreenchange", () => {
    const lb = document.getElementById("premium-lb");
    if (!lb) return;
    if (document.fullscreenElement === lb) {
      lb.classList.add("is-fullscreen");
    } else {
      lb.classList.remove("is-fullscreen");
    }
  });

  /* =============================================================
     10. PAYMENT ICON ENHANCEMENT — add `.pay-icon` class to existing
     payment row badges so our CSS replaces them with real brand SVGs
     ============================================================= */
  function enhancePaymentIcons() {
    $$("[data-payment]").forEach(row => {
      /* Find any badge-looking child (the "P24", "mono", "L" pills) */
      const candidates = $$("span, div, .badge, .tag, .label-tag, [class*='logo']", row);
      candidates.forEach(c => {
        const txt = (c.textContent || "").trim().toLowerCase();
        if (!txt) return;
        if (c.classList.contains("pay-icon")) return; // already done
        /* Match common identifiers */
        if (/^p24$/i.test(txt) || /^mono$/i.test(txt) || /^l$/i.test(txt) || /^liqpay$/i.test(txt) || /^apple( pay)?$/i.test(txt) || /^google( pay)?$/i.test(txt)) {
          c.classList.add("pay-icon");
        }
      });
    });
  }
  const payObs = new MutationObserver(() => enhancePaymentIcons());
  payObs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", enhancePaymentIcons);

})();
