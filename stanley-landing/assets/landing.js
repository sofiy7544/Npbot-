/* Stanley landing — логіка сторінки. Дані беруться з config.js (window.LANDING_CONFIG). */
(function () {
  "use strict";

  var cfg = window.LANDING_CONFIG;
  if (!cfg || !cfg.product || !cfg.colors || !cfg.colors.length) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="background:#8B2C28;color:#fff;padding:12px;text-align:center">config.js не завантажився або містить помилку</p>');
    return;
  }

  var T = cfg.texts || {};
  var P = cfg.product;
  var ORDER = cfg.order || {};
  var LS_LAST = "stl_last_order";

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    return new Intl.NumberFormat("uk-UA").format(Math.round(n)) + " " + (P.currency || "₴");
  };
  var setText = function (id, v) { var el = $(id); if (el) el.textContent = v == null ? "" : v; };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var storage = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  var hasOld = P.oldPrice && P.oldPrice > P.price;
  var maxQty = Math.max(1, P.maxQty || 10);
  var state = { color: 0, qty: 1, sending: false, orderId: null, orderFp: null };

  /* ================= Рендер статичних блоків ================= */

  function renderStatic() {
    document.querySelectorAll("[data-brand-name]").forEach(function (el) { el.textContent = cfg.brand && cfg.brand.name || ""; });

    setText("productName", P.name);
    setText("tagline", P.tagline);
    if (P.badge) { setText("badge", P.badge); $("badge").hidden = false; }

    setText("priceNow", money(P.price));
    setText("stickyPrice", money(P.price));
    if (hasOld) {
      setText("priceOld", money(P.oldPrice)); $("priceOld").hidden = false;
      setText("stickyOld", money(P.oldPrice)); $("stickyOld").hidden = false;
      var pct = Math.round((1 - P.price / P.oldPrice) * 100);
      if (pct > 0) { setText("heroOff", "−" + pct + "%"); $("heroOff").hidden = false; }
    }

    ["heroBuy", "stickyBuy"].forEach(function (id) { setText(id, T.buy || "КУПИТИ"); });
    $("heroImg").alt = P.name;

    var trust = cfg.trust || [];
    $("trust").innerHTML = trust.filter(Boolean).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

    // Переваги
    var hl = (cfg.highlights || []).filter(function (h) { return h && h.value; });
    if (hl.length) {
      setText("highlightsTitle", T.highlightsTitle);
      $("highlights").innerHTML = hl.map(function (h) {
        return '<li class="hl">' + icon(h.icon) + '<div class="hl__v">' + esc(h.value) +
          '</div><div class="hl__l">' + esc(h.label || "") + "</div></li>";
      }).join("");
    } else { $("highlightsSec").hidden = true; }

    setText("galleryTitle", T.galleryTitle);
    setText("description", P.description);
    if (!P.description) $("description").hidden = true;
    if (cfg.lifestyleImage) {
      $("lifestyleImg").src = cfg.lifestyleImage;
      $("lifestyleImg").alt = P.name;
      $("lifestyle").hidden = false;
    }

    // Характеристики (порожні значення приховуються)
    var specs = (cfg.specs || []).filter(function (s) { return s && s.label && s.value; });
    if (specs.length) {
      setText("specsTitle", T.specsTitle);
      $("specs").innerHTML = specs.map(function (s) {
        return '<div class="specs__row"><dt>' + esc(s.label) + "</dt><dd>" + esc(s.value) + "</dd></div>";
      }).join("");
    } else { $("specs").hidden = true; $("specsTitle").hidden = true; }
    var box = (cfg.inBox || []).filter(Boolean);
    if (box.length) {
      setText("inBoxTitle", T.inBoxTitle);
      $("inBox").innerHTML = box.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("");
      $("inBoxWrap").hidden = false;
    }
    if (!specs.length && !box.length) $("specsSec").hidden = true;

    // Форма
    setText("orderTitle", T.orderTitle);
    setText("orderLead", T.orderLead);
    setText("formName", P.name);
    setText("formPrice", money(P.price) + (hasOld ? "  ·  " : ""));
    if (hasOld) $("formPrice").insertAdjacentHTML("beforeend", "<s>" + esc(money(P.oldPrice)) + "</s>");
    setText("colorLabel", T.color);
    setText("qtyLabel", T.qty);
    document.querySelectorAll("[data-t]").forEach(function (el) { el.textContent = T[el.getAttribute("data-t")] || ""; });
    setText("summaryTitle", T.summaryTitle);
    setText("totalLbl", T.total);
    setText("sumSaveLbl", T.discount);
    setText("submitLabel", T.submit);
    setText("note", T.note);
    setText("successTitle", T.successTitle);
    setText("successText", T.successText);
    setText("orderNoLbl", T.orderNo);
    setText("newOrderBtn", T.newOrder);

    // Контакти у футері
    var b = cfg.brand || {};
    var links = [];
    if (b.instagram) links.push('<a href="' + esc(b.instagram) + '" target="_blank" rel="noopener">Instagram</a>');
    if (b.telegram) links.push('<a href="' + esc(b.telegram) + '" target="_blank" rel="noopener">Telegram</a>');
    if (b.phone) links.push('<a href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">' + esc(b.phone) + "</a>");
    if (b.email) links.push('<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + "</a>");
    $("contacts").innerHTML = links.join("");

    // Свотчі (однакові в першому екрані та формі)
    ["heroSwatches", "formSwatches"].forEach(function (id) {
      var wrap = $(id);
      wrap.setAttribute("aria-label", T.color || "Колір");
      wrap.innerHTML = cfg.colors.map(function (c, i) {
        return '<button type="button" class="swatch" role="radio" data-i="' + i + '" style="--c:' + esc(c.hex) +
          '" aria-label="' + esc(c.name) + '" title="' + esc(c.name) + '"></button>';
      }).join("");
      wrap.addEventListener("click", function (e) {
        var btn = e.target.closest(".swatch");
        if (btn) selectColor(+btn.getAttribute("data-i"));
      });
      wrap.addEventListener("keydown", onSwatchKey);
    });
    if (cfg.colors.length < 2) {
      $("heroSwatches").hidden = true;
      $("formSwatches").closest("fieldset").hidden = true;
    }

    // Попереднє завантаження головних фото інших кольорів (після load, щоб не гальмувати перший екран)
    window.addEventListener("load", function () {
      setTimeout(function () {
        cfg.colors.forEach(function (c) { if (c.images && c.images[0]) { var im = new Image(); im.src = c.images[0]; } });
      }, 600);
    });
  }

  function onSwatchKey(e) {
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var n = cfg.colors.length;
    var i = (state.color + keys[e.key] + n) % n;
    selectColor(i);
    var btn = e.currentTarget.querySelector('[data-i="' + i + '"]');
    if (btn) btn.focus();
  }

  /* ================= Колір / галерея ================= */

  function selectColor(i) {
    if (i < 0 || i >= cfg.colors.length) return;
    var changed = i !== state.color;
    state.color = i;
    var c = cfg.colors[i];
    var imgs = (c.images || []).filter(Boolean);

    document.querySelectorAll(".swatch").forEach(function (s) {
      var on = +s.getAttribute("data-i") === i;
      s.setAttribute("aria-checked", on ? "true" : "false");
      s.tabIndex = on ? 0 : -1;
    });
    var nameHtml = esc(T.color || "Колір") + ": <b>" + esc(c.name) + "</b>";
    $("heroColorName").innerHTML = nameHtml;
    $("formColorName").innerHTML = nameHtml;
    document.documentElement.style.setProperty("--tint", c.hex);

    var hero = $("heroImg");
    if (imgs[0] && hero.getAttribute("src") !== imgs[0]) {
      if (changed) {
        hero.classList.add("is-fading");
        var next = new Image();
        next.onload = next.onerror = function () { hero.src = imgs[0]; hero.classList.remove("is-fading"); };
        next.src = imgs[0];
      } else { hero.src = imgs[0]; }
    }
    hero.alt = P.name + " — " + c.name;
    $("formImg").src = imgs[0] || "";
    $("formImg").alt = c.name;

    renderGallery(imgs, c.name);
    updateSummary();
  }

  function renderGallery(imgs, colorName) {
    var g = $("gallery");
    g.innerHTML = imgs.map(function (src, k) {
      return '<figure><img src="' + esc(src) + '" alt="' + esc(P.name + " — " + colorName + ", фото " + (k + 1)) +
        '" loading="lazy" decoding="async" width="640" height="640"></figure>';
    }).join("");
    g.scrollLeft = 0;
    $("gallerySec").hidden = !imgs.length && !cfg.lifestyleImage;
    $("galleryDots").innerHTML = imgs.length > 1 ? imgs.map(function (_, k) { return "<i" + (k ? "" : ' class="on"') + "></i>"; }).join("") : "";
  }

  (function bindGalleryDots() {
    var g = $("gallery"), raf = 0;
    g.addEventListener("scroll", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var first = g.firstElementChild; if (!first) return;
        var w = first.getBoundingClientRect().width + 12;
        var idx = Math.round(g.scrollLeft / w);
        var dots = $("galleryDots").children;
        for (var k = 0; k < dots.length; k++) dots[k].classList.toggle("on", k === idx);
      });
    }, { passive: true });
  })();

  /* ================= Кількість / підсумок ================= */

  function setQty(n) {
    state.qty = Math.min(maxQty, Math.max(1, n));
    $("qtyVal").textContent = state.qty;
    $("qtyMinus").disabled = state.qty <= 1;
    $("qtyPlus").disabled = state.qty >= maxQty;
    updateSummary();
  }

  $("qtyMinus").addEventListener("click", function () { setQty(state.qty - 1); });
  $("qtyPlus").addEventListener("click", function () { setQty(state.qty + 1); });

  function updateSummary() {
    var c = cfg.colors[state.color];
    setText("sumLine", P.name + " · " + c.name + " × " + state.qty);
    setText("sumLinePrice", money((hasOld ? P.oldPrice : P.price) * state.qty));
    if (hasOld) {
      setText("sumSave", "−" + money((P.oldPrice - P.price) * state.qty));
      $("sumSaveRow").hidden = false;
    }
    setText("sumTotal", money(P.price * state.qty));
  }

  /* ================= Телефон (+380 XX XXX XX XX) ================= */

  // Повертає 9 цифр національного номера (без 380 і без провідного 0)
  function phoneRest(value) {
    var d = String(value || "").replace(/\D/g, "");
    if ("380".indexOf(d) === 0) return "";          // "", "3", "38", "380"
    if (d.indexOf("380") === 0) d = d.slice(3);
    else if (d.indexOf("80") === 0 && d.length >= 11) d = d.slice(2);
    d = d.replace(/^0+/, "");                       // 067… → 67…
    return d.slice(0, 9);
  }
  function phoneFormat(rest) {
    var out = "+380";
    if (rest.length) out += " " + rest.slice(0, 2);
    if (rest.length > 2) out += " " + rest.slice(2, 5);
    if (rest.length > 5) out += " " + rest.slice(5, 7);
    if (rest.length > 7) out += " " + rest.slice(7, 9);
    return out;
  }
  var phoneValid = function (v) { var r = phoneRest(v); return r.length === 9 && /^[1-9]/.test(r); };

  (function bindPhone() {
    var el = $("phone");
    var prevRest = "";
    el.addEventListener("focus", function () {
      if (!el.value) { el.value = "+380 "; prevRest = ""; }
      requestAnimationFrame(function () { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} });
    });
    el.addEventListener("input", function (e) {
      var atEnd = el.selectionStart === el.value.length;
      var rest = phoneRest(el.value);
      // Видалення пробілу-розділювача: прибираємо цифру перед ним, інакше курсор «застрягає»
      if (e.inputType === "deleteContentBackward" && rest === prevRest && rest.length) rest = rest.slice(0, -1);
      if (atEnd || e.inputType === "insertFromPaste" || e.inputType === "insertReplacementText" || !e.inputType) {
        el.value = rest.length ? phoneFormat(rest) : "+380 ";
      }
      prevRest = rest;
      if (el.classList.contains("is-invalid") && phoneValid(el.value)) clearErr("phone");
    });
    el.addEventListener("blur", function () {
      var rest = phoneRest(el.value);
      el.value = rest.length ? phoneFormat(rest) : "";
      prevRest = rest;
      if (el.value) validateField("phone");
    });
  })();

  /* ================= Валідація ================= */

  var NAME_RE = /^[A-Za-zА-ЯЁа-яёІіЇїЄєҐґ][A-Za-zА-ЯЁа-яёІіЇїЄєҐґ'’ʼ`\- ]*[A-Za-zА-ЯЁа-яёІіЇїЄєҐґ]$/;
  var cleanName = function (v) { return String(v || "").replace(/\s+/g, " ").trim(); };

  var rules = {
    firstName: function (v) { v = cleanName(v); return v.length >= 2 && v.length <= 40 && NAME_RE.test(v) ? "" : T.errName; },
    lastName: function (v) { v = cleanName(v); return v.length >= 2 && v.length <= 40 && NAME_RE.test(v) ? "" : T.errLastName; },
    phone: function (v) { return phoneValid(v) ? "" : T.errPhone; },
  };
  function setErr(id, msg) {
    var el = $(id);
    el.classList.toggle("is-invalid", !!msg);
    el.setAttribute("aria-invalid", msg ? "true" : "false");
    if (msg) el.setAttribute("aria-describedby", id + "Err"); else el.removeAttribute("aria-describedby");
    setText(id + "Err", msg);
  }
  var clearErr = function (id) { setErr(id, ""); };
  function validateField(id) { var msg = rules[id]($(id).value); setErr(id, msg); return !msg; }

  ["firstName", "lastName"].forEach(function (id) {
    var el = $(id);
    el.addEventListener("blur", function () { el.value = cleanName(el.value); if (el.value) validateField(id); });
    el.addEventListener("input", function () { if (el.classList.contains("is-invalid") && !rules[id](el.value)) clearErr(id); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); (id === "firstName" ? $("lastName") : $("phone")).focus(); }
    });
  });

  /* ================= Відправлення ================= */

  function fingerprint() {
    return [phoneRest($("phone").value), cfg.colors[state.color].id, state.qty,
      cleanName($("firstName").value).toLowerCase(), cleanName($("lastName").value).toLowerCase()].join("|");
  }
  function newOrderId() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var rnd = (window.crypto && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint32Array(1))[0] % 1e6
      : Math.floor(Math.random() * 1e6);
    return "TT" + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + String(rnd).padStart(6, "0");
  }

  function sourceInfo() {
    var q = new URLSearchParams(location.search), src = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid"].forEach(function (k) {
      var v = q.get(k); if (v) src[k] = v.slice(0, 200);
    });
    if (document.referrer) src.referrer = document.referrer.slice(0, 300);
    return src;
  }

  function showAlert(html, kind) {
    var a = $("formAlert");
    a.className = "alert" + (kind ? " alert--" + kind : "");
    a.innerHTML = html;
    a.hidden = false;
    a.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function hideAlert() { $("formAlert").hidden = true; $("formAlert").innerHTML = ""; }
  function contactLinks() {
    var b = cfg.brand || {}, l = [];
    if (b.telegram) l.push('<a href="' + esc(b.telegram) + '" target="_blank" rel="noopener">Telegram</a>');
    if (b.instagram) l.push('<a href="' + esc(b.instagram) + '" target="_blank" rel="noopener">Instagram</a>');
    if (b.phone) l.push('<a href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">' + esc(b.phone) + "</a>");
    return l.length ? "<br>" + esc(T.writeUs || "") + ": " + l.join(" · ") : "";
  }

  function setSending(on) {
    state.sending = on;
    var btn = $("submitBtn");
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
    btn.setAttribute("aria-busy", on ? "true" : "false");
    setText("submitLabel", on ? T.sending : T.submit);
  }

  $("orderForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.sending) return;                      // захист від подвійного натискання
    hideAlert();

    var firstBad = null;
    ["firstName", "lastName", "phone"].forEach(function (id) {
      if (id !== "phone") $(id).value = cleanName($(id).value);
      if (!validateField(id) && !firstBad) firstBad = id;
    });
    if (firstBad) { $(firstBad).focus(); return; }

    // Захист від повторного замовлення (наприклад, людина повернулась із TikTok і натиснула ще раз)
    var fp = fingerprint();
    var last = storage.get(LS_LAST);
    var windowMs = (ORDER.repeatWindowMin || 15) * 60000;
    if (last && last.fp === fp && Date.now() - last.at < windowMs && !e.forceRepeat) {
      var min = Math.max(1, Math.round((Date.now() - last.at) / 60000));
      showAlert(esc((T.repeatWarn || "").replace("{min}", min).replace("{id}", last.id)) +
        '<div class="alert__actions"><button type="button" class="btn btn--primary" id="repeatYes">Так, надіслати</button>' +
        '<button type="button" class="btn btn--ghost" id="repeatNo">Ні</button></div>', "info");
      $("repeatYes").onclick = function () { hideAlert(); state.orderId = null; send(fp); };
      $("repeatNo").onclick = hideAlert;
      return;
    }
    send(fp);
  });

  function send(fp) {
    if (state.sending) return;
    if (!ORDER.endpoint) {
      console.warn("[landing] order.endpoint не задано в config.js — замовлення нікуди не надсилається.");
      showAlert(esc(T.errNotConfigured) + contactLinks());
      return;
    }
    // Той самий ідентифікатор при повторі після помилки → сервер не створить дубль
    if (!state.orderId || state.orderFp !== fp) { state.orderId = newOrderId(); state.orderFp = fp; }

    var c = cfg.colors[state.color];
    var payload = {
      orderId: state.orderId,
      createdAt: new Date().toISOString(),
      product: { id: P.id, name: P.name },
      color: { id: c.id, name: c.name },
      qty: state.qty,
      unitPrice: P.price,
      total: P.price * state.qty,
      customer: {
        firstName: cleanName($("firstName").value),
        lastName: cleanName($("lastName").value),
        phone: "+380" + phoneRest($("phone").value),
      },
      source: sourceInfo(),
      website: $("website").value,                  // honeypot
    };

    setSending(true);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ORDER.timeoutMs || 15000);

    fetch(ORDER.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": state.orderId },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
    }).then(function (r) {
      clearTimeout(timer);
      if (r.res.ok && r.data && r.data.ok) return onSuccess(r.data, payload, fp);
      setSending(false);
      if (r.res.status === 429) return showAlert(esc(T.errRateLimit));
      if (r.res.status === 400 && r.data && r.data.field && rules[r.data.field]) {
        setErr(r.data.field, rules[r.data.field]("") || T.errServer); $(r.data.field).focus(); return;
      }
      if (r.res.status === 404 || r.res.status === 405 || r.res.status === 503) {
        console.warn("[landing] endpoint " + ORDER.endpoint + " відповів " + r.res.status + ". Чи запущено server/server.js?");
        return showAlert(esc(T.errNotConfigured) + contactLinks());
      }
      showAlert(esc(T.errServer) + contactLinks());
    }).catch(function (err) {
      clearTimeout(timer);
      setSending(false);
      console.warn("[landing] order send failed:", err);
      showAlert(esc(T.errNetwork) + contactLinks());
    });
  }

  function onSuccess(data, payload, fp) {
    var id = data.orderId || payload.orderId;
    storage.set(LS_LAST, { fp: fp, id: id, at: Date.now() });
    setSending(false);
    state.orderId = null; state.orderFp = null;

    $("orderForm").hidden = true;
    setText("orderTitle", ""); $("orderTitle").hidden = true; $("orderLead").hidden = true;
    setText("orderNo", id);
    setText("successSum", payload.product.name + " · " + payload.color.name + " × " + payload.qty + " — " + money(payload.total));
    $("success").hidden = false;
    $("order").scrollIntoView({ block: "start", behavior: "smooth" });
    $("success").focus({ preventScroll: true });
    track("PlaceAnOrder", { value: payload.total, quantity: payload.qty });
    updateSticky();
  }

  $("newOrderBtn").addEventListener("click", function () {
    $("success").hidden = true;
    $("orderForm").hidden = false;
    $("orderTitle").hidden = false; setText("orderTitle", T.orderTitle);
    $("orderLead").hidden = false;
    hideAlert();
    setQty(1);
    $("firstName").focus();
  });

  /* ================= Кнопки «Купити» / липка панель ================= */

  document.querySelectorAll("[data-buy]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      track("AddToCart", { value: P.price, quantity: 1 });
      var target = $("order");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
      if (history.replaceState) history.replaceState(null, "", "#order");
    });
  });

  var heroVisible = true, orderVisible = false;
  function updateSticky() {
    var on = !heroVisible && !orderVisible;
    $("sticky").classList.toggle("is-on", on);
    $("sticky").setAttribute("aria-hidden", on ? "false" : "true");
    $("stickyBuy").tabIndex = on ? 0 : -1;
    document.body.classList.toggle("has-sticky", on);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; updateSticky(); })
      .observe($("heroBuy"));
    new IntersectionObserver(function (es) { orderVisible = es[0].isIntersecting; updateSticky(); }, { rootMargin: "0px 0px -35% 0px" })
      .observe($("order"));
  }
  window.addEventListener("scroll", function () {
    document.querySelector(".topbar").classList.toggle("is-scrolled", window.scrollY > 4);
  }, { passive: true });

  /* ================= TikTok Pixel (якщо задано ID) ================= */

  function loadPixel(id) {
    /* Офіційний сніпет TikTok, скорочений */
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
      ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
      ttq.setAndDefer = function (o, e) { o[e] = function () { o.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.load = function (e) {
        var s = d.createElement("script"); s.async = true;
        s.src = "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" + encodeURIComponent(e) + "&lib=" + t;
        d.head.appendChild(s);
      };
      ttq.load(id); ttq.page();
    }(window, document, "ttq");
  }
  function track(ev, data) {
    if (!window.ttq || !cfg.tiktokPixelId) return;
    try {
      window.ttq.track(ev, Object.assign({ content_id: P.id, content_type: "product", content_name: P.name, currency: "UAH" }, data || {}));
    } catch (e) {}
  }
  if (cfg.tiktokPixelId) {
    loadPixel(cfg.tiktokPixelId);
    track("ViewContent", { value: P.price });
  }

  /* ================= Іконки ================= */

  function icon(name) {
    var p = {
      cold: '<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11"/><path d="M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
      hot: '<path d="M8 3c0 2 2 2 2 4s-2 2-2 4M14 3c0 2 2 2 2 4s-2 2-2 4"/><path d="M4 14h16v1a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/>',
      volume: '<path d="M7 3h10l-1 18H8z"/><path d="M7.5 9h9"/>',
      steel: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
      lid: '<rect x="4" y="8" width="16" height="5" rx="2"/><path d="M14 8V3"/><path d="M6 13l1 8h10l1-8"/>',
      car: '<path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/>',
      wash: '<path d="M4 7h16M7 7V4h10v3M6 7l1 13h10l1-13"/>',
      leaf: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19l8-8"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (p[name] || p.leaf) + "</svg>";
  }

  /* ================= Старт ================= */
  renderStatic();
  selectColor(0);
  setQty(1);
  if (location.hash === "#order") setTimeout(function () { $("order").scrollIntoView(); }, 50);
})();
