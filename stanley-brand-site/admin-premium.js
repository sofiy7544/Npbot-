/* =====================================================================
   ADMIN PREMIUM PATCH · JS · v1
   - Inserts inline charts on the dashboard (revenue & orders trend)
   - Adds order status pills with proper colors
   - Refines stat cards with icons + trend indicators
   - Adds a dark-mode toggle in the topbar
   - Loading skeletons while orders fetch
   ===================================================================== */

(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ================================================================
     1. INJECT THEME TOGGLE in topbar (after login screen disappears)
     ================================================================ */
  function injectThemeToggle() {
    if ($("#admin-theme-toggle")) return;
    const actions = $(".topbar__actions");
    if (!actions) return;
    const btn = document.createElement("button");
    btn.id = "admin-theme-toggle";
    btn.className = "icon-btn";
    btn.setAttribute("aria-label", "Toggle theme");
    btn.title = "Theme";
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" data-icon="sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" data-icon="moon" style="display:none"><path d="M20 14.5a8 8 0 0 1-10.5-10.5A8 8 0 1 0 20 14.5z"/></svg>
    `;
    actions.prepend(btn);
    btn.addEventListener("click", () => {
      const isDark = document.body.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.body.removeAttribute("data-theme");
        localStorage.setItem("admin_theme", "light");
        btn.querySelector("[data-icon='sun']").style.display = "";
        btn.querySelector("[data-icon='moon']").style.display = "none";
      } else {
        document.body.setAttribute("data-theme", "dark");
        document.body.classList.add("dark-mode-on");
        localStorage.setItem("admin_theme", "dark");
        btn.querySelector("[data-icon='sun']").style.display = "none";
        btn.querySelector("[data-icon='moon']").style.display = "";
      }
    });
    /* Restore */
    if (localStorage.getItem("admin_theme") === "dark") {
      document.body.setAttribute("data-theme", "dark");
      document.body.classList.add("dark-mode-on");
      btn.querySelector("[data-icon='sun']").style.display = "none";
      btn.querySelector("[data-icon='moon']").style.display = "";
    }
  }

  /* ================================================================
     2. ENHANCE STAT CARDS — add icons + better visuals
     ================================================================ */
  const STAT_ICONS = {
    revenue: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    orders:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
    products:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 9 4.5v11L12 22 3 17.5v-11zM12 2v20M21 6.5l-9 4.5-9-4.5"/></svg>',
    aov:     '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8 8 16M9 9h.01M15 15h.01"/></svg>',
    visitors:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M22 11l-3 3-3-3M19 14V4"/></svg>',
  };

  function enhanceStats() {
    $$(".stat").forEach(s => {
      if (s.querySelector(".stat__icon")) return;
      const label = (s.querySelector(".stat__label") && s.querySelector(".stat__label").textContent || "").toLowerCase();
      let icon = STAT_ICONS.revenue;
      if (label.includes("orde") || label.includes("замов")) icon = STAT_ICONS.orders;
      else if (label.includes("prod") || label.includes("товар")) icon = STAT_ICONS.products;
      else if (label.includes("aov") || label.includes("серед")) icon = STAT_ICONS.aov;
      else if (label.includes("vis") || label.includes("візит") || label.includes("відвід")) icon = STAT_ICONS.visitors;
      const span = document.createElement("span");
      span.className = "stat__icon";
      span.innerHTML = icon;
      s.appendChild(span);
    });
  }

  /* ================================================================
     3. RENDER REVENUE CHART
     ================================================================ */
  function renderChart() {
    /* Look for a placeholder card on the dashboard */
    const dashHost = $("#dash-charts-host") || (() => {
      const content = $(".content");
      if (!content) return null;
      const stats = $(".stats");
      if (!stats) return null;
      const grid = document.createElement("div");
      grid.id = "dash-charts-host";
      grid.style.cssText = "display:grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px;";
      stats.insertAdjacentElement("afterend", grid);
      return grid;
    })();
    if (!dashHost) return;
    if (dashHost.dataset.rendered) return;
    dashHost.dataset.rendered = "1";

    /* Build last-30-days data from dua_orders */
    let orders = [];
    try { orders = JSON.parse(localStorage.getItem("dua_orders") || "[]"); } catch (e) {}
    const days = 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      buckets.push({ date: d, revenue: 0, count: 0 });
    }
    orders.forEach(o => {
      if (!o || !o.createdAt) return;
      const d = new Date(o.createdAt);
      d.setHours(0, 0, 0, 0);
      const diff = Math.round((today - d) / 86400000);
      if (diff >= 0 && diff < days) {
        const b = buckets[days - 1 - diff];
        b.revenue += Number(o.total || 0);
        b.count += 1;
      }
    });

    const max = Math.max(1, ...buckets.map(b => b.revenue));
    const minR = 0;
    const w = 600, h = 200;
    const padL = 36, padR = 12, padT = 16, padB = 28;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const x = (i) => padL + (i / (days - 1)) * innerW;
    const y = (v) => padT + innerH - (v / max) * innerH;

    const linePath = buckets.map((b, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(b.revenue).toFixed(1)).join(" ");
    const areaPath = linePath + " L" + x(days - 1).toFixed(1) + "," + (padT + innerH).toFixed(1) + " L" + x(0).toFixed(1) + "," + (padT + innerH).toFixed(1) + " Z";

    const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const yy = (padT + innerH - t * innerH).toFixed(1);
      return `<line x1="${padL}" y1="${yy}" x2="${w - padR}" y2="${yy}" />`;
    }).join("");
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const yy = (padT + innerH - t * innerH + 4).toFixed(1);
      const v = Math.round(max * t);
      return `<text x="${padL - 8}" y="${yy}" text-anchor="end">${formatMoneyShort(v)}</text>`;
    }).join("");
    const xLabels = buckets.filter((_, i) => i % 5 === 0).map((b, i) => {
      const real = i * 5;
      const xx = x(real).toFixed(1);
      return `<text x="${xx}" y="${h - 8}" text-anchor="middle">${b.date.getDate()}.${(b.date.getMonth() + 1).toString().padStart(2,'0')}</text>`;
    }).join("");

    /* Total revenue + comparison */
    const total = buckets.reduce((a, b) => a + b.revenue, 0);
    const totalOrders = buckets.reduce((a, b) => a + b.count, 0);
    const half = Math.floor(buckets.length / 2);
    const first = buckets.slice(0, half).reduce((a, b) => a + b.revenue, 0);
    const second = buckets.slice(half).reduce((a, b) => a + b.revenue, 0);
    const trend = first > 0 ? ((second - first) / first) * 100 : 0;
    const trendUp = trend >= 0;

    dashHost.innerHTML = `
      <div class="chart-card">
        <div class="chart-card__head">
          <div>
            <div class="chart-card__title">Виторг · останні 30 днів</div>
            <div class="chart-card__sub">${formatMoney(total)} · ${totalOrders} замовлень</div>
          </div>
          <div class="chart-card__legend">
            <span class="status-pill ${trendUp ? 'status-paid' : 'status-cancelled'}" style="height:24px;font-size:12px;">
              ${trendUp ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}%
            </span>
          </div>
        </div>
        <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Revenue chart">
          <defs>
            <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1C3A2E" stop-opacity="0.18"/>
              <stop offset="100%" stop-color="#1C3A2E" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <g class="grid">${grid}</g>
          <path class="area-path" d="${areaPath}"/>
          <path class="line-path" d="${linePath}" stroke="#1C3A2E"/>
          <g class="axis">${yLabels}${xLabels}</g>
        </svg>
      </div>
      <div class="chart-card">
        <div class="chart-card__head">
          <div>
            <div class="chart-card__title">Топ кольори (за замовленнями)</div>
            <div class="chart-card__sub">останні 30 днів</div>
          </div>
        </div>
        <div id="top-colors-list" style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
    `;
    renderTopColors(orders);
  }

  function renderTopColors(orders) {
    const list = $("#top-colors-list");
    if (!list) return;
    const COLORS = window.COLORS_DATA || {};
    const counts = {};
    (orders || []).forEach(o => {
      (o.items || []).forEach(it => {
        if (it.color) counts[it.color] = (counts[it.color] || 0) + Number(it.qty || 1);
      });
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!sorted.length) {
      list.innerHTML = `<div class="empty" style="padding:24px;border:none;background:transparent;"><div class="empty__sub" style="margin:0;">Поки що немає даних. Перше замовлення зʼявиться тут.</div></div>`;
      return;
    }
    const max = sorted[0][1];
    list.innerHTML = sorted.map(([k, v]) => {
      const name = (window.colorName && window.colorName(k)) || k;
      const hex = (COLORS[k] && COLORS[k].hex) || "#ccc";
      const pct = (v / max) * 100;
      return `
        <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${hex};box-shadow:inset 0 0 0 1px rgba(0,0,0,0.06);flex-shrink:0;"></span>
          <span style="min-width:90px;color:var(--ink);">${name}</span>
          <span style="flex:1;background:var(--surface-2);height:8px;border-radius:999px;overflow:hidden;">
            <span style="display:block;height:100%;width:${pct}%;background:var(--pine);"></span>
          </span>
          <span style="font-variant-numeric:tabular-nums;color:var(--ink-muted);font-size:12px;">${v}</span>
        </div>
      `;
    }).join("");
  }

  function formatMoney(n) {
    return new Intl.NumberFormat("uk-UA").format(Math.round(n)) + " ₴";
  }
  function formatMoneyShort(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return n;
  }

  /* ================================================================
     4. ENHANCE ORDER ROWS — add status pills, payment kind
     ================================================================ */
  const STATUS_LABELS = {
    pending:   "Очікує",
    paid:      "Оплачено",
    shipped:   "Відправлено",
    delivered: "Доставлено",
    cancelled: "Скасовано",
    refunded:  "Повернення",
  };
  function renderStatusPill(status) {
    const cls = "status-" + status;
    const label = STATUS_LABELS[status] || status;
    return `<span class="status-pill ${cls}">${label}</span>`;
  }
  window.adminRenderStatusPill = renderStatusPill;

  /* ================================================================
     5. RUN — observe DOM for the admin shell, fire enhancements
     ================================================================ */
  function tick() {
    if (!document.querySelector(".shell")) return;
    injectThemeToggle();
    enhanceStats();
    /* Render chart only when on dashboard route. The admin uses #/orders, #/products etc. */
    const onDashboard = !location.hash || /^#?\/?$/.test(location.hash) || /^#?\/?(dashboard|home)?$/.test(location.hash.replace(/^#/, ""));
    if (onDashboard) {
      const st = $(".stats");
      if (st && !$("#dash-charts-host")) renderChart();
    }
  }
  const obs = new MutationObserver(() => tick());
  document.addEventListener("DOMContentLoaded", () => {
    obs.observe(document.body, { childList: true, subtree: true });
    tick();
  });
  window.addEventListener("hashchange", () => setTimeout(tick, 100));
})();
