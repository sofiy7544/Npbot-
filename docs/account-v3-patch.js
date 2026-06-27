/* =====================================================================
   ACCOUNT v3 — Auth + Referral + Cashback + EmailJS integration
   =====================================================================
   Конфігурація EmailJS: відкрий /admin.html → "Контакти / Brand" →
   налаштуй emailjs_public_key, emailjs_service_id, emailjs_template_id.
   Без них функції email-сповіщення нічого не роблять (просто скіпають).
   ===================================================================== */
(function() {
  "use strict";

  // ==================== UTILS ====================
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  function getLang() {
    return (document.documentElement.lang || "uk").toLowerCase().slice(0, 2);
  }

  // ==================== EmailJS CONFIG ====================
  // Налаштовується через адмінку → localStorage["dua_email_config"]
  // Формат: { publicKey, serviceId, templateOrder, templateWelcome, templateReset, telegramChatId }
  function getEmailConfig() {
    try {
      return JSON.parse(localStorage.getItem("dua_email_config") || "null") || {};
    } catch (e) { return {}; }
  }
  function setEmailConfig(cfg) {
    try { localStorage.setItem("dua_email_config", JSON.stringify(cfg || {})); } catch (e) {}
  }
  window.DUA_EmailConfig = { get: getEmailConfig, set: setEmailConfig };

  function isEmailConfigured() {
    var c = getEmailConfig();
    return !!(c.publicKey && c.serviceId);
  }

  // Завантаження SDK EmailJS на льоту (тільки якщо налаштовано)
  var _emailjsLoading = null;
  function loadEmailJS() {
    if (window.emailjs) return Promise.resolve(window.emailjs);
    if (_emailjsLoading) return _emailjsLoading;
    var cfg = getEmailConfig();
    if (!cfg.publicKey) return Promise.reject(new Error("EmailJS not configured"));
    _emailjsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      s.onload = function () {
        try { window.emailjs.init({ publicKey: cfg.publicKey }); } catch (e) {}
        resolve(window.emailjs);
      };
      s.onerror = function () { reject(new Error("Failed to load EmailJS SDK")); };
      document.head.appendChild(s);
    });
    return _emailjsLoading;
  }

  // Універсальна відправка через EmailJS
  function sendEmail(templateKey, vars) {
    var cfg = getEmailConfig();
    var templateId = cfg[templateKey];
    if (!cfg.publicKey || !cfg.serviceId || !templateId) {
      console.warn("[EmailJS] Skipped " + templateKey + " — not configured");
      return Promise.resolve({ skipped: true });
    }
    return loadEmailJS().then(function (ejs) {
      return ejs.send(cfg.serviceId, templateId, vars);
    });
  }

  // Відправка повідомлення в Telegram Bot API (прямий fetch, без сервера)
  function sendTelegramMessage(text) {
    var cfg = getEmailConfig();
    if (!cfg.telegramBotToken || !cfg.telegramChatId) {
      return Promise.resolve({ skipped: true });
    }
    var url = "https://api.telegram.org/bot" + cfg.telegramBotToken + "/sendMessage";
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.telegramChatId,
        text: text,
        parse_mode: "Markdown"
      })
    }).then(function (r) { return r.json(); }).catch(function (e) {
      console.warn("Telegram failed:", e);
      return { error: e.message };
    });
  }
  window.DUA_Telegram = { send: sendTelegramMessage };

  // ==================== USER ACCOUNT — паролі (хеш PBKDF2) ====================
  // Зберігаємо хеші у localStorage. Це не банківський рівень безпеки, але це
  // ВЖЕ значно краще ніж plain-text. Реальний бекенд потрібен для production.
  async function hashPassword(password, salt) {
    var enc = new TextEncoder();
    var saltBytes = enc.encode(salt || "stanley_brand_ua_v1");
    var passBytes = enc.encode(password);
    var keyMaterial = await crypto.subtle.importKey(
      "raw", passBytes, "PBKDF2", false, ["deriveBits"]
    );
    var bits = await crypto.subtle.deriveBits({
      name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256"
    }, keyMaterial, 256);
    var arr = Array.from(new Uint8Array(bits));
    return arr.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem("dua_users") || "{}"); } catch (e) { return {}; }
  }
  function saveUsers(u) {
    try { localStorage.setItem("dua_users", JSON.stringify(u)); } catch (e) {}
  }

  // ==================== REFERRAL SYSTEM ====================
  // Логіка: 
  //  - Кожен зареєстрований користувач має код "REF-XXXXXX"
  //  - Хто переходить за реф-посиланням -> отримує 50% знижку на 2-ге замовлення
  //  - Хто запросив -> отримує кешбек-бонуси (50% від суми ПЕРШОГО замовлення друга)
  //  - Бонуси накопичуються і можуть бути використані при оплаті (1 бонус = 1 ₴)
  function generateRefCode(seed) {
    var s = (seed || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))).toUpperCase();
    return "REF-" + s.slice(-6);
  }

  // Перехоплюємо ?ref=XXXXX з URL і зберігаємо
  function captureRefFromUrl() {
    try {
      var url = new URL(window.location.href);
      var ref = url.searchParams.get("ref");
      if (ref && /^REF-[A-Z0-9]{4,10}$/i.test(ref)) {
        // Зберігаємо тільки якщо ще немає (одноразово на пристрій)
        if (!localStorage.getItem("dua_referred_by")) {
          localStorage.setItem("dua_referred_by", ref.toUpperCase());
          localStorage.setItem("dua_referred_at", String(Date.now()));
        }
        // Чистимо URL від параметра щоб не плутав
        url.searchParams.delete("ref");
        var clean = url.pathname + (url.search ? url.search : "") + (url.hash || "");
        history.replaceState({}, "", clean);
      }
    } catch (e) {}
  }

  function getUserRefCode(email) {
    var users = loadUsers();
    var u = email ? users[email.toLowerCase()] : null;
    if (u && u.refCode) return u.refCode;
    // Якщо немає user (guest) — генеруємо локальний код
    var local = localStorage.getItem("dua_ref_code_local");
    if (!local) {
      local = generateRefCode();
      localStorage.setItem("dua_ref_code_local", local);
    }
    return local;
  }

  function getReferralStats(email) {
    try {
      var stats = JSON.parse(localStorage.getItem("dua_referral_stats") || "{}");
      return stats[email ? email.toLowerCase() : "_local"] || { invitedCount: 0, cashbackBalance: 0, totalEarned: 0 };
    } catch (e) {
      return { invitedCount: 0, cashbackBalance: 0, totalEarned: 0 };
    }
  }
  function saveReferralStats(email, stats) {
    try {
      var all = JSON.parse(localStorage.getItem("dua_referral_stats") || "{}");
      all[email ? email.toLowerCase() : "_local"] = stats;
      localStorage.setItem("dua_referral_stats", JSON.stringify(all));
    } catch (e) {}
  }

  // Чи має поточний користувач право на 50% знижку (приведений + ще не використав)
  function hasWelcomeDiscount() {
    var referredBy = localStorage.getItem("dua_referred_by");
    if (!referredBy) return false;
    var used = localStorage.getItem("dua_welcome_discount_used");
    if (used === "1") return false;
    // Тільки якщо вже зробив 1 замовлення (бо знижка на 2-ге)
    var ordersCount = getOrdersCount();
    return ordersCount >= 1 && ordersCount < 2;
  }

  function getOrdersCount() {
    try {
      var orders = JSON.parse(localStorage.getItem("dua_orders") || "[]");
      return orders.length;
    } catch (e) { return 0; }
  }

  // ==================== ХУК: коли робиться замовлення ====================
  // Спостерігаємо за зміною dua_orders і нараховуємо кешбек реферера
  var lastOrdersCount = getOrdersCount();
  function onNewOrderDetected() {
    var newCount = getOrdersCount();
    if (newCount <= lastOrdersCount) return;
    lastOrdersCount = newCount;
    try {
      var orders = JSON.parse(localStorage.getItem("dua_orders") || "[]");
      var lastOrder = orders[orders.length - 1];
      if (!lastOrder) return;

      // Якщо це БУЛО ПЕРШЕ замовлення приведеного — нараховуємо кешбек реферу
      var referredBy = localStorage.getItem("dua_referred_by");
      if (referredBy && newCount === 1) {
        // Шукаємо реферера серед всіх користувачів
        var users = loadUsers();
        var refOwner = null;
        Object.keys(users).forEach(function (e) {
          if (users[e].refCode === referredBy) refOwner = e;
        });
        if (refOwner) {
          var stats = getReferralStats(refOwner);
          var cashback = Math.round((lastOrder.total || 0) * 0.5);
          stats.invitedCount = (stats.invitedCount || 0) + 1;
          stats.cashbackBalance = (stats.cashbackBalance || 0) + cashback;
          stats.totalEarned = (stats.totalEarned || 0) + cashback;
          saveReferralStats(refOwner, stats);

          // Лист рефереру (якщо email налаштовано)
          sendEmail("templateCashback", {
            to_email: refOwner,
            friend_email: (lastOrder.email || "—"),
            cashback_amount: cashback,
            balance: stats.cashbackBalance,
            invited_count: stats.invitedCount
          }).catch(function () {});
        }
      }

      // Сповіщення про замовлення (в Telegram через EmailJS templateOrder)
      sendEmail("templateOrder", {
        order_id: lastOrder.id || "",
        order_total: lastOrder.total || 0,
        customer_email: lastOrder.email || "",
        customer_phone: lastOrder.phone || "",
        customer_name: ((lastOrder.firstName || "") + " " + (lastOrder.lastName || "")).trim(),
        shipping_method: lastOrder.shipping || "",
        payment_method: lastOrder.payment || "",
        items_summary: ((lastOrder.items || []).map(function (i) {
          return (i.name || "") + " ×" + (i.qty || 1);
        }).join("\n")) || "",
        order_date: new Date().toLocaleString("uk-UA")
      }).catch(function () {});

      // === ТАКОЖ надсилаємо ПРЯМО в Telegram через Bot API ===
      var tgText =
        "🛍 *Нове замовлення " + (lastOrder.id || "") + "*\n\n" +
        "👤 *Клієнт:* " + ((lastOrder.firstName || "") + " " + (lastOrder.lastName || "")).trim() + "\n" +
        "📧 *Email:* " + (lastOrder.email || "—") + "\n" +
        "📱 *Телефон:* " + (lastOrder.phone || "—") + "\n\n" +
        "📦 *Товари:*\n" +
        ((lastOrder.items || []).map(function (i) {
          return "• " + (i.name || "") + " ×" + (i.qty || 1) + " · " + (i.price || 0) + " ₴";
        }).join("\n")) + "\n\n" +
        "🚚 *Доставка:* " + (lastOrder.shipping || "—") + "\n" +
        "💳 *Оплата:* " + (lastOrder.payment || "—") + "\n\n" +
        "💰 *Сума:* " + (lastOrder.total || 0) + " ₴\n" +
        "🕐 " + new Date().toLocaleString("uk-UA");
      sendTelegramMessage(tgText).catch(function () {});

      // Welcome email (якщо це 1-ше замовлення)
      if (newCount === 1 && lastOrder.email) {
        sendEmail("templateWelcome", {
          to_email: lastOrder.email,
          first_name: lastOrder.firstName || "",
          order_id: lastOrder.id || "",
          welcome_code: "WELCOME50",
          discount_percent: 50
        }).catch(function () {});
        // Запам'ятовуємо welcome discount для цього клієнта
        localStorage.setItem("dua_welcome_discount_available", "1");
      }

      // Якщо це 2-ге — позначаємо що welcome використано
      if (newCount === 2 && localStorage.getItem("dua_welcome_discount_available")) {
        localStorage.setItem("dua_welcome_discount_used", "1");
        localStorage.removeItem("dua_welcome_discount_available");
      }
    } catch (e) {
      console.warn("Order hook failed:", e);
    }
  }
  // Слухаємо storage events і періодично перевіряємо
  setInterval(onNewOrderDetected, 1500);

  // ==================== TERMS CHECKBOX FIX ====================
  function rebindTerms() {
    var t = $("#termsCh");
    if (!t || t.dataset.fixed) return;

    // Клонуємо вузол щоб видалити ВСІ старі addEventListener (з основного коду)
    var clone = t.cloneNode(true);
    t.parentNode.replaceChild(clone, t);
    t = clone;
    t.dataset.fixed = "1";

    function toggle() {
      var isChecked = t.classList.contains("checked");
      t.classList.toggle("checked", !isChecked);
      t.setAttribute("aria-checked", String(!isChecked));
      var box = t.querySelector("#termsBox, input[type='checkbox']");
      if (box) box.checked = !isChecked;
      window._termsOkOverride = !isChecked;
    }

    t.addEventListener("click", function (e) {
      if (e.target.tagName === "A") return;
      e.preventDefault();
      toggle();
    });
    t.setAttribute("role", "checkbox");
    t.setAttribute("aria-checked", "false");
    t.setAttribute("tabindex", "0");
    t.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    });
  }

  // Перехоплення placeOrder — повна заміна логіки isTermsOk
  function patchPlaceOrderValidator() {
    var po = $("#placeOrder");
    if (!po || po.dataset.poFixed) return;
    // Клонуємо щоб видалити оригінальний listener
    var clone = po.cloneNode(true);
    po.parentNode.replaceChild(clone, po);
    po = clone;
    po.dataset.poFixed = "1";

    po.addEventListener("click", function (e) {
      e.preventDefault();
      // 1. Перевірка чекбокса через наш patched стан
      var t = $("#termsCh");
      var termsOk = t && t.classList.contains("checked");
      if (!termsOk) {
        if (t) {
          t.classList.add("shake");
          setTimeout(function () { t.classList.remove("shake"); }, 500);
        }
        if (window.toast) window.toast("Будь ласка, прийміть умови магазину", "error");
        if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      // 2. Викликаємо оригінальний placeOrder напряму
      var f = window._co || {};
      var recalcFn = function () {}; // recalc недоступний, але це не критично після успіху
      if (typeof window.placeOrder === "function") {
        window.placeOrder(f, recalcFn, function () { return true; });
      }
    });
  }

  // ==================== COD PREPAY UI ====================
  function injectCodPrepayUI() {
    var codChoice = $("[data-payment='cod']");
    if (!codChoice || codChoice.dataset.prepayInjected) return;
    codChoice.dataset.prepayInjected = "1";

    // Створюємо notice + sub-method picker після всього блоку payment
    var paymentBlock = codChoice.closest(".cs");
    if (!paymentBlock) return;

    var L = getLang();
    var labels = {
      uk: {
        title: "Передоплата 200 ₴",
        sub: "Для накладеного платежу — попередня оплата 200 ₴ через обраний спосіб. Залишок — при отриманні.",
        choose: "Спосіб передоплати:",
        p24: "Privat24",
        mono: "Mono",
        liq: "LiqPay (картка)"
      },
      pl: {
        title: "Przedpłata 200 ₴",
        sub: "Dla płatności przy odbiorze — przedpłata 200 ₴ wybranym sposobem. Reszta — przy odbiorze.",
        choose: "Sposób przedpłaty:",
        p24: "Privat24",
        mono: "Mono",
        liq: "LiqPay (karta)"
      },
      en: {
        title: "Prepayment 200 ₴",
        sub: "Cash on delivery requires a 200 ₴ prepayment via selected method. Rest — on delivery.",
        choose: "Prepayment method:",
        p24: "Privat24",
        mono: "Mono",
        liq: "LiqPay (card)"
      }
    };
    var l = labels[L] || labels.uk;

    var notice = document.createElement("div");
    notice.id = "codPrepayNotice";
    notice.className = "cod-prepay-notice";
    notice.innerHTML =
      '<strong>💳 ' + l.title + '</strong>' +
      '<div class="cod-prepay-notice__sub">' + l.sub + '</div>' +
      '<div style="margin-top:10px;font-weight:600;font-size:12px;">' + l.choose + '</div>' +
      '<div class="cod-prepay-methods is-show" id="codPrepayMethods">' +
        '<div class="cod-prepay-method is-active" data-cod-method="p24">' +
          '<span class="cod-prepay-method__logo cod-prepay-method__logo--p24">P24</span>' +
          '<span>' + l.p24 + '</span>' +
        '</div>' +
        '<div class="cod-prepay-method" data-cod-method="mono">' +
          '<span class="cod-prepay-method__logo cod-prepay-method__logo--mono">M</span>' +
          '<span>' + l.mono + '</span>' +
        '</div>' +
        '<div class="cod-prepay-method" data-cod-method="liq">' +
          '<span class="cod-prepay-method__logo cod-prepay-method__logo--liq">L</span>' +
          '<span>' + l.liq + '</span>' +
        '</div>' +
      '</div>';
    // Знаходимо контейнер payment choices
    var lastChoice = paymentBlock.querySelector("[data-payment='cod']");
    lastChoice.parentNode.insertBefore(notice, lastChoice.nextSibling);

    // Bind вибір передоплати
    $$("[data-cod-method]").forEach(function (m) {
      on(m, "click", function () {
        $$("[data-cod-method]").forEach(function (x) { x.classList.toggle("is-active", x === m); });
        try { localStorage.setItem("dua_cod_prepay_method", m.dataset.codMethod); } catch (e) {}
      });
    });

    // Показ/приховування на основі вибору payment
    function updateState() {
      var codSelected = $("[data-payment='cod']").classList.contains("checked");
      notice.classList.toggle("is-show", codSelected);
      // Сховуємо Apple/Google коли вибрана накладка
      $$("[data-payment='applepay'], [data-payment='googlepay']").forEach(function (el) {
        if (codSelected) el.setAttribute("data-payment-hidden", "1");
        else el.removeAttribute("data-payment-hidden");
      });
      // Оновлюємо order summary через існуючий механізм
      addPrepayLineToSummary(codSelected);
    }

    // Слухаємо клік на payment choices (mutation observer бо клас змінюється JS-ом)
    var mo = new MutationObserver(function () { updateState(); });
    $$("[data-payment]").forEach(function (el) {
      mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    });
    updateState();
  }

  function addPrepayLineToSummary(show) {
    var existing = $("#osPrepay");
    var os = $(".order-summary");
    if (!os) return;
    if (show && !existing) {
      // Знаходимо рядок з shipping
      var rows = os.querySelectorAll(".summary-line");
      var lastRow = rows[rows.length - 1];
      var newRow = document.createElement("div");
      newRow.id = "osPrepay";
      newRow.className = "summary-line summary-line--prepay";
      var L = getLang();
      var label = { uk: "Передоплата НП", pl: "Przedpłata", en: "Prepayment" }[L] || "Передоплата НП";
      newRow.innerHTML = '<span>' + label + '</span><strong class="tabular">200 ₴</strong>';
      if (lastRow && lastRow.parentNode) {
        lastRow.parentNode.insertBefore(newRow, lastRow.nextSibling);
      }
    } else if (!show && existing) {
      existing.remove();
    }
    // Оновлюємо total та кнопку
    updateTotalWithPrepay(show);
  }

  function updateTotalWithPrepay(show) {
    var osTotal = $("#osTotal");
    var po = $("#placeOrder");
    if (!osTotal || !po) return;
    // Беремо поточне total (це сума що рендерить recalc())
    var totalText = osTotal.textContent.replace(/[^\d]/g, "");
    var currentTotal = parseInt(totalText, 10) || 0;
    // Видаляємо попередню добавку (зберігаємо її в data-attr)
    var added = parseInt(osTotal.dataset.prepayAdded || "0", 10);
    var baseTotal = currentTotal - added;
    var newAdded = show ? 200 : 0;
    var newTotal = baseTotal + newAdded;
    // Записуємо назад
    osTotal.textContent = new Intl.NumberFormat("uk-UA").format(newTotal) + " ₴";
    osTotal.dataset.prepayAdded = String(newAdded);
    // Кнопка
    var btnTxt = po.textContent.replace(/[\d\s]+₴$/, "");
    po.textContent = btnTxt.replace(/[·]\s*$/, "").trim() + " · " + new Intl.NumberFormat("uk-UA").format(newTotal) + " ₴";
  }

  // ==================== AUTOCOMPLETE на checkout ====================
  function enhanceCheckoutAutocomplete() {
    var map = {
      "email": "email",
      "phone": "tel",
      "firstName": "given-name",
      "lastName": "family-name",
      "first_name": "given-name",
      "last_name": "family-name",
      "city": "address-level2",
      "street": "address-line1",
      "address": "street-address",
      "zip": "postal-code",
      "postal": "postal-code",
      "cardNumber": "cc-number",
      "cardExpiry": "cc-exp",
      "cardCvv": "cc-csc",
      "cardName": "cc-name"
    };
    $$("input[id^='f-'], input[name]").forEach(function (inp) {
      var key = (inp.id || "").replace(/^f-/, "") || inp.name;
      if (!key) return;
      if (!inp.autocomplete || inp.autocomplete === "off") {
        var ac = map[key] || map[key.toLowerCase()];
        if (ac) inp.autocomplete = ac;
      }
      // Telefon — UA-prefix hint якщо пусто
      if (key === "phone" || key.toLowerCase() === "phone") {
        if (!inp.value && !inp.placeholder) inp.placeholder = "+380 67 123 45 67";
        if (!inp.type || inp.type === "text") inp.type = "tel";
      }
      // Email auto-lowercase
      if (key === "email" || inp.type === "email") {
        inp.addEventListener("blur", function () {
          inp.value = inp.value.trim().toLowerCase();
        });
      }
    });
    // Name="organization" form attribute щоб iOS правильно бачив форму
    var form = $("#main form") || $(".checkout form");
    if (form && !form.dataset.acEnhanced) {
      form.dataset.acEnhanced = "1";
      form.setAttribute("autocomplete", "on");
    }
  }

  // ==================== ENHANCE ACCOUNT PAGE ====================
  function enhanceAccount() {
    if ((window.location.hash || "").indexOf("account") < 0) return;
    var pane = $(".acc-pane");
    if (!pane || pane.dataset.referralAdded) return;
    pane.dataset.referralAdded = "1";

    var u = (window.User && window.User.data) || null;
    var email = (u && u.email) ? u.email : null;
    var refCode = getUserRefCode(email);
    var stats = getReferralStats(email);
    var L = getLang();

    var refUrl = location.origin + location.pathname + "?ref=" + refCode;

    var labels = {
      uk: {
        badge: "Реферальна програма",
        title: "Запрошуй друзів — отримуй кешбек",
        sub: "Друг отримує 50% знижку на 2-ге замовлення. Ти — 50% кешбек від його першого замовлення на свій баланс.",
        rule1: "Друг переходить за посиланням",
        rule2: "Робить першу покупку",
        rule3: "Ти отримуєш кешбек 50%",
        copyBtn: "Скопіювати",
        copiedBtn: "✓ Скопійовано",
        invited: "Запрошено",
        balance: "Кешбек-баланс",
        welcomeTitle: "Тебе запросив друг!",
        welcomeSub: "Знижка 50% на 2-ге замовлення активується автоматично після першого",
        codeLabel: "Промокод"
      },
      pl: {
        badge: "Program polecający",
        title: "Zapraszaj znajomych — zdobywaj cashback",
        sub: "Znajomy dostaje 50% zniżki na 2. zamówienie. Ty — 50% cashback z jego pierwszego zamówienia.",
        rule1: "Znajomy przechodzi przez link",
        rule2: "Robi pierwszy zakup",
        rule3: "Otrzymujesz cashback 50%",
        copyBtn: "Kopiuj",
        copiedBtn: "✓ Skopiowano",
        invited: "Zaproszono",
        balance: "Saldo cashback",
        welcomeTitle: "Zaprosił Cię znajomy!",
        welcomeSub: "Zniżka 50% na 2. zamówienie aktywuje się automatycznie",
        codeLabel: "Kod"
      },
      en: {
        badge: "Referral program",
        title: "Invite friends — earn cashback",
        sub: "Your friend gets 50% off their 2nd order. You earn 50% cashback from their first order.",
        rule1: "Friend uses your link",
        rule2: "Makes first purchase",
        rule3: "You get 50% cashback",
        copyBtn: "Copy",
        copiedBtn: "✓ Copied",
        invited: "Invited",
        balance: "Cashback balance",
        welcomeTitle: "You were invited by a friend!",
        welcomeSub: "50% off your 2nd order activates automatically",
        codeLabel: "Code"
      }
    };
    var lbl = labels[L] || labels.uk;

    var welcomeHTML = "";
    if (hasWelcomeDiscount() || localStorage.getItem("dua_referred_by")) {
      welcomeHTML =
        '<div class="welcome-discount">' +
          '<div class="welcome-discount__icon">🎁</div>' +
          '<div class="welcome-discount__body">' +
            '<p class="welcome-discount__title">' + lbl.welcomeTitle + '</p>' +
            '<p class="welcome-discount__sub">' + lbl.welcomeSub + '</p>' +
          '</div>' +
          '<div class="welcome-discount__code" title="' + lbl.codeLabel + '">WELCOME50</div>' +
        '</div>';
    }

    var checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 5 5L20 7"/></svg>';

    var html =
      welcomeHTML +
      '<div class="acc-referral">' +
        '<div class="acc-referral__head">' +
          '<span class="acc-referral__badge">' + lbl.badge + '</span>' +
        '</div>' +
        '<h3 class="acc-referral__title">' + lbl.title + '</h3>' +
        '<p class="acc-referral__sub">' + lbl.sub + '</p>' +
        '<div class="acc-referral__rules">' +
          '<span class="acc-referral__rule">' + checkIcon + lbl.rule1 + '</span>' +
          '<span class="acc-referral__rule">' + checkIcon + lbl.rule2 + '</span>' +
          '<span class="acc-referral__rule">' + checkIcon + lbl.rule3 + '</span>' +
        '</div>' +
        '<div class="acc-referral__link-row">' +
          '<input type="text" class="acc-referral__input" id="refLinkInput" readonly value="' + refUrl + '"/>' +
          '<button type="button" class="acc-referral__btn" id="refCopyBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '<span>' + lbl.copyBtn + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="acc-referral__stats">' +
          '<div class="acc-referral__stat">' +
            '<div class="acc-referral__stat-label">' + lbl.invited + '</div>' +
            '<div class="acc-referral__stat-value">' + (stats.invitedCount || 0) + '</div>' +
          '</div>' +
          '<div class="acc-referral__stat">' +
            '<div class="acc-referral__stat-label">' + lbl.balance + '</div>' +
            '<div class="acc-referral__stat-value">' + (stats.cashbackBalance || 0) + ' ₴</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    pane.insertAdjacentHTML("beforeend", html);

    // Кнопка переходу до адмінки (для власника магазину)
    // Показується тільки якщо в localStorage є флаг адмін-сесії
    var sideBar = $(".acc-side");
    if (sideBar && !sideBar.dataset.adminLinkAdded) {
      sideBar.dataset.adminLinkAdded = "1";
      var adminBtn = document.createElement("a");
      adminBtn.href = "admin.html";
      adminBtn.target = "_blank";
      adminBtn.className = "acc-tab";
      adminBtn.style.cssText = "background: linear-gradient(135deg, var(--accent), var(--text)); color: var(--bg); margin-top: 8px;";
      adminBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 1l3 6 6 .9-4.5 4.4 1 6.7L12 16l-5.5 3 1-6.7L3 7.9 9 7z"/></svg>' +
        '<span>Адмінка магазину</span>';
      sideBar.appendChild(adminBtn);
    }

    // Bind copy
    var copyBtn = $("#refCopyBtn");
    var input = $("#refLinkInput");
    if (copyBtn && input) {
      on(copyBtn, "click", function () {
        input.select();
        input.setSelectionRange(0, 99999);
        try {
          var copied = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(input.value).then(function () {
              copied = true;
              showCopied();
            }).catch(function () {
              document.execCommand("copy");
              showCopied();
            });
          } else {
            document.execCommand("copy");
            showCopied();
          }
        } catch (e) { showCopied(); }
        if (navigator.vibrate) navigator.vibrate(15);
      });
      function showCopied() {
        copyBtn.classList.add("is-copied");
        copyBtn.querySelector("span").textContent = lbl.copiedBtn;
        setTimeout(function () {
          copyBtn.classList.remove("is-copied");
          copyBtn.querySelector("span").textContent = lbl.copyBtn;
        }, 2000);
      }
    }
  }

  // ==================== REGISTER/LOGIN — auth з паролем ====================
  function enhanceRegister() {
    var form = $("#regForm");
    if (!form || form.dataset.authBound) return;
    form.dataset.authBound = "1";

    // Strength meter
    var pwd = form.querySelector("#password");
    if (pwd) {
      var meter = document.createElement("div");
      meter.className = "pwd-strength";
      meter.innerHTML = '<div class="pwd-strength__bar"></div>';
      var hint = document.createElement("div");
      hint.className = "pwd-strength__hint";
      hint.textContent = getLang() === "uk" ? "Мінімум 8 символів, бажано букви + цифри" :
        (getLang() === "pl" ? "Min. 8 znaków, litery + cyfry" : "Min. 8 chars, letters + numbers");
      pwd.parentNode.appendChild(meter);
      pwd.parentNode.appendChild(hint);
      pwd.addEventListener("input", function () {
        var v = pwd.value;
        var bar = meter.querySelector(".pwd-strength__bar");
        bar.className = "pwd-strength__bar";
        var s = 0;
        if (v.length >= 8) s++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
        if (/\d/.test(v)) s++;
        if (/[^A-Za-z0-9]/.test(v)) s++;
        if (s >= 4) bar.classList.add("is-strong");
        else if (s >= 2) bar.classList.add("is-medium");
        else if (s >= 1) bar.classList.add("is-weak");
      });
    }

    // Msg block
    var msg = document.createElement("div");
    msg.className = "auth-msg";
    form.appendChild(msg);

    // Submit handler
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      msg.className = "auth-msg";
      msg.textContent = "";

      var firstName = form.querySelector("#firstName").value.trim();
      var lastName = form.querySelector("#lastName").value.trim();
      var email = form.querySelector("#email").value.trim().toLowerCase();
      var password = form.querySelector("#password").value;

      if (!firstName || !email || password.length < 8) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = getLang() === "uk" ? "Перевір поля. Пароль — мінімум 8 символів." : "Check fields. Password ≥ 8 chars.";
        return;
      }

      var users = loadUsers();
      if (users[email]) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = getLang() === "uk" ? "Користувач з цим email вже існує. Спробуй увійти." : "User already exists. Try login.";
        return;
      }

      try {
        var hash = await hashPassword(password, email);
        var refCode = generateRefCode(email);
        users[email] = {
          firstName: firstName,
          lastName: lastName,
          email: email,
          passwordHash: hash,
          refCode: refCode,
          createdAt: Date.now(),
          referredBy: localStorage.getItem("dua_referred_by") || null
        };
        saveUsers(users);

        // Залогінитись одразу
        if (window.User && typeof window.User.set === "function") {
          window.User.set({ firstName: firstName, lastName: lastName, email: email, refCode: refCode });
        } else {
          localStorage.setItem("dua_user", JSON.stringify({ firstName: firstName, lastName: lastName, email: email, refCode: refCode }));
        }

        // Welcome email
        sendEmail("templateWelcome", {
          to_email: email,
          first_name: firstName,
          ref_code: refCode,
          ref_link: location.origin + location.pathname + "?ref=" + refCode
        }).catch(function () {});

        msg.className = "auth-msg is-show auth-msg--success";
        msg.textContent = getLang() === "uk" ? "Готово! Перенаправлення..." : "Done! Redirecting...";
        setTimeout(function () { location.hash = "#account"; }, 600);
      } catch (err) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = "Error: " + err.message;
      }
    });
  }

  function enhanceLogin() {
    var form = $("#loginForm");
    if (!form || form.dataset.authBound) return;
    form.dataset.authBound = "1";

    var msg = document.createElement("div");
    msg.className = "auth-msg";
    form.appendChild(msg);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      msg.className = "auth-msg";

      var email = form.querySelector("#email").value.trim().toLowerCase();
      var password = form.querySelector("#password").value;

      var users = loadUsers();
      var u = users[email];
      if (!u) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = getLang() === "uk" ? "Такого email немає. Зареєструйся." : "Email not found. Register first.";
        return;
      }

      try {
        var hash = await hashPassword(password, email);
        if (hash !== u.passwordHash) {
          msg.className = "auth-msg is-show auth-msg--error";
          msg.textContent = getLang() === "uk" ? "Невірний пароль." : "Wrong password.";
          return;
        }

        if (window.User && typeof window.User.set === "function") {
          window.User.set({ firstName: u.firstName, lastName: u.lastName, email: u.email, refCode: u.refCode });
        } else {
          localStorage.setItem("dua_user", JSON.stringify({ firstName: u.firstName, lastName: u.lastName, email: u.email, refCode: u.refCode }));
        }

        msg.className = "auth-msg is-show auth-msg--success";
        msg.textContent = getLang() === "uk" ? "Вхід виконано. Перенаправлення..." : "Logged in. Redirecting...";
        setTimeout(function () { location.hash = "#account"; }, 500);
      } catch (err) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = "Error: " + err.message;
      }
    });
  }

  // ==================== FORGOT PASSWORD ====================
  function enhanceForgot() {
    // Сторінка вже існує як /docs/forgot — додаємо до неї форму
    var hash = (location.hash || "");
    if (hash.indexOf("forgot") < 0) return;
    var doc = $(".doc .container");
    if (!doc || doc.dataset.forgotBound) return;
    doc.dataset.forgotBound = "1";

    var L = getLang();
    var labels = {
      uk: {
        title: "Скидання паролю",
        sub: "Введи email, на який зареєстрований акаунт. Ми надішлемо тимчасовий пароль.",
        emailLabel: "Email",
        btn: "Надіслати тимчасовий пароль",
        sent: "Якщо такий email існує — лист надіслано. Перевір пошту (та папку Спам).",
        notFound: "Email не знайдено в нашій системі.",
        notConfigured: "Email-сервіс ще не налаштовано. Напиши нам напряму на " + ((window.BRAND && window.BRAND.email) || "support@example.com") + "."
      },
      pl: {
        title: "Reset hasła", sub: "Wpisz email z rejestracji. Wyślemy tymczasowe hasło.",
        emailLabel: "Email", btn: "Wyślij tymczasowe hasło",
        sent: "Jeśli email istnieje — list wysłany.",
        notFound: "Nie znaleziono.",
        notConfigured: "Email niegotowy. Pisz do nas bezpośrednio."
      },
      en: {
        title: "Reset password", sub: "Enter your registered email. We'll send a temp password.",
        emailLabel: "Email", btn: "Send temp password",
        sent: "If email exists — letter sent. Check inbox (and Spam).",
        notFound: "Email not found.",
        notConfigured: "Email service not yet configured. Contact us directly."
      }
    };
    var lbl = labels[L] || labels.uk;

    doc.innerHTML =
      '<h1>' + lbl.title + '</h1>' +
      '<p class="lead">' + lbl.sub + '</p>' +
      '<form id="forgotForm" style="max-width:420px;margin:24px auto;">' +
        '<div class="field">' +
          '<label class="field-label">' + lbl.emailLabel + '</label>' +
          '<input type="email" id="forgotEmail" class="input" required autocomplete="email"/>' +
        '</div>' +
        '<button type="submit" class="btn btn-primary btn-lg btn-block" style="margin-top:16px;">' + lbl.btn + '</button>' +
        '<div class="auth-msg" id="forgotMsg"></div>' +
      '</form>';

    var form = $("#forgotForm");
    var msg = $("#forgotMsg");
    on(form, "submit", async function (e) {
      e.preventDefault();
      var email = $("#forgotEmail").value.trim().toLowerCase();
      var users = loadUsers();
      var u = users[email];
      if (!u) {
        // ВАЖЛИВО з безпекової точки зору — не розкриваємо існує юзер чи ні
        msg.className = "auth-msg is-show auth-msg--info";
        msg.textContent = lbl.sent;
        return;
      }
      // Генеруємо тимчасовий пароль
      var tempPwd = Math.random().toString(36).slice(2, 10) + "X";
      try {
        var hash = await hashPassword(tempPwd, email);
        u.passwordHash = hash;
        u.tempPasswordIssued = Date.now();
        saveUsers(users);

        if (isEmailConfigured()) {
          await sendEmail("templateReset", {
            to_email: email,
            first_name: u.firstName || "",
            temp_password: tempPwd
          });
          msg.className = "auth-msg is-show auth-msg--success";
          msg.textContent = lbl.sent;
        } else {
          msg.className = "auth-msg is-show auth-msg--info";
          msg.innerHTML = lbl.notConfigured;
        }
      } catch (err) {
        msg.className = "auth-msg is-show auth-msg--error";
        msg.textContent = err.message;
      }
    });
  }

  // ==================== INIT ====================
  function reInit() {
    rebindTerms();
    patchPlaceOrderValidator();
    injectCodPrepayUI();
    enhanceCheckoutAutocomplete();
    enhanceAccount();
    enhanceRegister();
    enhanceLogin();
    enhanceForgot();
  }

  function init() {
    captureRefFromUrl();
    reInit();
    // Закриваємо cart drawer при будь-якій зміні маршруту
    window.addEventListener("hashchange", function () {
      var cd = $("#cart-drawer");
      if (cd && cd.classList.contains("open")) {
        cd.classList.remove("open");
        cd.setAttribute("aria-hidden", "true");
        document.body.classList.remove("cart-open", "scroll-lock");
        document.body.style.overflow = "";
      }
      // Багатократно намагаємось reInit після зміни сторінки
      setTimeout(reInit, 100);
      setTimeout(reInit, 500);
      setTimeout(reInit, 1500);
    });
    // Спостерігаємо за main з debounce
    var main = $("#main");
    if (main) {
      var rebindT = null;
      var mo = new MutationObserver(function () {
        clearTimeout(rebindT);
        rebindT = setTimeout(reInit, 80);
      });
      mo.observe(main, { childList: true, subtree: true });
    }
    // Періодичний guard на випадок гонок
    setInterval(reInit, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Public API (для адмінки)
  window.DUA_Auth = {
    loadUsers: loadUsers,
    saveUsers: saveUsers,
    hashPassword: hashPassword,
    getReferralStats: getReferralStats,
    sendEmail: sendEmail,
    isEmailConfigured: isEmailConfigured
  };
})();
