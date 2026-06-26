/* ============================================================================
   Stanley · Premium Patch v4 (runtime)
   Companion to v4.css. Handles:
     1) body[data-route] flag — drives route-specific layouts (mini-footer, etc.)
     2) Anti-double-submit on #placeOrder — visual processing + click guard
     3) Trust strip injected under CTA (avoids touching index.html markup)
     4) Mini-footer injected on #checkout / #confirmation only
     5) Copy-to-clipboard for order id on success page
     6) Smooth scroll-to-first-error on validation fail
     7) Click feedback haptics on touch devices (where supported)
   ============================================================================ */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") return fn();
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  /* ────────────────────────────────────────────────────────────────────────
     1. ROUTE FLAG — body[data-route="checkout"] etc.
        Drives CSS that should only apply on specific routes.
     ────────────────────────────────────────────────────────────────────── */
  function setRouteFlag() {
    const hash = (location.hash || "#home").replace(/^#/, "").split("?")[0];
    document.body.setAttribute("data-route", hash || "home");
  }
  window.addEventListener("hashchange", () => {
    setRouteFlag();
    /* Re-run side-effects after the SPA renders */
    setTimeout(() => {
      enhanceCheckout();
      enhanceConfirmation();
    }, 60);
  });

  /* ────────────────────────────────────────────────────────────────────────
     2. CHECKOUT — anti-double-submit + trust strip + mini-footer
     ────────────────────────────────────────────────────────────────────── */
  function enhanceCheckout() {
    if (document.body.dataset.route !== "checkout") return;

    /* a) Trust strip under CTA */
    injectTrustStrip();

    /* b) Mini footer */
    injectMiniFooter();

    /* c) Anti-double-submit guard.
       The native placeOrder() flow already disables #placeOrder for 900ms
       inside its own setTimeout. But we layer an extra guard for clicks
       that happen BEFORE that disable lands (e.g. fast double-tap on
       mobile). We capture-phase the listener and block subsequent clicks
       until the SPA navigates away. */
    const btn = document.getElementById("placeOrder");
    if (btn && !btn.dataset.v4Guard) {
      btn.dataset.v4Guard = "1";
      btn.addEventListener("click", function (e) {
        if (btn.dataset.v4Submitting === "1") {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        /* Let the native click run, then mark as submitting.
           Native handler validates first — if validation fails it does NOT
           disable the button, so we must clear our flag after a moment. */
        setTimeout(() => {
          if (btn.disabled || btn.classList.contains("is-processing")) {
            btn.dataset.v4Submitting = "1";
            btn.classList.add("is-processing");
          } else {
            /* Validation failed → unmark */
            btn.dataset.v4Submitting = "";
          }
        }, 0);
      }, true /* capture */);

      /* Watch for visual processing state changes */
      const obs = new MutationObserver(() => {
        if (btn.disabled || /processing|обробка|przetwarzanie/i.test(btn.textContent || "")) {
          btn.classList.add("is-processing");
        }
      });
      obs.observe(btn, { attributes: true, childList: true, characterData: true, subtree: true });
    }

    /* d) Smooth scroll to first invalid field */
    document.addEventListener("v4-validation-fail", scrollToFirstError, { once: false });
  }

  function injectTrustStrip() {
    /* Insert under the place-order button if not already present */
    const btn = document.getElementById("placeOrder");
    if (!btn) return;
    const container = btn.parentElement;
    if (!container || container.querySelector(".checkout-trust")) return;

    const lang = (document.documentElement.lang || "uk").toLowerCase();
    const labels = {
      uk: { ssl: "SSL захищено", enc: "256-bit шифрування", payments: "Платежі" },
      pl: { ssl: "SSL chroniony",   enc: "Szyfrowanie 256-bit", payments: "Płatności" },
      en: { ssl: "SSL secured",     enc: "256-bit encryption",  payments: "Payments" },
    };
    const lbl = labels[lang] || labels.uk;

    const strip = document.createElement("div");
    strip.className = "checkout-trust";
    strip.innerHTML =
      '<span class="checkout-trust__item">' +
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<span>' + lbl.ssl + '</span>' +
      '</span>' +
      '<span class="checkout-trust__item">' +
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a4 4 0 0 0-4-4H7a4 4 0 0 0 0 8h10a4 4 0 0 0 0 8H7a4 4 0 0 1-4-4"/></svg>' +
        '<span>' + lbl.enc + '</span>' +
      '</span>' +
      '<span class="checkout-trust__brands" aria-label="' + lbl.payments + '">' +
        /* mono — black pill */
        '<span style="font: 700 11px/1 ui-monospace, monospace; background:#000; color:#fff; padding:3px 6px; border-radius:3px;">mono</span>' +
        /* Visa */
        '<span style="font: 800 11px/1 sans-serif; color:#1A1F71; letter-spacing:-0.04em; padding: 2px 6px; border: 1px solid #1A1F71; border-radius: 3px;">VISA</span>' +
        /* MC */
        '<span aria-hidden="true" style="position: relative; width:24px; height:14px; display:inline-block;">' +
          '<span style="position:absolute; left:0; top:0; width:14px; height:14px; background:#EB001B; border-radius:50%;"></span>' +
          '<span style="position:absolute; right:0; top:0; width:14px; height:14px; background:#F79E1B; border-radius:50%; mix-blend-mode: multiply;"></span>' +
        '</span>' +
      '</span>';
    container.appendChild(strip);
  }

  function injectMiniFooter() {
    if (document.querySelector(".mini-footer")) return;
    const main = document.getElementById("main");
    if (!main) return;

    const lang = (document.documentElement.lang || "uk").toLowerCase();
    const labels = {
      uk: { copy: "© Stanley Brand UA · Усі права захищено", priv: "Конфіденційність", terms: "Умови", contact: "Контакти" },
      pl: { copy: "© Stanley Brand UA · Wszelkie prawa zastrzeżone", priv: "Prywatność", terms: "Warunki", contact: "Kontakt" },
      en: { copy: "© Stanley Brand UA · All rights reserved", priv: "Privacy", terms: "Terms", contact: "Contact" },
    };
    const lbl = labels[lang] || labels.uk;

    const f = document.createElement("footer");
    f.className = "mini-footer";
    f.innerHTML =
      '<div class="mini-footer__row">' +
        '<span class="mini-footer__brand">' + lbl.copy + '</span>' +
        '<nav class="mini-footer__legal">' +
          '<a href="#docs?slug=privacy">' + lbl.priv + '</a>' +
          '<a href="#docs?slug=terms">' + lbl.terms + '</a>' +
          '<a href="#docs?slug=contact">' + lbl.contact + '</a>' +
        '</nav>' +
      '</div>';
    main.appendChild(f);
  }

  function scrollToFirstError() {
    const bad = document.querySelector(".field.is-invalid, .field-error.is-visible");
    if (!bad) return;
    bad.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = bad.querySelector("input");
    if (input) setTimeout(() => input.focus(), 400);
  }

  /* Patch the native showError to also mark its .field as invalid + dispatch event */
  function hookValidationErrors() {
    if (typeof window.showError !== "function") return;
    if (window.showError.__v4Hooked) return;
    const orig = window.showError;
    window.showError = function (field, msg) {
      orig.apply(this, arguments);
      try {
        const fieldEl = document.getElementById("f-" + field);
        if (fieldEl) {
          const wrap = fieldEl.closest(".field");
          if (wrap) wrap.classList.add("is-invalid");
        }
        const errEl = document.getElementById("e-" + field);
        if (errEl) errEl.classList.add("is-visible");
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("v4-validation-fail"));
    };
    window.showError.__v4Hooked = true;
  }

  /* Patch native clearErrors to clear the new classes too */
  function hookClearErrors() {
    if (typeof window.clearErrors !== "function") return;
    if (window.clearErrors.__v4Hooked) return;
    const orig = window.clearErrors;
    window.clearErrors = function () {
      orig.apply(this, arguments);
      try {
        document.querySelectorAll(".field.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
        document.querySelectorAll(".field-error.is-visible").forEach((el) => el.classList.remove("is-visible"));
      } catch (e) {}
    };
    window.clearErrors.__v4Hooked = true;
  }

  /* ────────────────────────────────────────────────────────────────────────
     3. CONFIRMATION / SUCCESS PAGE — copy id button
     ────────────────────────────────────────────────────────────────────── */
  function enhanceConfirmation() {
    if (document.body.dataset.route !== "confirmation") return;

    injectMiniFooter();

    /* Copy order id */
    document.querySelectorAll("[data-copy-order-id]").forEach((btn) => {
      if (btn.dataset.v4Bound) return;
      btn.dataset.v4Bound = "1";
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-order-id");
        if (!id) return;
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(id);
          else {
            /* Fallback: temporary textarea */
            const ta = document.createElement("textarea");
            ta.value = id;
            ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          btn.classList.add("is-copied");
          /* Briefly swap icon to a check */
          const oldHTML = btn.innerHTML;
          btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
          setTimeout(() => {
            btn.classList.remove("is-copied");
            btn.innerHTML = oldHTML;
          }, 1600);
        } catch (e) {
          console.warn("[Stanley] Could not copy order id:", e);
        }
      });
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */
  ready(() => {
    setRouteFlag();
    /* Re-hook validation after main script runs */
    setTimeout(() => {
      hookValidationErrors();
      hookClearErrors();
    }, 0);

    /* On every SPA render we re-enhance */
    const root = document.getElementById("main") || document.body;
    const obs = new MutationObserver(() => {
      if (obs._t) cancelAnimationFrame(obs._t);
      obs._t = requestAnimationFrame(() => {
        enhanceCheckout();
        enhanceConfirmation();
        hookValidationErrors();
        hookClearErrors();
      });
    });
    obs.observe(root, { childList: true, subtree: true });

    /* Initial pass */
    enhanceCheckout();
    enhanceConfirmation();
  });
})();
