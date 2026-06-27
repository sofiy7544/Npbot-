/* =====================================================================
   STANLEY BRAND UA — FULL MOBILE CRO PATCH (JS) v2
   Виправляє: мова UA дефолт, sticky CTA з фото, bottom-nav,
   swipe-to-close, color collapse, haptic, quick-buy, та інше.
   ===================================================================== */
(function() {
  "use strict";

  // ==================== UTILS ====================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  function hapticTap() { if (navigator.vibrate) navigator.vibrate(10); }
  function hapticConfirm() { if (navigator.vibrate) navigator.vibrate([8, 30, 14]); }

  function getRoute() {
    var hash = (location.hash || "#home").replace(/^#/, "");
    var name = (hash.split("?")[0] || "home").split("/")[0];
    if (name === "" || name === "/") name = "home";
    return name;
  }

  // ==================== 1. DEFAULT LANGUAGE = UA ====================
  // КРИТИЧНО: на iPhone з navigator.language="en-US" сайт відкривається англійською.
  // Для України — завжди UA за замовчуванням.
  (function fixDefaultLang() {
    try {
      var stored = localStorage.getItem("dua_lang");
      if (!stored) {
        // Перший візит — встановлюємо UA примусово
        localStorage.setItem("dua_lang", "uk");
        // Якщо app вже встановив інший — змінимо
        if (document.documentElement.lang && document.documentElement.lang !== "uk") {
          document.documentElement.lang = "uk";
          if (typeof window.setLang === "function") {
            // Викликаємо тільки якщо є — інакше просто перезавантажимо
            try { window.setLang("uk"); } catch(e) {}
          }
        }
      }
    } catch(e) {}
  })();

  // ==================== 2. BOTTOM NAVIGATION ====================
  function buildBottomNav() {
    var existing = $("#bottom-nav");
    if (existing) existing.remove();

    var route = getRoute();
    var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
    var labels = {
      uk: { home: "Головна", catalog: "Каталог", cart: "Кошик", fav: "Обране", account: "Кабінет" },
      pl: { home: "Główna", catalog: "Katalog", cart: "Koszyk", fav: "Ulubione", account: "Konto" },
      en: { home: "Home", catalog: "Shop", cart: "Cart", fav: "Saved", account: "Account" }
    };
    var l = labels[L] || labels.uk;

    var items = [
      {
        href: "#home", match: ["home"], label: l.home,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>'
      },
      {
        href: "#shop", match: ["shop", "product"], label: l.catalog,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
      },
      {
        href: "#cart", match: ["cart", "checkout"], label: l.cart,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-13zM6 6 5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
        badge: "cart"
      },
      {
        href: "#wishlist", match: ["wishlist"], label: l.fav,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        badge: "fav"
      },
      {
        href: "#account", match: ["account", "login", "register", "orders"], label: l.account,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
      }
    ];

    var nav = document.createElement("nav");
    nav.id = "bottom-nav";
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Mobile navigation");

    var inner = document.createElement("div");
    inner.className = "bottom-nav__inner";

    items.forEach(function(it) {
      var a = document.createElement("a");
      a.className = "bottom-nav__item";
      a.href = it.href;
      if (it.match.indexOf(route) >= 0) a.setAttribute("aria-current", "page");
      a.innerHTML = it.svg + '<span class="bottom-nav__label">' + it.label + '</span>';
      if (it.badge === "cart") {
        var b = document.createElement("span");
        b.className = "bottom-nav__badge";
        b.setAttribute("data-cart-count", "");
        b.style.display = "none";
        b.textContent = "0";
        a.appendChild(b);
      } else if (it.badge === "fav") {
        var b2 = document.createElement("span");
        b2.className = "bottom-nav__badge";
        b2.setAttribute("data-fav-count", "");
        b2.style.display = "none";
        b2.textContent = "0";
        a.appendChild(b2);
      }
      on(a, "click", hapticTap);
      inner.appendChild(a);
    });

    nav.appendChild(inner);
    document.body.appendChild(nav);

    if (typeof window.updateCartPill === "function") window.updateCartPill();
    if (typeof window.updateFavPill === "function") window.updateFavPill();
  }

  // ==================== 3. RICH STICKY CTA (PDP) ====================
  var richIO = null;
  var richMO = null;

  function buildRichStickyCta() {
    var oldHost = $("#sticky-cta-rich");
    if (oldHost) oldHost.remove();
    document.body.classList.remove("has-sticky-cta-rich");
    if (richIO) { richIO.disconnect(); richIO = null; }
    if (richMO) { richMO.disconnect(); richMO = null; }

    if (getRoute() !== "product") return;
    if (window.innerWidth > 900) return;

    var pdpImg = $("#pdpImg");
    var pdpName = $(".pdp__name");
    var pdpPriceEl = $(".pdp__price");
    var pdpPriceOld = $(".pdp__price-old");
    var pdpColorLabel = $("#colorLabel");
    var addBtn = $("#addBtn");

    if (!addBtn) return;

    var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
    var ctaText = { uk: "В кошик", pl: "Do koszyka", en: "Add" }[L] || "В кошик";

    var host = document.createElement("div");
    host.id = "sticky-cta-rich";
    host.className = "sticky-cta--rich";
    host.setAttribute("aria-hidden", "true");

    var thumbSrc = pdpImg ? pdpImg.getAttribute("src") : "";
    var name = pdpName ? pdpName.textContent.trim() : "";
    var price = pdpPriceEl ? pdpPriceEl.textContent.trim() : "";
    var oldPrice = pdpPriceOld ? pdpPriceOld.textContent.trim() : "";
    var colorTxt = pdpColorLabel ? pdpColorLabel.textContent.trim() : "";

    host.innerHTML =
      '<div class="sticky-cta--rich__thumb"><img src="' + thumbSrc + '" alt="" loading="lazy"/></div>' +
      '<div class="sticky-cta--rich__info">' +
        '<span class="sticky-cta--rich__name">' + name + '</span>' +
        '<span class="sticky-cta--rich__meta">' +
          (colorTxt ? '<span data-rich-color>' + colorTxt + '</span><span style="opacity:.5">·</span>' : '') +
          '<span class="sticky-cta--rich__price">' + price + '</span>' +
          (oldPrice ? '<span class="sticky-cta--rich__old">' + oldPrice + '</span>' : '') +
        '</span>' +
      '</div>' +
      '<button type="button" class="sticky-cta--rich__btn" id="stickyRichAdd">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6h15l-1.5 9h-13z"/><path d="m6 6-1-3H2"/></svg>' +
        '<span>' + ctaText + '</span>' +
      '</button>';

    document.body.appendChild(host);

    on($("#stickyRichAdd"), "click", function() {
      hapticConfirm();
      if (addBtn) addBtn.click();
    });

    if ("IntersectionObserver" in window) {
      richIO = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          var hide = e.isIntersecting;
          host.classList.toggle("visible", !hide);
          host.setAttribute("aria-hidden", hide ? "true" : "false");
          document.body.classList.toggle("has-sticky-cta-rich", !hide);
        });
      }, { threshold: 0.15 });
      richIO.observe(addBtn);
    }

    // Sync на зміни кольору/фото
    if (pdpImg) {
      richMO = new MutationObserver(function() {
        var newSrc = pdpImg.getAttribute("src");
        var t = $(".sticky-cta--rich__thumb img");
        if (t && t.src !== newSrc) t.src = newSrc;
        var cl = $("#colorLabel");
        var metaColor = host.querySelector("[data-rich-color]");
        if (cl && metaColor && metaColor.textContent !== cl.textContent.trim()) {
          metaColor.textContent = cl.textContent.trim();
        }
      });
      richMO.observe(pdpImg, { attributes: true, attributeFilter: ["src"] });
    }
  }

  // ==================== 4. PDP ENHANCEMENTS ====================
  function enhancePDP() {
    if (getRoute() !== "product") return;

    var ctaBox = $(".pdp__cta");
    if (!ctaBox) return;

    var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
    var trustText = {
      uk: ["Гарантія 6 міс", "Повернення 14 днів", "Нова Пошта 2–3 дні", "Оригінал · Stanley 1913"],
      pl: ["Gwarancja 6 mies.", "Zwrot 14 dni", "Nova Poshta 2–3 dni", "Oryginał · Stanley 1913"],
      en: ["6-month warranty", "14-day returns", "Nova Poshta 2–3 days", "Original · Stanley 1913"]
    }[L] || ["Гарантія 6 міс", "Повернення 14 днів", "Нова Пошта 2–3 дні", "Оригінал · Stanley 1913"];

    // Trust chips під CTA
    if (!$(".pdp-trust-row")) {
      var row = document.createElement("div");
      row.className = "pdp-trust-row";
      row.innerHTML =
        '<span class="pdp-trust-row__chip">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z"/><path d="m9 12 2 2 4-4"/></svg>' +
          trustText[0] +
        '</span>' +
        '<span class="pdp-trust-row__chip">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>' +
          trustText[1] +
        '</span>' +
        '<span class="pdp-trust-row__chip">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 9V7a2 2 0 0 0-2-2h-3l-2-2H10L8 5H5a2 2 0 0 0-2 2v2"/><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="M3 13h18"/></svg>' +
          trustText[2] +
        '</span>' +
        '<span class="pdp-trust-row__chip">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>' +
          trustText[3] +
        '</span>';
      ctaBox.parentNode.insertBefore(row, ctaBox.nextSibling);
    }

    // Quick-buy Telegram button (mobile only)
    if (window.innerWidth <= 720 && !$(".pdp__quick-buy")) {
      var qbText = { uk: "Купити в 1 клік · Telegram", pl: "Kup 1-kliknięciem · Telegram", en: "Buy in 1 click · Telegram" }[L] || "Купити в 1 клік · Telegram";
      var quickBtn = document.createElement("button");
      quickBtn.type = "button";
      quickBtn.className = "pdp__quick-buy";
      quickBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>' +
        '<span>' + qbText + '</span>';
      ctaBox.parentNode.insertBefore(quickBtn, ctaBox.nextSibling);
      on(quickBtn, "click", function() {
        hapticConfirm();
        var pdpName = $(".pdp__name");
        var pdpPrice = $(".pdp__price");
        var colorLbl = $("#colorLabel");
        var qty = $("#qtyV") ? $("#qtyV").textContent.trim() : "1";
        var msg = encodeURIComponent(
          "Привіт! Хочу замовити в 1 клік:\n" +
          "📦 " + (pdpName ? pdpName.textContent.trim() : "") + "\n" +
          "🎨 Колір: " + (colorLbl ? colorLbl.textContent.trim() : "") + "\n" +
          "🔢 Кількість: " + qty + "\n" +
          "💰 Ціна: " + (pdpPrice ? pdpPrice.textContent.trim() : "")
        );
        var tg = (window.BRAND && window.BRAND.telegram) ? window.BRAND.telegram : "stanley_brand_ua";
        tg = tg.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
        window.open("https://t.me/" + tg + "?text=" + msg, "_blank");
      });
    }

    // Skeleton при завантаженні зображення
    var img = $("#pdpImg");
    var wrap = $(".pdp__media");
    if (img && wrap) {
      if (!img.complete) {
        wrap.classList.add("is-loading");
        on(img, "load", function() { wrap.classList.remove("is-loading"); });
        on(img, "error", function() { wrap.classList.remove("is-loading"); });
      }
    }

    // Color picker — обмежуємо до 8, кнопка "+N more"
    setupColorCollapse();
  }

  function setupColorCollapse() {
    var row = $(".pdp__color-row");
    if (!row) return;
    var swatches = row.querySelectorAll(".pdp__color");
    /* Pass 1 audit: align with v3 CSS cap (.pdp__color:nth-child(n+6) {display:none}).
       v3.js already injects "Show all N" toggle — if it bound, we skip. */
    if (row.dataset.v3Enhanced) return;
    if (swatches.length <= 5) {
      row.style.maxHeight = "none";
      return;
    }
    if (row.classList.contains("expanded")) return; // вже розгорнуто
    // Додаємо кнопку якщо ще нема
    if (!row.nextElementSibling || !row.nextElementSibling.classList.contains("pdp__color-toggle")) {
      var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
      var moreText = { uk: "Показати всі " + swatches.length, pl: "Pokaż wszystkie " + swatches.length, en: "Show all " + swatches.length }[L] || ("Показати всі " + swatches.length);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pdp__color-toggle";
      btn.innerHTML = moreText + ' <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
      row.parentNode.insertBefore(btn, row.nextSibling);
      on(btn, "click", function() {
        row.classList.toggle("expanded");
        var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
        var lessText = { uk: "Згорнути", pl: "Zwiń", en: "Show less" }[L] || "Згорнути";
        btn.innerHTML = (row.classList.contains("expanded") ? lessText : moreText) +
          ' <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="' +
          (row.classList.contains("expanded") ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6") +
          '"/></svg>';
      });
    }
  }

  // ==================== 5. PARALLEL IMPORT DISCLAIMER — перенесення ====================
  function relocateDisclaimer() {
    if (getRoute() !== "product") return;
    var disclaimer = $(".pdp__disclaimer");
    if (!disclaimer || disclaimer.dataset.relocated) return;
    // Знаходимо Returns details
    var detailsList = $$(".pdp details.acc");
    var returnsDetails = detailsList.find(function(d) {
      var s = d.querySelector("summary");
      if (!s) return false;
      var txt = s.textContent.toLowerCase();
      return txt.indexOf("повернен") >= 0 || txt.indexOf("return") >= 0 || txt.indexOf("zwrot") >= 0;
    });
    if (returnsDetails) {
      var div = returnsDetails.querySelector("div");
      if (div) {
        var clone = disclaimer.cloneNode(true);
        clone.style.display = "block";
        clone.style.marginTop = "12px";
        div.appendChild(clone);
        disclaimer.dataset.relocated = "1";
      }
    }
  }

  // ==================== 6. HERO CTA — конкретний текст ====================
  function enhanceHeroCTA() {
    if (getRoute() !== "home") return;
    var heroCta = $(".hero__cta-primary");
    if (!heroCta || heroCta.dataset.enhanced) return;
    var L = (document.documentElement.lang || "uk").toLowerCase().slice(0,2);
    // Спробуємо знайти Quencher 40oz через DOM (price block у top-section)
    var price = null;
    // Find цена через JSON-LD або product cards
    var firstCard = $(".pcard__price");
    if (firstCard) {
      price = firstCard.childNodes[0] ? firstCard.childNodes[0].textContent.trim() : firstCard.textContent.trim();
    }
    // Fallback ціна
    if (!price) price = L === "pl" ? "2 500 zł" : (L === "en" ? "2,500 ₴" : "2 500 ₴");

    var prefix = { uk: "Купити Quencher 40oz · від ", pl: "Kup Quencher 40oz · od ", en: "Shop Quencher 40oz · from " }[L] || "Купити Quencher 40oz · від ";
    heroCta.innerHTML = prefix + price +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';
    heroCta.href = "#product?id=stanley-quencher-40";
    heroCta.dataset.enhanced = "1";
  }

  // ==================== 7. SWIPE-TO-CLOSE для cart drawer ====================
  function setupSwipeClose() {
    var drawer = $("#cart-drawer");
    if (!drawer || drawer.dataset.swipeBound) return;
    var panel = drawer.querySelector(".drawer-panel");
    if (!panel) return;

    var startY = 0, currentY = 0, dragging = false;

    on(panel, "touchstart", function(e) {
      if (window.innerWidth > 900) return;
      // Тільки якщо торкаємось верхньої частини (handle area)
      var rect = panel.getBoundingClientRect();
      var touchY = e.touches[0].clientY;
      if (touchY - rect.top > 60) return; // тільки верхні 60px
      startY = touchY;
      currentY = touchY;
      dragging = true;
      panel.style.transition = "none";
    }, { passive: true });

    on(panel, "touchmove", function(e) {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      var diff = Math.max(0, currentY - startY);
      panel.style.transform = "translateY(" + diff + "px)";
    }, { passive: true });

    on(panel, "touchend", function() {
      if (!dragging) return;
      dragging = false;
      var diff = currentY - startY;
      panel.style.transition = "";
      if (diff > 120) {
        // Закриваємо
        if (typeof window.closeCart === "function") window.closeCart();
        else {
          var btn = drawer.querySelector("[data-cart-close]");
          if (btn) btn.click();
        }
      }
      panel.style.transform = "";
    });

    drawer.dataset.swipeBound = "1";
  }

  // ==================== 8. CART OPEN — body class ====================
  function setupCartOpenClass() {
    var drawer = $("#cart-drawer");
    if (!drawer || drawer.dataset.classBound) return;
    var mo = new MutationObserver(function() {
      var open = drawer.classList.contains("open");
      document.body.classList.toggle("cart-open", open);
    });
    mo.observe(drawer, { attributes: true, attributeFilter: ["class"] });
    drawer.dataset.classBound = "1";
  }

  // ==================== 9. HAPTICS на add-to-cart, qty, color ====================
  function bindHaptics() {
    document.addEventListener("click", function(e) {
      var t = e.target.closest("#addBtn, #qtyInc, #qtyDec, .pdp__color, [data-add], .btn-primary, [data-open-cart], [data-cart-close], .pcard__quick-add, .fpill, .bottom-nav__item");
      if (t) hapticTap();
    }, true);
  }

  // ==================== 10. iOS VH FIX ====================
  function fixIosVh() {
    var setVh = function() {
      document.documentElement.style.setProperty("--app-vh", window.innerHeight + "px");
    };
    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);
  }

  // ==================== 11. POPULAR-IN-EMPTY-CART — add quick button ====================
  function enhanceCartEmptyPopular() {
    $$(".cart-empty__popular-item").forEach(function(item) {
      if (item.dataset.enhanced) return;
      // Дістаємо product id з href
      var href = item.getAttribute("href") || "";
      var idMatch = href.match(/id=([^&]+)/);
      if (!idMatch) return;
      var pid = idMatch[1];
      var L = ((document.documentElement.lang || "uk").toLowerCase().slice(0,2));
      var addText = { uk: "+", pl: "+", en: "+" }[L] || "+";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cart-empty__popular-quick";
      btn.innerHTML = addText + " " + ({ uk: "В кошик", pl: "Dodaj", en: "Add" }[L] || "В кошик");
      btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        hapticConfirm();
        if (window.Cart && typeof window.Cart.add === "function") {
          var p = (window.PRODUCTS || []).find(function(x) { return x.id === pid; });
          if (p) {
            window.Cart.add(p.id, p.colors ? p.colors[0] : null, 1);
            if (typeof window.renderCartDrawer === "function") window.renderCartDrawer();
            if (typeof window.updateCartPill === "function") window.updateCartPill();
          }
        }
      };
      item.appendChild(btn);
      item.dataset.enhanced = "1";
    });
  }

  // ==================== 12. CATALOG — fix filter pills overflow ====================
  function enhanceCatalog() {
    if (getRoute() !== "shop" && getRoute() !== "home") return;
    // Filter row — переконуємось що скролиться горизонтально на mobile
    $$(".filter-row").forEach(function(row) {
      if (row.dataset.scrollFix) return;
      row.dataset.scrollFix = "1";
    });
  }

  // ==================== 13. MAIN DISPATCHER ====================
  function rebuild() {
    buildBottomNav();
    setTimeout(function() {
      enhancePDP();
      buildRichStickyCta();
      relocateDisclaimer();
      enhanceHeroCTA();
      enhanceCartEmptyPopular();
      enhanceCatalog();
      setupSwipeClose();
      setupCartOpenClass();
    }, 50);
  }

  // ==================== INIT ====================
  function init() {
    bindHaptics();
    fixIosVh();
    rebuild();

    window.addEventListener("hashchange", rebuild);

    // Перебудова при перерендері контенту
    var main = $("#main");
    if (main) {
      var mo = new MutationObserver(function(mutations) {
        var significant = mutations.some(function(m) {
          return Array.from(m.addedNodes).some(function(n) {
            return n.nodeType === 1 && (
              n.id === "addBtn" ||
              n.classList && (n.classList.contains("pdp") || n.classList.contains("cart-empty"))  ||
              (n.querySelector && (n.querySelector("#addBtn") || n.querySelector(".cart-empty__popular-item")))
            );
          });
        });
        if (significant) {
          setTimeout(rebuild, 30);
        }
      });
      mo.observe(main, { childList: true, subtree: true });
    }

    // Cart drawer перерендеримо коли відкривається
    var cd = $("#cart-drawer");
    if (cd) {
      var cmo = new MutationObserver(function() {
        if (cd.classList.contains("open")) {
          setTimeout(function() {
            enhanceCartEmptyPopular();
            setupSwipeClose();
          }, 100);
        }
      });
      cmo.observe(cd, { attributes: true, attributeFilter: ["class"] });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
   GALLERY REDESIGN v2.1 — Instagram-style + premium lightbox
   ===================================================================== */
(function() {
  "use strict";

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }
  function hapticTap() { if (navigator.vibrate) navigator.vibrate(8); }

  function getLang() {
    return (document.documentElement.lang || "uk").toLowerCase().slice(0,2);
  }

  function buildIgStrip() {
    var L = getLang();
    var labels = {
      uk: { handle: "@stanley_brand_ua", sub: "Реальні фото клієнтів · Підпишись" },
      pl: { handle: "@stanley_brand_ua", sub: "Prawdziwe zdjęcia klientów · Obserwuj" },
      en: { handle: "@stanley_brand_ua", sub: "Real customer photos · Follow" }
    };
    var l = labels[L] || labels.uk;
    return '<a href="https://www.instagram.com/stanley_brand_ua/" target="_blank" rel="noopener" class="gallery-ig-strip">' +
      '<span class="gallery-ig-strip__icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/>' +
          '<circle cx="12" cy="12" r="4.2"/>' +
          '<circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none"/>' +
        '</svg>' +
      '</span>' +
      '<span class="gallery-ig-strip__handle">' + l.handle + '</span>' +
      '<span class="gallery-ig-strip__sep"></span>' +
      '<span class="gallery-ig-strip__sub">' + l.sub + '</span>' +
    '</a>';
  }

  var GALLERY_INITIAL = 12;
  var GALLERY_STEP = 12;

  function transformGallery() {
    var section = $(".gallery-section");
    if (!section || section.dataset.transformed) return;
    var grid = $("#galleryGrid");
    if (!grid) return;

    // 1. Зупиняємо ротатор
    if (window._galleryRotateT) {
      clearInterval(window._galleryRotateT);
      window._galleryRotateT = null;
    }

    // 2. Розпарюємо комірки: оригінальний рендер кладе по 2 img у комірку (для crossfade).
    //    Виносимо другі img у НОВІ окремі комірки після батьківської.
    var existingCells = Array.from(grid.querySelectorAll(".gallery-grid__item"));
    existingCells.forEach(function(cell) {
      cell.classList.remove("gallery-grid__item--wide", "gallery-grid__item--tall");
      cell.style.removeProperty("--rotate-delay");
      var imgs = cell.querySelectorAll("img");
      // Перший лишається у поточній комірці
      if (imgs[0]) {
        imgs[0].classList.add("is-active");
        if (imgs[0].complete) imgs[0].classList.add("is-loaded");
        else on(imgs[0], "load", function() { imgs[0].classList.add("is-loaded"); });
        cell.setAttribute("data-glb-src", imgs[0].getAttribute("src") || "");
      }
      // Другі img → нові комірки після
      for (var i = 1; i < imgs.length; i++) {
        var im = imgs[i];
        var newCell = document.createElement("div");
        newCell.className = "gallery-grid__item";
        newCell.setAttribute("data-gallery-cell", "");
        newCell.setAttribute("data-glb-src", im.getAttribute("src") || "");
        var newImg = document.createElement("img");
        newImg.src = im.getAttribute("src") || "";
        newImg.alt = im.getAttribute("alt") || "";
        newImg.loading = "lazy";
        newImg.decoding = "async";
        newImg.classList.add("is-active");
        if (newImg.complete) newImg.classList.add("is-loaded");
        else on(newImg, "load", function() { this.classList.add("is-loaded"); });
        newCell.appendChild(newImg);
        // Вставляємо одразу після поточної комірки (щоб порядок зберігся)
        cell.parentNode.insertBefore(newCell, cell.nextSibling);
        im.remove();
      }
    });

    // 3. Прибираємо хвостові порожні комірки (якщо рендер створив зайві)
    Array.from(grid.querySelectorAll(".gallery-grid__item")).forEach(function(c) {
      if (!c.querySelector("img")) c.remove();
    });

    // 4. Скриваємо все що > GALLERY_INITIAL + eager-load для перших
    var allCells = Array.from(grid.querySelectorAll(".gallery-grid__item"));
    allCells.forEach(function(cell, idx) {
      var im = cell.querySelector("img");
      if (idx >= GALLERY_INITIAL) {
        cell.classList.add("is-hidden");
      } else if (im) {
        // Перші 12 фото — завантажуємо одразу, без чекання viewport
        im.loading = "eager";
        im.fetchPriority = "auto";
      }
    });

    // 5. Додаємо Instagram-strip перед grid
    var head = section.querySelector(".gallery-section__head");
    if (head && !section.querySelector(".gallery-ig-strip")) {
      var stripWrap = document.createElement("div");
      stripWrap.style.cssText = "display:flex;justify-content:center;margin-bottom:20px;";
      stripWrap.innerHTML = buildIgStrip();
      head.insertAdjacentElement("afterend", stripWrap);
    }

    // 6. Додаємо "Завантажити більше" якщо є приховані
    var hidden = grid.querySelectorAll(".is-hidden").length;
    if (hidden > 0 && !section.querySelector(".gallery-load-more")) {
      var L = getLang();
      var labels = {
        uk: { more: "Показати ще", less: "Згорнути" },
        pl: { more: "Pokaż więcej", less: "Zwiń" },
        en: { more: "Show more", less: "Show less" }
      };
      var lbl = labels[L] || labels.uk;
      var more = document.createElement("div");
      more.className = "gallery-load-more";
      more.innerHTML = '<button type="button">' +
        '<span>' + lbl.more + ' · ' + hidden + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>';
      grid.insertAdjacentElement("afterend", more);
      var btn = more.querySelector("button");
      var expanded = false;
      on(btn, "click", function() {
        hapticTap();
        expanded = !expanded;
        Array.from(grid.querySelectorAll(".gallery-grid__item")).forEach(function(c, idx) {
          if (idx >= GALLERY_INITIAL) {
            if (expanded) c.classList.remove("is-hidden");
            else c.classList.add("is-hidden");
          }
        });
        btn.querySelector("span").textContent = expanded ? lbl.less : (lbl.more + " · " + (allCells.length - GALLERY_INITIAL));
        var svg = btn.querySelector("svg path");
        if (svg) svg.setAttribute("d", expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6");
        if (!expanded) {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    section.dataset.transformed = "1";
  }

  // ==================== PREMIUM LIGHTBOX ====================
  var GLB_STATE = {
    items: [],
    idx: 0,
    el: null
  };

  function ensureLightbox() {
    if (GLB_STATE.el) return GLB_STATE.el;
    var glb = document.createElement("div");
    glb.id = "glb-host";
    glb.className = "glb";
    glb.setAttribute("role", "dialog");
    glb.setAttribute("aria-modal", "true");
    glb.setAttribute("aria-label", "Image preview");
    glb.innerHTML =
      '<div class="glb__top">' +
        '<span class="glb__counter"></span>' +
        '<button class="glb__close" aria-label="Close" type="button">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<button class="glb__nav glb__nav--prev" aria-label="Previous" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
      '</button>' +
      '<button class="glb__nav glb__nav--next" aria-label="Next" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
      '</button>' +
      '<div class="glb__stage">' +
        '<img class="glb__img" alt="" draggable="false"/>' +
      '</div>' +
      '<div class="glb__caption"></div>' +
      '<div class="glb__thumbs"></div>';
    document.body.appendChild(glb);

    on(glb.querySelector(".glb__close"), "click", closeGlb);
    on(glb.querySelector(".glb__nav--prev"), "click", function(e) { e.stopPropagation(); navGlb(-1); });
    on(glb.querySelector(".glb__nav--next"), "click", function(e) { e.stopPropagation(); navGlb(1); });
    on(glb, "click", function(e) {
      if (e.target === glb || e.target.classList.contains("glb__stage")) closeGlb();
    });

    // Keyboard
    document.addEventListener("keydown", function(e) {
      if (!glb.classList.contains("is-open")) return;
      if (e.key === "Escape") closeGlb();
      else if (e.key === "ArrowLeft") navGlb(-1);
      else if (e.key === "ArrowRight") navGlb(1);
    });

    // Swipe
    var img = glb.querySelector(".glb__img");
    var startX = 0, currentX = 0, swiping = false;
    on(img, "touchstart", function(e) {
      startX = e.touches[0].clientX;
      currentX = startX;
      swiping = true;
      img.classList.add("is-swiping");
    }, { passive: true });
    on(img, "touchmove", function(e) {
      if (!swiping) return;
      currentX = e.touches[0].clientX;
      var dx = currentX - startX;
      img.style.transform = "translateX(" + dx + "px)";
      img.style.opacity = String(1 - Math.min(Math.abs(dx) / 400, 0.5));
    }, { passive: true });
    on(img, "touchend", function() {
      if (!swiping) return;
      swiping = false;
      img.classList.remove("is-swiping");
      var dx = currentX - startX;
      img.style.transform = "";
      img.style.opacity = "";
      if (Math.abs(dx) > 60) {
        navGlb(dx < 0 ? 1 : -1);
      }
    });

    GLB_STATE.el = glb;
    return glb;
  }

  function openGlb(items, startIdx) {
    var glb = ensureLightbox();
    GLB_STATE.items = items;
    GLB_STATE.idx = startIdx || 0;
    updateGlb();
    glb.classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.body.classList.add("glb-open");
    hapticTap();
  }

  function closeGlb() {
    if (!GLB_STATE.el) return;
    GLB_STATE.el.classList.remove("is-open");
    document.body.style.overflow = "";
    document.body.classList.remove("glb-open");
  }

  function navGlb(dir) {
    var len = GLB_STATE.items.length;
    if (!len) return;
    GLB_STATE.idx = (GLB_STATE.idx + dir + len) % len;
    updateGlb();
    hapticTap();
  }

  function updateGlb() {
    var glb = GLB_STATE.el;
    if (!glb) return;
    var item = GLB_STATE.items[GLB_STATE.idx];
    if (!item) return;
    var img = glb.querySelector(".glb__img");
    img.src = item.src;
    img.alt = item.alt || "";
    // Counter
    glb.querySelector(".glb__counter").textContent = (GLB_STATE.idx + 1) + " / " + GLB_STATE.items.length;
    // Caption
    glb.querySelector(".glb__caption").innerHTML = item.alt
      ? '<strong>@stanley_brand_ua</strong> · ' + item.alt
      : '<strong>@stanley_brand_ua</strong>';
    // Thumbs
    var thumbs = glb.querySelector(".glb__thumbs");
    if (thumbs.children.length !== GLB_STATE.items.length) {
      thumbs.innerHTML = "";
      GLB_STATE.items.forEach(function(it, i) {
        var t = document.createElement("div");
        t.className = "glb__thumb";
        t.innerHTML = '<img src="' + it.src + '" alt="" loading="lazy"/>';
        on(t, "click", function() { GLB_STATE.idx = i; updateGlb(); });
        thumbs.appendChild(t);
      });
    }
    Array.from(thumbs.children).forEach(function(t, i) {
      t.classList.toggle("is-active", i === GLB_STATE.idx);
      if (i === GLB_STATE.idx) {
        // Scroll thumb into view
        t.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });
  }

  function bindGalleryClicks() {
    var cells = $$(".gallery-grid__item");
    if (!cells.length) return;
    // Збираємо items
    var items = cells.map(function(c) {
      var img = c.querySelector("img");
      return {
        src: c.getAttribute("data-glb-src") || (img && img.src) || "",
        alt: (img && img.alt) || ""
      };
    });
    cells.forEach(function(c, i) {
      if (c.dataset.glbBound) return;
      // Видаляємо старий handler (через клонування), щоб не дублювалось
      var clone = c.cloneNode(true);
      c.parentNode.replaceChild(clone, c);
      clone.dataset.glbBound = "1";
      on(clone, "click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Перебудовуємо items на момент кліку (можливо змінилися)
        var current = $$(".gallery-grid__item").map(function(cc) {
          var im = cc.querySelector("img");
          return {
            src: cc.getAttribute("data-glb-src") || (im && im.src) || "",
            alt: (im && im.alt) || ""
          };
        });
        var idx = $$(".gallery-grid__item").indexOf(clone);
        openGlb(current, idx);
      });
    });
  }

  // ===== Init =====
  function init() {
    transformGallery();
    setTimeout(bindGalleryClicks, 100);
  }

  // Слухаємо появу галереї (вона рендериться JS app-ом)
  var checkInterval = setInterval(function() {
    if ($(".gallery-section") && $("#galleryGrid")) {
      transformGallery();
      bindGalleryClicks();
    }
  }, 500);

  // Зупинимо через 30 сек якщо вже застосовано
  setTimeout(function() { clearInterval(checkInterval); }, 30000);

  // Перебудова при route change
  window.addEventListener("hashchange", function() {
    setTimeout(function() {
      transformGallery();
      bindGalleryClicks();
    }, 200);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
   CATALOG REFINEMENTS v2.2 — додає назву кольору під назву товару
   ===================================================================== */
(function() {
  "use strict";
  function $$(s, r) { return Array.from((r || document).querySelectorAll(s)); }

  function getLang() {
    return (document.documentElement.lang || "uk").toLowerCase().slice(0,2);
  }

  function enhanceCatalogCards() {
    var cards = $$(".pcard");
    cards.forEach(function(card) {
      if (card.dataset.colorNameAdded) return;
      // Знаходимо назву товару
      var nameEl = card.querySelector(".pcard__name");
      if (!nameEl) return;
      // Дивимось чи назва вже містить " · ColorName" (наприклад "Quencher 40oz · Lilac")
      // Якщо так — нічого не робимо, бо назва вже з кольором
      // Якщо ні — намагаємось взяти з першого swatch
      var swatch = card.querySelector(".pcard__swatch.active, .pcard__swatch");
      var L = getLang();
      var colorName = "";
      if (swatch) {
        var title = swatch.getAttribute("title");
        if (title) colorName = title;
        else {
          // Спробуємо взяти data-card-color і вирішити через COLORS
          var c = swatch.getAttribute("data-card-color");
          if (c && window.COLORS && window.COLORS[c]) {
            var key = "name_" + L;
            colorName = window.COLORS[c][key] || window.COLORS[c].name_uk || c;
          }
        }
      }
      if (!colorName) return;
      // Якщо назва вже містить " · " (як у LSF, наших нових) — пропускаємо
      var nameTxt = nameEl.textContent || "";
      if (nameTxt.indexOf("·") >= 0) {
        card.dataset.colorNameAdded = "1";
        return;
      }
      // Додаємо span з назвою кольору одразу після nameEl
      var span = document.createElement("span");
      span.className = "pcard__color-name";
      span.textContent = colorName;
      // Вставляємо одразу після назви
      var nameParent = nameEl.parentNode;
      if (nameEl.nextSibling) {
        nameParent.insertBefore(span, nameEl.nextSibling);
      } else {
        nameParent.appendChild(span);
      }
      card.dataset.colorNameAdded = "1";
    });
  }

  // ЛОВИМО рендер каталогу (через MutationObserver на main)
  function init() {
    enhanceCatalogCards();
    var main = document.getElementById("main");
    if (main) {
      var mo = new MutationObserver(function() {
        // Перевіряємо чи з'явились нові .pcard
        if (document.querySelector(".pcard:not([data-color-name-added])")) {
          setTimeout(enhanceCatalogCards, 50);
        }
      });
      mo.observe(main, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 200);
  }
})();
