/* Генерує всі картинки для Instagram у out/.
   Запуск: node build.js            (потрібен Playwright з Chromium)
   Дані (ціни, кольори, умови) — у data.js. */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const D = require("./data.js");

const IMG = (n) => "img/" + n + "-front.png";
const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n).replace(/ | /g, " ");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nb = (s) => esc(s).replace(/ (oz|мл|год|грн)/g, "&nbsp;$1");

const ICON = {
  cold: '<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11"/><path d="M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  hot: '<path d="M8 3c0 2 2 2 2 4s-2 2-2 4M14 3c0 2 2 2 2 4s-2 2-2 4"/><path d="M4 14h16v1a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/>',
  volume: '<path d="M7 3h10l-1 18H8z"/><path d="M7.5 9h9"/>',
  lid: '<rect x="4" y="8" width="16" height="5" rx="2"/><path d="M14 8V3"/><path d="M6 13l1 8h10l1-8"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
};
const icon = (n, size = 28, sw = 1.7) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

const BASE = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=block">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#F3ECE1;--card:#FBF8F3;--ink:#1F1F1F;--muted:#6B6B5E;--green:#1C3A2E;--tan:#C4A882}
html,body{width:var(--w);height:var(--h);overflow:hidden}
body{font-family:"DM Sans",sans-serif;color:var(--ink);position:relative;
  background:radial-gradient(900px 600px at 85% -10%,#fff 0%,transparent 60%),radial-gradient(800px 700px at 0% 110%,#E9DFCF 0%,transparent 60%),var(--bg)}
.serif{font-family:"Playfair Display",serif;font-variant-numeric:lining-nums}
.brand{font-weight:800;letter-spacing:.2em}
.pill{display:inline-flex;align-items:baseline;background:var(--green);color:#fff;border-radius:999px;font-weight:700;white-space:nowrap}
.pill small{font-weight:600;opacity:.85;margin-left:6px}
.chip{background:rgba(255,255,255,.85);border-radius:999px;font-weight:600;color:var(--green)}
.cup{display:block;filter:drop-shadow(0 22px 22px rgba(60,40,30,.16))}
.floor{position:absolute;left:50%;transform:translateX(-50%);height:40px;background:radial-gradient(closest-side,rgba(70,50,35,.2),transparent)}
</style>`;

const page = (w, h, css, body) =>
  `<!doctype html><html lang="uk"><head><meta charset="utf-8">${BASE}<style>:root{--w:${w}px;--h:${h}px}${css}</style></head><body>${body}</body></html>`;

const header = (sub) => `
  <div class="hd"><div><div class="brand" style="font-size:30px">STANLEY</div>${sub ? `<div style="font-size:21px;color:var(--muted);margin-top:6px">${sub}</div>` : ""}</div>
  <div class="chip" style="font-size:21px;padding:11px 20px">${esc(D.handle)}</div></div>`;
const HD_CSS = `.hd{display:flex;justify-content:space-between;align-items:center}`;

/* ---------------- POSTS 1080×1350 ---------------- */
const W = 1080, H = 1350;
const posts = {};

posts["01-welcome"] = page(W, H, HD_CSS + `
  body{padding:0}
  .photo{position:absolute;left:0;right:0;top:0;height:760px;background:url(img/lifestyle.jpg) center 35%/cover}
  .photo::after{content:"";position:absolute;inset:auto 0 0 0;height:220px;background:linear-gradient(transparent,var(--bg))}
  .top{position:absolute;left:64px;right:64px;top:56px}
  .top .brand{color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.25)}
  .txt{position:absolute;left:64px;right:64px;top:650px}
  h1{font-size:84px;line-height:1.02;font-weight:500;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .lead{font-size:30px;color:#4E4E45;margin-top:22px;line-height:1.35}
  .row{display:flex;gap:14px;margin-top:40px}
  .it{flex:1;background:rgba(255,255,255,.8);border-radius:24px;padding:22px 22px;font-size:22px;line-height:1.25;color:var(--muted)}
  .it b{display:block;font-size:30px;color:var(--ink);margin-bottom:4px}
  .it svg{color:var(--green);margin-bottom:10px}`,
  `<div class="photo"></div>
   <div class="top hd"><div class="brand" style="font-size:30px">STANLEY</div><div class="chip" style="font-size:21px;padding:11px 20px">${esc(D.handle)}</div></div>
   <div class="txt">
     <h1 class="serif">Термокружки Stanley <i>з доставкою по&nbsp;Україні</i></h1>
     <p class="lead">Quencher і ProTour — ${D.models.length} моделі, ${D.models.reduce((a, m) => a + m.colors.length, 0)} кольорів. Замовлення в Direct або за посиланням у профілі.</p>
     <div class="row">
       <div class="it">${icon("grid", 34)}<b>${D.models.length} моделі</b>від ${fmt(Math.min(...D.models.map(m => m.price)))} грн</div>
       <div class="it">${icon("truck", 34)}<b>2–3 дні</b>Нова Пошта</div>
       <div class="it">${icon("chat", 34)}<b>Direct</b>відповідаємо швидко</div>
     </div>
   </div>`);

posts["02-prices"] = page(W, H, HD_CSS + `
  body{padding:64px;display:flex;flex-direction:column}
  h1{font-size:64px;font-weight:500;margin:34px 0 30px;letter-spacing:-.01em}
  h1 i{font-style:italic;color:var(--muted)}
  .grid{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:22px}
  .card{border-radius:30px;position:relative;overflow:hidden;display:flex;flex-direction:column;
    background:radial-gradient(70% 45% at 50% 62%,var(--t) 0%,transparent 80%),var(--card);box-shadow:0 20px 40px -24px rgba(28,58,46,.25)}
  .st{position:relative;flex:1}
  .st img{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);height:var(--hh)}
  .st .floor{bottom:4px;width:60%}
  .in{padding:4px 24px 22px;display:flex;justify-content:space-between;align-items:flex-end;gap:10px}
  .nm{font-size:33px;font-weight:500;line-height:1.05}
  .nm b{font-weight:600}
  .mt{font-size:18px;color:var(--muted);margin-top:6px}
  .pill{font-size:28px;padding:11px 18px}.pill small{font-size:18px}
  .ft{margin-top:26px;font-size:21px;color:var(--muted);display:flex;justify-content:space-between}
  .ft b{color:var(--ink)}`,
  `${header("")}
   <h1 class="serif">Ціни <i>та моделі</i></h1>
   <div class="grid">${D.models.map(m => {
     const hh = { q40: "88%", q30: "82%", pt30: "76%", pt20: "62%" }[m.key] || "80%";
     return `<div class="card" style="--t:${m.tint}"><div class="st"><div class="floor"></div><img class="cup" src="${IMG(m.hero)}" style="--hh:${hh}"></div>
       <div class="in"><div><div class="nm serif">${esc(m.family)} <b>${nb(m.size)}</b></div><div class="mt">${nb(m.ml)} · ${m.colors.length} кольор${m.colors.length < 5 ? "и" : "ів"}</div></div>
       <div class="pill">${fmt(m.price)}<small>грн</small></div></div></div>`;
   }).join("")}</div>
   <div class="ft"><span>Доставка <b>Новою Поштою</b> по Україні</span><span>Замовлення — у Direct</span></div>`);

posts["03-compare"] = page(W, H, HD_CSS + `
  body{padding:64px}
  h1{font-size:76px;font-weight:500;line-height:1;margin-top:40px;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .lead{font-size:26px;color:var(--muted);margin-top:16px}
  .cups{display:flex;align-items:flex-end;justify-content:space-around;height:480px;margin-top:40px;position:relative}
  .cups img{height:var(--hh)}
  .cups .floor{bottom:-14px;width:90%}
  table{width:100%;border-collapse:separate;border-spacing:0;margin-top:44px;background:rgba(255,255,255,.85);border-radius:28px;overflow:hidden;font-size:26px}
  th,td{padding:22px 10px;text-align:center;border-bottom:1px solid rgba(31,31,31,.08)}
  th{font-size:19px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:rgba(255,255,255,.6)}
  td:first-child,th:first-child{text-align:left;padding-left:26px}
  tr:last-child td{border-bottom:0}
  td b{font-weight:700}
  .p{color:var(--green);font-weight:800}`,
  `${header("")}
   <h1 class="serif">Яку <i>обрати?</i></h1>
   <p class="lead">Усі моделі — нержавіюча сталь 18/8, подвійні стінки, BPA-free.</p>
   <div class="cups"><div class="floor"></div>${D.models.map(m => {
     const hh = { q40: 100, q30: 88, pt30: 84, pt20: 67 }[m.key] || 80;
     return `<img class="cup" src="${IMG(m.hero)}" style="--hh:${hh}%">`;
   }).join("")}</div>
   <table><tr><th>Модель</th><th>Обʼєм</th><th>Холод</th><th>Тепло</th><th>Ціна</th></tr>
   ${D.models.map(m => `<tr><td><b>${esc(m.family)} ${nb(m.size)}</b></td><td>${nb(m.ml)}</td><td>${nb(m.cold)}</td><td>${nb(m.hot)}</td><td class="p">${fmt(m.price)}&nbsp;грн</td></tr>`).join("")}
   </table>`);

const modelPost = (m, idx) => page(W, H, HD_CSS + `
  body{padding:64px;background:radial-gradient(620px 620px at 32% 58%,${m.tint} 0%,transparent 70%),radial-gradient(900px 600px at 85% -10%,#fff 0%,transparent 60%),var(--bg)}
  .fam{font-size:30px;color:var(--muted);margin-top:44px;letter-spacing:.04em}
  h1{font-size:150px;font-weight:500;line-height:.9;letter-spacing:-.03em}
  .stage{position:absolute;left:30px;bottom:150px;width:560px;height:820px;display:flex;align-items:flex-end;justify-content:center}
  .stage img{height:var(--hh);position:relative;z-index:1}
  .stage .floor{bottom:-16px;width:70%}
  .side{position:absolute;right:64px;top:400px;width:400px;display:flex;flex-direction:column;gap:14px}
  .f{background:rgba(255,255,255,.85);border-radius:22px;padding:18px 20px;display:flex;gap:14px;align-items:center;font-size:21px;color:var(--muted);line-height:1.2}
  .f svg{color:var(--green);flex:none}
  .f b{display:block;color:var(--ink);font-size:27px}
  .bot{position:absolute;left:64px;right:64px;bottom:60px;display:flex;justify-content:space-between;align-items:center}
  .pill{font-size:44px;padding:16px 30px}.pill small{font-size:26px}
  .sw{display:flex;gap:10px}
  .sw i{width:40px;height:40px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12),0 0 0 3px #fff}`,
  `${header("")}
   <div class="fam">${esc(m.family.toUpperCase())}</div>
   <h1 class="serif">${nb(m.size)}</h1>
   <div class="stage"><div class="floor"></div><img class="cup" src="${IMG(m.hero)}" style="--hh:${{ q40: 100, q30: 96, pt30: 92, pt20: 78 }[m.key] || 90}%"></div>
   <div class="side">
     <div class="f">${icon("volume", 34)}<div><b>${nb(m.ml)}</b>обʼєм</div></div>
     <div class="f">${icon("cold", 34)}<div><b>до ${nb(m.cold)}</b>тримає холод</div></div>
     <div class="f">${icon("hot", 34)}<div><b>до ${nb(m.hot)}</b>тримає тепло</div></div>
     <div class="f">${icon("lid", 34)}<div><b>${esc(m.lid.split(",")[0])}</b>${esc((m.lid.split(",")[1] || "").trim())}</div></div>
   </div>
   <div class="bot"><div class="pill">${fmt(m.price)}<small>грн</small></div>
     <div class="sw">${m.colors.map(c => `<i style="background:${c[2]}"></i>`).join("")}</div></div>`);
D.models.forEach((m, i) => { posts[`0${4 + i}-${m.key}`] = modelPost(m, i); });

posts["08-colors"] = page(W, H, HD_CSS + `
  body{padding:64px}
  h1{font-size:76px;font-weight:500;margin-top:34px;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .blk{margin-top:24px}
  .lbl{font-size:24px;font-weight:700;letter-spacing:.04em}
  .lbl span{font-weight:500;color:var(--muted)}
  .row{display:flex;align-items:flex-end;justify-content:space-between;margin-top:12px;height:var(--rh);position:relative}
  .row .floor{bottom:22px;width:100%}
  .c{display:flex;flex-direction:column;align-items:center;gap:10px;flex:1}
  .c img{height:calc(var(--rh) - 50px)}
  .c span{font-size:18px;color:var(--muted);white-space:nowrap}`,
  `${header("")}
   <h1 class="serif">Обери <i>свій колір</i></h1>
   ${D.models.filter(m => m.colors.length >= 4).map(m => `
     <div class="blk"><div class="lbl">${esc(m.family)} ${nb(m.size)} <span>· ${fmt(m.price)} грн</span></div>
     <div class="row" style="--rh:${m.key === "q40" ? 300 : 245}px"><div class="floor"></div>
     ${m.colors.map(c => `<div class="c"><img class="cup" src="${IMG(c[0])}"><span>${esc(c[1])}</span></div>`).join("")}</div></div>`).join("")}`);

posts["09-how-to-order"] = page(W, H, HD_CSS + `
  body{padding:64px}
  h1{font-size:84px;font-weight:500;line-height:1;margin-top:50px;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .steps{margin-top:54px;display:flex;flex-direction:column;gap:22px}
  .s{background:rgba(255,255,255,.88);border-radius:30px;padding:34px 36px;display:flex;gap:30px;align-items:flex-start}
  .n{flex:none;width:76px;height:76px;border-radius:50%;background:var(--green);color:#fff;font-size:38px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .s b{display:block;font-size:34px;margin-bottom:8px}
  .s p{font-size:25px;color:var(--muted);line-height:1.35}
  .ft{position:absolute;left:64px;right:64px;bottom:56px;font-size:24px;color:var(--muted);text-align:center}
  .cr{position:absolute;left:64px;right:64px;bottom:110px;height:250px;display:flex;justify-content:center;gap:26px;align-items:flex-end}
  .cr img{height:var(--hh)}
  .cr .floor{bottom:-12px;width:80%}`,
  `${header("")}
   <h1 class="serif">Як <i>замовити</i></h1>
   <div class="steps">
     <div class="s"><div class="n">1</div><div><b>Напишіть нам у Direct</b><p>Модель і колір. Або оформіть самі за посиланням у профілі — це 30 секунд.</p></div></div>
     <div class="s"><div class="n">2</div><div><b>Надішліть дані для доставки</b><p>ПІБ, телефон, місто й відділення або поштомат Нової Пошти.</p></div></div>
     <div class="s"><div class="n">3</div><div><b>Підтверджуємо й відправляємо</b><p>Менеджер звʼяжеться, узгодить оплату. Відправка Новою Поштою за 2–3 дні.</p></div></div>
   </div>
   <div class="cr"><div class="floor"></div>${D.models.map(m => `<img class="cup" src="${IMG(m.hero)}" style="--hh:${{ q40: 100, q30: 88, pt30: 84, pt20: 67 }[m.key] || 80}%">`).join("")}</div>
   <div class="ft">Питання? Пишіть — відповімо на все в Direct</div>`);

posts["10-delivery"] = page(W, H, HD_CSS + `
  body{padding:64px}
  h1{font-size:84px;font-weight:500;line-height:1;margin-top:50px;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .sec{margin-top:44px}
  .t{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--green)}
  .list{margin-top:16px;background:rgba(255,255,255,.88);border-radius:28px;padding:6px 32px}
  .r{padding:22px 0;border-bottom:1px solid rgba(31,31,31,.08)}
  .r:last-child{border-bottom:0}
  .r b{display:block;font-size:31px}
  .r span{font-size:23px;color:var(--muted)}
  .w{position:absolute;left:64px;right:64px;bottom:64px;background:var(--green);color:#fff;border-radius:26px;padding:26px 32px;font-size:28px;font-weight:600;display:flex;gap:16px;align-items:center}`,
  `${header("")}
   <h1 class="serif">Доставка <i>та оплата</i></h1>
   <div class="sec"><div class="t">${icon("truck", 32, 2)}Доставка</div>
     <div class="list">${D.delivery.map(d => `<div class="r"><b>${esc(d[0])}</b><span>${esc(d[1])}</span></div>`).join("")}</div></div>
   <div class="sec"><div class="t">${icon("card", 32, 2)}Оплата</div>
     <div class="list">${D.payment.map(d => `<div class="r"><b>${esc(d[0])}</b><span>${esc(d[1])}</span></div>`).join("")}</div></div>
   ${D.warranty ? `<div class="w">${icon("shield", 36, 2)}${esc(D.warranty)}</div>` : ""}`);

/* ---------------- STORIES 1080×1920 (верх 250 px і низ 340 px — під інтерфейс Instagram) ---------------- */
const SW = 1080, SH = 1920;
const stories = {};
const pt30 = D.models.find(m => m.key === "pt30"), pt20 = D.models.find(m => m.key === "pt20");

stories["story-1-protour"] = page(SW, SH, `
  body{background:radial-gradient(700px 700px at 35% 55%,#F1DDF0 0%,transparent 70%),radial-gradient(640px 640px at 75% 62%,#F7DCCF 0%,transparent 70%),var(--bg)}
  .t{position:absolute;left:80px;right:80px;top:270px}
  .k{font-size:30px;font-weight:700;letter-spacing:.2em;color:var(--green)}
  h1{font-size:150px;font-weight:500;line-height:.95;margin-top:16px;letter-spacing:-.02em}
  h1 i{font-style:italic}
  p{font-size:36px;color:#4E4E45;margin-top:20px;line-height:1.3}
  .cups{position:absolute;left:0;right:0;top:820px;height:620px}
  .cups img{position:absolute;bottom:0;transform:translateX(-50%)}
  .cups .floor{bottom:-16px;width:80%}
  .pr{position:absolute;left:80px;right:80px;top:1470px;display:flex;justify-content:space-around}
  .pr div{text-align:center;font-size:30px;color:var(--muted)}
  .pill{font-size:44px;padding:14px 28px;margin-top:10px}.pill small{font-size:26px}`,
  `<div class="t"><div class="k">НОВИНКА</div><h1 class="serif">Pro<i>Tour</i></h1><p>Відкидна трубочка Flip Straw —<br>не протікає навіть у сумці</p></div>
   <div class="cups"><div class="floor"></div>
     <img class="cup" src="${IMG(pt30.hero)}" style="left:34%;height:620px">
     <img class="cup" src="${IMG(pt20.hero)}" style="left:70%;height:500px"></div>
   <div class="pr"><div>${nb(pt30.size)} · ${nb(pt30.ml)}<br><span class="pill">${fmt(pt30.price)}<small>грн</small></span></div>
     <div>${nb(pt20.size)} · ${nb(pt20.ml)}<br><span class="pill">${fmt(pt20.price)}<small>грн</small></span></div></div>`);

stories["story-2-prices"] = page(SW, SH, `
  .t{position:absolute;left:80px;right:80px;top:270px}
  h1{font-size:120px;font-weight:500;letter-spacing:-.02em}
  h1 i{font-style:italic}
  .l{position:absolute;left:80px;right:80px;top:470px;display:flex;flex-direction:column;gap:22px}
  .r{background:rgba(255,255,255,.9);border-radius:32px;height:270px;display:flex;align-items:center;gap:26px;padding:0 36px 0 20px;overflow:hidden;
     background:radial-gradient(240px 200px at 120px 60%,var(--t),transparent 80%),rgba(255,255,255,.9)}
  .r .im{width:200px;height:250px;display:flex;align-items:flex-end;justify-content:center}
  .r img{max-height:240px;max-width:200px}
  .r .n{flex:1;font-size:46px;font-weight:500;line-height:1.05}
  .r .n span{display:block;font-family:"DM Sans";font-size:26px;color:var(--muted);margin-top:8px}
  .pill{font-size:40px;padding:14px 26px}.pill small{font-size:24px}`,
  `<div class="t"><h1 class="serif">Ціни <i>сьогодні</i></h1></div>
   <div class="l">${D.models.map(m => `<div class="r" style="--t:${m.tint}"><div class="im"><img class="cup" src="${IMG(m.hero)}"></div>
     <div class="n serif">${esc(m.family)} ${nb(m.size)}<span>${nb(m.ml)} · холод ${nb(m.cold)}</span></div><div class="pill">${fmt(m.price)}<small>грн</small></div></div>`).join("")}</div>`);

stories["story-3-direct"] = page(SW, SH, `
  body{background:var(--green);color:#fff}
  .t{position:absolute;left:80px;right:80px;top:300px}
  h1{font-size:120px;font-weight:500;line-height:1;letter-spacing:-.02em}
  h1 i{font-style:italic;color:#E9DFCF}
  p{font-size:38px;opacity:.85;margin-top:30px;line-height:1.35}
  .box{position:absolute;left:80px;right:80px;top:880px;background:rgba(255,255,255,.1);border:2px dashed rgba(255,255,255,.4);border-radius:36px;height:300px;display:flex;align-items:center;justify-content:center;font-size:30px;opacity:.75;text-align:center;line-height:1.4}
  .cups{position:absolute;left:0;right:0;bottom:340px;display:flex;justify-content:center;gap:30px;align-items:flex-end}
  .cups img{height:300px;filter:drop-shadow(0 20px 20px rgba(0,0,0,.3))}`,
  `<div class="t"><h1 class="serif">Замовлення <i>в Direct</i></h1><p>Напишіть модель і колір —<br>відповімо й усе оформимо</p></div>
   <div class="box">Сюди — стікер «Посилання»<br>на лендинг або стікер «Питання»</div>
   <div class="cups">${["q40-cream", "pt30-orchid", "pt20-peach", "q30-navy"].map(n => `<img src="${IMG(n)}">`).join("")}</div>`);

/* ---------------- ОБКЛАДИНКИ АКТУАЛЬНОГО 1080×1920 (видно лише коло в центрі) ---------------- */
const highlights = [["ціни", "tag"], ["моделі", "grid"], ["замовити", "chat"], ["доставка", "truck"], ["оплата", "card"], ["відгуки", "star"]];
const covers = {};
highlights.forEach(([name, ic], i) => {
  covers[`highlight-${i + 1}-${name}`] = page(SW, SH, `
    body{background:var(--green);color:#F3ECE1;display:flex;align-items:center;justify-content:center}`,
    `${icon(ic, 340, 1.3)}`);
});

/* ---------------- АВАТАРКА 1080×1080 ---------------- */
const avatar = page(1080, 1080, `
  body{background:radial-gradient(520px 520px at 50% 60%,#2A5242 0%,#1C3A2E 70%)}
  img{position:absolute;left:50%;top:50%;height:760px;transform:translate(-50%,-48%);filter:drop-shadow(0 30px 30px rgba(0,0,0,.35))}`,
  `<img src="${IMG("q40-cream")}">`);

/* ---------------- RENDER ---------------- */
(async () => {
  const out = path.join(__dirname, "out");
  fs.mkdirSync(out, { recursive: true });
  const jobs = [
    ...Object.entries(posts).map(([n, h]) => ["posts/" + n, h, W, H]),
    ...Object.entries(stories).map(([n, h]) => ["stories/" + n, h, SW, SH]),
    ...Object.entries(covers).map(([n, h]) => ["highlights/" + n, h, SW, SH]),
    ["avatar", avatar, 1080, 1080],
  ];
  const b = await chromium.launch();
  const ctx = await b.newContext({ deviceScaleFactor: 1 });
  for (const [name, html, w, h] of jobs) {
    const file = path.join(__dirname, ".tmp-" + name.replace(/\//g, "_") + ".html");
    fs.writeFileSync(file, html);
    const p = await ctx.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto("file://" + file, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const dest = path.join(out, name + ".png");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await p.screenshot({ path: dest });
    await p.close();
    fs.unlinkSync(file);
    console.log("✓", name);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
