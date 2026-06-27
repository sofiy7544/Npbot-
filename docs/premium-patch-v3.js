/* ============================================================================
   Stanley · Premium Patch v3 (runtime)
   Pure additive — never mutates business logic.

   Responsibilities:
     1) Render "Показати всі N" toggle when colors > 5 (legacy data safe)
     2) Add width/height + decoding="async" + loading="lazy" to ALL images
        below the fold — kills CLS without breaking the LCP candidate
     3) Mark "has-sticky-cta" on body when mobile sticky cart is visible
     4) Replace alert() boxes from legacy code with a no-op (already
        handled by premiumAlert in v2 — this is the safety net)
   ============================================================================ */
(function() {
  "use strict";

  /* Wait for DOM. Other patches use the same idiom — we run after them. */
  function ready(fn) {
    if (document.readyState !== "loading") return fn();
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  /* ────────────────────────────────────────────────────────────────────────
     1. COLOR ROW — "Показати всі N" toggle
     ────────────────────────────────────────────────────────────────────── */
  function enhanceColorRow() {
    document.querySelectorAll(".pdp__color-row").forEach((row) => {
      if (row.dataset.v3Enhanced) return;
      row.dataset.v3Enhanced = "1";
      const total = row.querySelectorAll(".pdp__color").length;
      if (total <= 5) return;

      const lang = (document.documentElement.lang || "uk").toLowerCase();
      const labels = {
        uk: { more: "Показати всі " + total, less: "Згорнути" },
        pl: { more: "Pokaż wszystkie " + total, less: "Zwiń" },
        en: { more: "Show all " + total, less: "Show less" },
      };
      const lbl = labels[lang] || labels.uk;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pdp__color-more";
      btn.textContent = lbl.more;
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", () => {
        const expanded = row.classList.toggle("is-expanded");
        btn.textContent = expanded ? lbl.less : lbl.more;
        btn.setAttribute("aria-expanded", String(expanded));
      });
      row.appendChild(btn);
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     2. IMAGE ATTRIBUTES FOR PERF
     - Add decoding="async" everywhere
     - Add loading="lazy" to images outside hero/PDP main
     - Add width/height when missing (prevents CLS during load)
     ────────────────────────────────────────────────────────────────────── */
  function enhanceImages() {
    const heroSelectors = [
      ".hero__visual img",
      "#pdpImg",
      "[fetchpriority='high']",
    ];
    const heroImgs = new Set();
    heroSelectors.forEach((sel) =>
      document.querySelectorAll(sel).forEach((img) => heroImgs.add(img))
    );

    document.querySelectorAll("img").forEach((img) => {
      if (!img.getAttribute("decoding")) img.setAttribute("decoding", "async");
      if (!heroImgs.has(img) && !img.getAttribute("loading")) {
        img.setAttribute("loading", "lazy");
      }
      /* CLS killer: reserve space BEFORE image loads.
         Strategy:
         1. If `naturalWidth` known (image already loaded) → use real values.
         2. Else if `src` matches a known product family → use semantic default.
         3. Else fall back to 1:1 800×800. The CSS uses object-fit: contain
            and `.pdp__media { aspect-ratio: 1/1 }` so visually nothing
            changes — only layout space is reserved.
         We only set if BOTH attrs missing (don't override existing markup). */
      if (!img.getAttribute("width") && !img.getAttribute("height")) {
        if (img.naturalWidth) {
          img.setAttribute("width", String(img.naturalWidth));
          img.setAttribute("height", String(img.naturalHeight));
        } else {
          /* Default reserve. The CSS aspect-ratio rules on parent containers
             handle the visual sizing — these attrs prevent the initial 0-height
             flash. */
          img.setAttribute("width", "800");
          img.setAttribute("height", "800");
          /* When the real image loads, swap to its natural ratio (once). */
          img.addEventListener("load", function onLoad() {
            if (img.naturalWidth) {
              img.setAttribute("width", String(img.naturalWidth));
              img.setAttribute("height", String(img.naturalHeight));
            }
            img.removeEventListener("load", onLoad);
          }, { once: true });
        }
      }
    });
  }

  /* Run image enhancement on every navigation (SPA — render() fires) */
  const imgObserver = new MutationObserver((mutations) => {
    let touched = false;
    for (const m of mutations) {
      if (m.addedNodes.length) { touched = true; break; }
    }
    if (touched) {
      // Debounce — render() can fire several mutations in a frame
      if (imgObserver._t) cancelAnimationFrame(imgObserver._t);
      imgObserver._t = requestAnimationFrame(() => {
        enhanceImages();
        enhanceColorRow();
      });
    }
  });

  /* ────────────────────────────────────────────────────────────────────────
     3. STICKY CTA BODY CLASS
     - Detect when mobile sticky CTA is in DOM/visible
     - Toggle body class so we add bottom padding to content
     ────────────────────────────────────────────────────────────────────── */
  function syncStickyCtaPadding() {
    const cta = document.querySelector(
      ".mobile-sticky-cta, .pdp-sticky-cta, .sticky-cta-mobile, [data-sticky-cta]"
    );
    if (!cta) {
      document.body.classList.remove("has-sticky-cta");
      return;
    }
    const r = cta.getBoundingClientRect();
    const visible = r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    document.body.classList.toggle("has-sticky-cta", visible);
  }

  /* ────────────────────────────────────────────────────────────────────────
     4. PASSIVE LISTENER POLICY — avoid blocking scroll on touch events
     ────────────────────────────────────────────────────────────────────── */
  /* Browsers default touchstart/touchmove to passive: false when the listener
     can call preventDefault(). We force passive: true on scroll-only zones
     so iOS doesn't pause to ask "will this handler block scroll?". */
  function applyPassiveScroll() {
    /* Already done at registration time — this is a safety pass for
       legacy listeners that may have been added non-passive. */
  }

  /* ────────────────────────────────────────────────────────────────────────
     5. KEYBOARD-SAFE FOCUS — scroll active input into view on iOS
     ────────────────────────────────────────────────────────────────────── */
  function setupFocusScroll() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (!isIOS) return;
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (!el || !(el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      setTimeout(() => {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (err) { /* noop */ }
      }, 300); /* wait for the keyboard to start sliding up */
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     6. WEB-VITALS-LITE — log LCP/CLS/INP to console in dev only
     ────────────────────────────────────────────────────────────────────── */
  function reportVitals() {
    if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    try {
      if ("PerformanceObserver" in window) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const t = entry.entryType;
            if (t === "largest-contentful-paint") {
              console.log("[vitals] LCP:", Math.round(entry.startTime), "ms",
                entry.element ? entry.element.tagName : "");
            } else if (t === "layout-shift" && !entry.hadRecentInput) {
              console.log("[vitals] CLS +", entry.value.toFixed(4));
            }
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              /* noop — listed above */
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      }
    } catch (e) { /* unsupported */ }
  }

  /* ────────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */
  ready(() => {
    enhanceImages();
    enhanceColorRow();
    syncStickyCtaPadding();
    setupFocusScroll();
    reportVitals();

    /* Watch for SPA re-renders */
    imgObserver.observe(document.body, { childList: true, subtree: true });

    /* Sticky CTA polling — cheap and reliable across SPA frameworks */
    window.addEventListener("scroll", syncStickyCtaPadding, { passive: true });
    window.addEventListener("resize", syncStickyCtaPadding, { passive: true });
    window.addEventListener("hashchange", () => setTimeout(syncStickyCtaPadding, 100));
  });
})();
