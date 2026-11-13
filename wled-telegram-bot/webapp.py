#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Мини веб-приложение: красивый пульт для WLED-лампы + пульт для телевизора Samsung.

Запускается прямо внутри основного процесса бота: отдаёт страницу и сам
проксирует запросы к лампе и к телевизору (без CORS/mixed-content).

На айфоне: открой в Safari http://<IP-ПК>:8080 → «Поделиться» →
«На экран „Домой"» — появится иконка-приложение на весь экран.
"""

import os
import json
import socket
import threading
import urllib.parse
import httpx
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tvremote
import timers
import voice

_IP = "192.168.1.106"  # IP лампы, задаётся в serve()
# Конфиг телевизора общий с ботом — живёт в tvremote.config.
_TV = tvremote.config

# Папка с оформлением (иконки приложения, баннер).
_ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def _asset_bytes(name: str) -> bytes:
    with open(os.path.join(_ASSETS, name), "rb") as f:
        return f.read()


# PWA-манифест: имя и иконки для «добавить на экран Домой».
MANIFEST = json.dumps({
    "name": "INTELLECT — умный свет и ТВ",
    "short_name": "INTELLECT",
    "display": "standalone",
    "background_color": "#07070c",
    "theme_color": "#07070c",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png",
         "purpose": "any maskable"},
    ],
}, ensure_ascii=False)

# Постоянное keep-alive соединение с лампой — быстрее повторные запросы.
_http = httpx.Client(
    timeout=httpx.Timeout(4.0, connect=1.5),
    limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=30),
)


# ----------------------- Проксирование к лампе -----------------------
def _lamp_get(path: str) -> bytes:
    r = _http.get(f"http://{_IP}{path}")
    r.raise_for_status()
    return r.content


def _lamp_post(path: str, body: bytes) -> bytes:
    r = _http.post(f"http://{_IP}{path}", content=body,
                   headers={"Content-Type": "application/json"})
    r.raise_for_status()
    return r.content


def lan_ip() -> str:
    """Определить локальный IP этого ПК (чтобы знать адрес для айфона)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# ----------------------- Страница -----------------------
PAGE = r"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="INTELLECT">
<meta name="theme-color" content="#07070c">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="manifest" href="/manifest.json">
<title>INTELLECT</title>
<style>
  :root{
    --bg:#07070c; --bg2:#0e0e17; --card:#15151f; --card2:#1b1b27;
    --line:#2a2a3a; --txt:#f0f0f6; --mut:#9090a8; --acc:#7c5cff; --acc2:#9d7bff;
    --ok:#2ecc71; --red:#ff4d4d; --shadow:0 8px 24px rgba(0,0,0,.45);
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;
    -webkit-user-select:none;user-select:none;}
  body{margin:0;color:var(--txt);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:
      radial-gradient(120% 60% at 50% -10%, #1a1330 0%, transparent 60%),
      radial-gradient(100% 50% at 100% 110%, #102030 0%, transparent 55%),
      var(--bg);
    padding:max(14px,env(safe-area-inset-top)) 14px calc(26px + env(safe-area-inset-bottom));}
  .wrap{max-width:460px;margin:0 auto;}

  /* Переключатель вкладок */
  .tabs{display:flex;gap:8px;margin-bottom:16px;
    background:var(--card);border:1px solid var(--line);border-radius:18px;padding:5px;}
  .tab{flex:1;text-align:center;padding:11px;border-radius:14px;color:var(--mut);
    font-weight:700;font-size:15px;transition:.2s;}
  .tab.active{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;
    box-shadow:0 6px 16px rgba(124,92,255,.4);}
  .page{display:none;animation:fade .25s ease;} .page.active{display:block;}
  @keyframes fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}

  h1{font-size:20px;margin:2px 2px 12px;display:flex;align-items:center;gap:10px;font-weight:800;}
  .dot{width:11px;height:11px;border-radius:50%;background:#666;transition:.3s;}
  .dot.on{background:var(--ok);box-shadow:0 0 12px var(--ok);}
  .dot.off{background:#777;}
  .sub{color:var(--mut);font-size:13px;font-weight:600;}
  .card{background:linear-gradient(180deg,var(--card2),var(--card));
    border:1px solid var(--line);border-radius:22px;padding:16px;margin-bottom:14px;
    box-shadow:var(--shadow);}
  .t{font-size:12px;color:var(--mut);margin:0 0 12px;text-transform:uppercase;
    letter-spacing:1px;font-weight:700;}

  /* Кнопки общие */
  .press{transition:transform .08s, filter .08s, background .15s;}
  .press:active{transform:scale(.93);filter:brightness(1.25);}

  /* ЛАМПА */
  .power{width:100%;border:0;border-radius:18px;padding:18px;font-size:18px;font-weight:800;
    color:#fff;background:linear-gradient(135deg,var(--acc),var(--acc2));
    box-shadow:0 8px 20px rgba(124,92,255,.38);}
  .power.off{background:linear-gradient(135deg,#262633,#1c1c27);color:var(--mut);box-shadow:none;}
  /* живая «лампа» — светится выбранным цветом, тускнеет вместе с яркостью */
  .bulb{position:relative;width:118px;height:118px;margin:2px auto 20px;border-radius:50%;
    background:radial-gradient(circle at 50% 40%, var(--lc,#ffd27f) 0%,
      color-mix(in srgb, var(--lc,#ffd27f) 55%, #000) 72%, #0c0c14 100%);
    box-shadow:0 0 calc(34px + 46px*var(--lb,.5)) calc(6px + 18px*var(--lb,.5)) var(--lc,#ffd27f),
      inset 0 -10px 22px rgba(0,0,0,.45), inset 0 8px 18px rgba(255,255,255,.18);
    transition:background .35s ease, box-shadow .4s ease, opacity .35s ease, filter .35s ease;}
  .bulb::after{content:"";position:absolute;left:50%;bottom:-9px;width:30px;height:14px;
    transform:translateX(-50%);border-radius:0 0 7px 7px;
    background:linear-gradient(180deg,#3a3a48,#22222c);}
  .bulb.off{filter:grayscale(.75) brightness(.45);opacity:.45;box-shadow:none;}
  .lbl{color:var(--mut);font-size:13px;display:flex;justify-content:space-between;
    margin-bottom:12px;font-weight:600;}
  input[type=range]{width:100%;height:34px;-webkit-appearance:none;background:transparent;}
  input[type=range]::-webkit-slider-runnable-track{height:12px;border-radius:7px;
    background:linear-gradient(90deg,var(--acc) var(--p,50%), #25252f var(--p,50%));}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;
    border-radius:50%;background:#fff;margin-top:-8px;box-shadow:0 3px 8px rgba(0,0,0,.55);}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;}
  .sw{aspect-ratio:1;border-radius:16px;border:2px solid rgba(255,255,255,.14);
    box-shadow:inset 0 -6px 12px rgba(0,0,0,.25);}
  .fxg{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
  .fx{background:var(--card2);border:1px solid var(--line);color:var(--txt);
    border-radius:14px;padding:14px;font-size:15px;font-weight:600;}

  /* ===== цветовое колесо ===== */
  .wheelwrap{display:flex;justify-content:center;}
  .wheel{position:relative;width:248px;height:248px;border-radius:50%;touch-action:none;
    background:
      radial-gradient(circle, #fff 0%, rgba(255,255,255,0) 66%),
      conic-gradient(from 0deg, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
    box-shadow:0 12px 32px rgba(0,0,0,.55), inset 0 0 0 6px rgba(255,255,255,.05);}
  .wheel.off{filter:grayscale(.55) brightness(.7);opacity:.65;}
  .wheelthumb{position:absolute;left:50%;top:6px;width:32px;height:32px;border-radius:50%;
    border:3px solid #fff;background:#fff;transform:translate(-50%,-50%);pointer-events:none;
    box-shadow:0 3px 10px rgba(0,0,0,.65), 0 0 0 2px rgba(0,0,0,.25);}
  /* быстрые образцы цвета */
  .swrow{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin-top:16px;}
  .swrow .sw{aspect-ratio:1;border-radius:13px;border:2px solid rgba(255,255,255,.14);}
  .sw.wsel{border-color:#fff;box-shadow:0 0 0 3px rgba(124,92,255,.55);}

  /* ===== сцены ===== */
  .scenes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .scene{background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:16px;
    padding:14px 6px;display:flex;flex-direction:column;align-items:center;gap:6px;font-weight:700;
    font-size:13px;box-shadow:var(--shadow);}
  .scene .se{font-size:24px;line-height:1;}

  /* ===== эффекты: поиск + список ===== */
  .fxsearch{width:100%;background:#0c0c14;border:1px solid var(--line);color:var(--txt);
    border-radius:14px;padding:13px 14px;font-size:15px;margin-bottom:12px;}
  .fxsearch::placeholder{color:var(--mut);}
  .fxlist{max-height:268px;overflow-y:auto;-webkit-overflow-scrolling:touch;
    display:flex;flex-direction:column;gap:8px;padding-right:2px;}
  .fxchip{background:var(--card2);border:1px solid var(--line);color:var(--txt);text-align:left;
    border-radius:13px;padding:14px 16px;font-size:15px;font-weight:600;}
  .fxchip.sel{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border:0;
    box-shadow:0 6px 16px rgba(124,92,255,.45);}
  .fxlist::-webkit-scrollbar{width:6px;} .fxlist::-webkit-scrollbar-thumb{
    background:#2f2f40;border-radius:3px;}

  /* ===== ТВ-ПУЛЬТ ===== */
  .setup .row{display:flex;gap:8px;}
  .setup input{flex:1;background:#0c0c14;border:1px solid var(--line);color:var(--txt);
    border-radius:14px;padding:13px;font-size:15px;}
  .setup .go{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border:0;
    border-radius:14px;padding:0 18px;font-weight:800;}
  .setup .wide{width:100%;margin-top:10px;background:var(--card2);border:1px solid var(--line);
    color:var(--txt);border-radius:14px;padding:13px;font-weight:700;font-size:15px;}
  .hint{color:var(--mut);font-size:12px;margin-top:10px;line-height:1.4;}

  .toprow{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;}
  .rbtn{background:var(--card2);border:1px solid var(--line);color:var(--txt);
    border-radius:18px;padding:16px 6px;font-size:14px;font-weight:700;display:flex;
    flex-direction:column;align-items:center;gap:5px;box-shadow:var(--shadow);}
  .rbtn .ic{font-size:22px;line-height:1;}
  .rbtn.pw{background:linear-gradient(135deg,#ff5a5a,#d63a3a);color:#fff;border:0;
    box-shadow:0 8px 18px rgba(214,58,58,.4);}

  /* центральный блок: качельки + D-pad */
  .center{display:grid;grid-template-columns:64px 1fr 64px;gap:12px;align-items:center;
    margin-bottom:16px;}
  .rocker{background:var(--card2);border:1px solid var(--line);border-radius:30px;
    display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow);}
  .rocker button{background:none;border:0;color:var(--txt);padding:18px 0;font-size:20px;font-weight:800;}
  .rocker .mid{font-size:10px;color:var(--mut);padding:6px 0;border-top:1px solid var(--line);
    border-bottom:1px solid var(--line);letter-spacing:1px;}
  .dpad{position:relative;aspect-ratio:1;border-radius:50%;
    background:radial-gradient(circle at 50% 38%, #23233200, #0d0d15),
      conic-gradient(from 0deg,#1d1d2a,#15151f,#1d1d2a);
    border:1px solid var(--line);box-shadow:var(--shadow), inset 0 2px 10px rgba(255,255,255,.04);
    display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr 1fr;}
  .dpad .nav{background:none;border:0;color:var(--txt);font-size:22px;font-weight:800;
    display:flex;align-items:center;justify-content:center;border-radius:24px;margin:4px;}
  .dpad .nav:active{background:rgba(124,92,255,.28);}
  .dpad .u{grid-area:1/2;} .dpad .l{grid-area:2/1;} .dpad .r{grid-area:2/3;} .dpad .d{grid-area:3/2;}
  .dpad .ok{grid-area:2/2;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;
    border:0;border-radius:50%;margin:10px;font-weight:900;font-size:17px;
    box-shadow:0 6px 16px rgba(124,92,255,.5);}

  .colors{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
  .ck{height:42px;border-radius:12px;border:0;box-shadow:inset 0 -4px 8px rgba(0,0,0,.3);}

  .pad3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .pad3 .num{background:var(--card2);border:1px solid var(--line);color:var(--txt);
    border-radius:16px;padding:16px 0;font-size:19px;font-weight:700;}
  .row3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;}
  .row3 .b,.row5 .b{background:var(--card2);border:1px solid var(--line);color:var(--txt);
    border-radius:14px;padding:14px 4px;font-size:14px;font-weight:600;}
  .row5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px;}
  .row5 .b{font-size:18px;padding:14px 0;}
  .apps{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
  .app{border:0;border-radius:16px;padding:15px;font-weight:800;font-size:15px;color:#fff;}
  .app.yt{background:linear-gradient(135deg,#ff3d3d,#cc0000);}
  .app.nf{background:linear-gradient(135deg,#e50914,#7a060d);}
  .toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));
    transform:translateX(-50%) translateY(20px);background:#000d;color:#fff;
    padding:11px 18px;border-radius:14px;font-weight:700;font-size:14px;opacity:0;
    transition:.25s;pointer-events:none;border:1px solid var(--line);z-index:9;}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  .collapse{max-height:0;overflow:hidden;transition:max-height .3s;}
  .collapse.open{max-height:520px;}
  /* кнопка голосового управления */
  .mic{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));
    width:60px;height:60px;border-radius:50%;border:0;font-size:26px;color:#fff;z-index:20;
    background:linear-gradient(135deg,var(--acc),var(--acc2));
    box-shadow:0 10px 26px rgba(124,92,255,.5);transition:.15s;}
  .mic:active{transform:scale(.92);}
  .mic.rec{background:linear-gradient(135deg,#ff4d4d,#d63a3a);animation:pulse 1s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,77,77,.6);}70%{box-shadow:0 0 0 16px rgba(255,77,77,0);}100%{box-shadow:0 0 0 0 rgba(255,77,77,0);}}
</style>
</head>
<body>
<div class="wrap">
  <div class="tabs">
    <div class="tab active" id="tabLamp" onclick="showTab('lamp')">💡 Лампа</div>
    <div class="tab" id="tabTv" onclick="showTab('tv')">📺 Телевизор</div>
  </div>

  <!-- ================= ЛАМПА ================= -->
  <div class="page active" id="lamp">
    <h1><span id="dot" class="dot"></span><span id="name">WLED</span></h1>
    <div class="sub" id="status" style="margin-bottom:14px">Подключение…</div>

    <div id="bulb" class="bulb off"></div>
    <div class="card"><button id="power" class="power press" onclick="toggle()">⏻ Питание</button></div>
    <div class="card">
      <div class="lbl"><span>☀️ Яркость</span><span id="briv">—</span></div>
      <input id="bri" type="range" min="1" max="255" value="128" oninput="briLive(this.value)" onchange="setBri(this.value)">
    </div>

    <div class="card">
      <p class="t">🎨 Цвет</p>
      <div class="wheelwrap">
        <div id="wheel" class="wheel"><div id="wthumb" class="wheelthumb"></div></div>
      </div>
      <div class="swrow" id="colors"></div>
    </div>

    <div class="card">
      <p class="t">✨ Сцены</p>
      <div class="scenes" id="scenes"></div>
    </div>

    <div class="card">
      <p class="t">🌈 Эффекты</p>
      <input id="fxsearch" class="fxsearch" placeholder="🔍 Поиск эффекта…" oninput="filterFx(this.value)">
      <div class="fxlist" id="fx"></div>
      <div style="margin-top:14px">
        <div class="lbl"><span>⚡ Скорость</span><span id="spdv">—</span></div>
        <input id="spd" type="range" min="0" max="255" value="128" oninput="spdLive(this.value)" onchange="setSpd(this.value)">
      </div>
      <div style="margin-top:8px">
        <div class="lbl"><span>🔥 Интенсивность</span><span id="intv">—</span></div>
        <input id="inten" type="range" min="0" max="255" value="128" oninput="intenLive(this.value)" onchange="setInten(this.value)">
      </div>
    </div>
    <div class="card">
      <p class="t">⏱ Таймер выключения <span id="tmrLampS" style="float:right;text-transform:none;color:var(--mut)">выкл</span></p>
      <div class="fxg" style="grid-template-columns:repeat(3,1fr)">
        <button class="fx press" onclick="tmr('lamp',15)">15 мин</button>
        <button class="fx press" onclick="tmr('lamp',30)">30 мин</button>
        <button class="fx press" onclick="tmr('lamp',45)">45 мин</button>
        <button class="fx press" onclick="tmr('lamp',60)">1 час</button>
        <button class="fx press" onclick="tmr('lamp',120)">2 часа</button>
        <button class="fx press" onclick="tmr('lamp',0)">⛔ Отмена</button>
      </div>
    </div>
  </div>

  <!-- ================= ТЕЛЕВИЗОР ================= -->
  <div class="page" id="tv">
    <h1>📺 <span id="tvname">Samsung TV</span></h1>
    <div class="sub" id="tvstatus" style="margin-bottom:14px">Настрой телевизор ниже</div>

    <div class="card setup" id="tvsetup">
      <div class="row">
        <input id="tvip" placeholder="IP телевизора, напр. 192.168.1.111" inputmode="decimal">
        <button class="go press" onclick="saveTvIp()">OK</button>
      </div>
      <button class="wide press" onclick="scanTv()">📡 Найти телевизоры в сети</button>
      <button class="wide press" onclick="detectTv()">🔍 Проверить по IP</button>
      <div id="tvlist"></div>
      <div class="hint" id="tvinfo">Нет пульта? Нажми «Найти телевизоры» — IP подставится сам.</div>
    </div>

    <!-- сам пульт -->
    <div id="remote">
      <div class="toprow">
        <button class="rbtn pw press" onclick="tvPower(true)"><span class="ic">🟢</span>Включить</button>
        <button class="rbtn press" onclick="tvPower(false)"><span class="ic">⚫</span>Выключить</button>
        <button class="rbtn press" onclick="tv('KEY_MUTE')"><span class="ic">🔇</span>Звук</button>
      </div>
      <div class="toprow">
        <button class="rbtn press" onclick="tv('KEY_POWER')"><span class="ic">⏻</span>Toggle</button>
        <button class="rbtn press" onclick="tv('KEY_SOURCE')"><span class="ic">⤵️</span>Источник</button>
        <button class="rbtn press" onclick="ytBrowser()"><span class="ic">🌐</span>YouTube</button>
      </div>

      <div class="center">
        <div class="rocker">
          <button class="press" onclick="tv('KEY_VOLUP')">＋</button>
          <div class="mid">VOL</div>
          <button class="press" onclick="tv('KEY_VOLDOWN')">－</button>
        </div>
        <div class="dpad">
          <button class="nav u press" onclick="tv('KEY_UP')">▲</button>
          <button class="nav l press" onclick="tv('KEY_LEFT')">◀</button>
          <button class="ok press" onclick="tv('KEY_ENTER')">OK</button>
          <button class="nav r press" onclick="tv('KEY_RIGHT')">▶</button>
          <button class="nav d press" onclick="tv('KEY_DOWN')">▼</button>
        </div>
        <div class="rocker">
          <button class="press" onclick="tv('KEY_CHUP')">＋</button>
          <div class="mid">CH</div>
          <button class="press" onclick="tv('KEY_CHDOWN')">－</button>
        </div>
      </div>

      <div class="row3">
        <button class="b press" onclick="tv('KEY_RETURN')">↩️ Назад</button>
        <button class="b press" onclick="tv('KEY_HOME')">🏠 Smart Hub</button>
        <button class="b press" onclick="tv('KEY_EXIT')">✕ Выход</button>
      </div>
      <div class="row3">
        <button class="b press" onclick="tv('KEY_MENU')">☰ Меню</button>
        <button class="b press" onclick="tv('KEY_INFO')">ℹ️ Инфо</button>
        <button class="b press" onclick="tv('KEY_GUIDE')">📕 Гид</button>
      </div>

      <div class="card" style="margin-top:14px">
        <p class="t">Приложения</p>
        <div class="setup" style="margin-bottom:10px">
          <div class="row">
            <input id="ytq" placeholder="🔎 Найти на YouTube и включить…" onkeydown="if(event.key==='Enter')ytPlay()">
            <button class="go press" onclick="ytPlay()">▶</button>
          </div>
        </div>
        <div class="apps" id="appgrid">
          <button class="app yt press" onclick="app('111299001912')">▶ YouTube</button>
          <button class="app nf press" onclick="app('3201907018807')">N Netflix</button>
        </div>
        <button class="wide press" style="margin-top:10px;background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:14px;padding:12px;font-weight:700" onclick="loadApps()">🔄 Загрузить мои приложения с ТВ</button>
        <div class="hint">Нужны другие приложения? Нажми «Загрузить мои приложения с ТВ».</div>
      </div>

      <div class="card">
        <p class="t" onclick="toggleNums()" style="cursor:pointer">🔢 Цифры ▾</p>
        <div class="collapse" id="nums">
          <div class="pad3">
            <button class="num press" onclick="tv('KEY_1')">1</button>
            <button class="num press" onclick="tv('KEY_2')">2</button>
            <button class="num press" onclick="tv('KEY_3')">3</button>
            <button class="num press" onclick="tv('KEY_4')">4</button>
            <button class="num press" onclick="tv('KEY_5')">5</button>
            <button class="num press" onclick="tv('KEY_6')">6</button>
            <button class="num press" onclick="tv('KEY_7')">7</button>
            <button class="num press" onclick="tv('KEY_8')">8</button>
            <button class="num press" onclick="tv('KEY_9')">9</button>
            <button class="num press" onclick="tv('KEY_PRECH')">⏮CH</button>
            <button class="num press" onclick="tv('KEY_0')">0</button>
            <button class="num press" onclick="tv('KEY_CH_LIST')">📋</button>
          </div>
        </div>
      </div>

      <div class="card">
        <p class="t">⏱ Таймер выключения <span id="tmrTvS" style="float:right;text-transform:none;color:var(--mut)">выкл</span></p>
        <div class="fxg" style="grid-template-columns:repeat(3,1fr)">
          <button class="fx press" onclick="tmr('tv',15)">15 мин</button>
          <button class="fx press" onclick="tmr('tv',30)">30 мин</button>
          <button class="fx press" onclick="tmr('tv',60)">1 час</button>
          <button class="fx press" onclick="tmr('tv',120)">2 часа</button>
          <button class="fx press" onclick="tmr('tv',180)">3 часа</button>
          <button class="fx press" onclick="tmr('tv',0)">⛔ Отмена</button>
        </div>
      </div>

      <div class="row3">
        <button class="b press" onclick="document.getElementById('tvsetup').scrollIntoView({behavior:'smooth'})">⚙️ Настройка</button>
        <button class="b press" onclick="showTab('lamp')">💡 Лампа</button>
        <button class="b press" onclick="scanTv()">🔄 Найти</button>
      </div>
    </div>
  </div>
</div>
<button class="mic" id="mic" onclick="voiceStart()" title="Голос">🎤</button>
<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
let toastT;
function toast(msg){ const e=$("toast"); e.textContent=msg; e.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>e.classList.remove("show"),1400); }
function buzz(){ if(navigator.vibrate) navigator.vibrate(8); }
function showTab(t){
  ["lamp","tv"].forEach(p=>$(p).classList.toggle("active",p===t));
  $("tabLamp").classList.toggle("active", t==="lamp");
  $("tabTv").classList.toggle("active", t==="tv");
  if(t==="lamp"){ placeThumb(); }
}
function toggleNums(){ $("nums").classList.toggle("open"); }

/* ---------- Лампа ---------- */
const COLORS = [
  ["#ff0000",[255,0,0]],["#ff5a00",[255,90,0]],["#ffc800",[255,200,0]],
  ["#00ff00",[0,255,0]],["#00c8ff",[0,200,255]],["#1414ff",[0,0,255]],
  ["#9600ff",[150,0,255]],["#ff0096",[255,0,150]],["#ffaa50",[255,170,80]],["#ffffff",[255,255,255]]
];
const SCENES = [
  ["📖","Чтение",   {on:true,bri:255,seg:[{fx:0,col:[[255,214,170]]}]}],
  ["🎬","Кино",     {on:true,bri:55, seg:[{fx:0,col:[[255,140,60]]}]}],
  ["🌅","Закат",    {on:true,bri:180,seg:[{fx:2,col:[[255,80,0]]}]}],
  ["🎉","Вечеринка",{on:true,bri:230,seg:[{fx:9,sx:200,col:[[255,0,150]]}]}],
  ["💚","Релакс",   {on:true,bri:110,seg:[{fx:2,sx:60,col:[[0,200,120]]}]}],
  ["🌙","Ночник",   {on:true,bri:14, seg:[{fx:0,col:[[255,150,70]]}]}],
];
let FXLIST = [["Статичный",0],["Дыхание",2],["Перелив",8],["Радуга",9],
  ["Звёзды",67],["Аврора",38],["Молния",57],["Pacifica",101]];
let state = {on:false, bri:128, offline:false};
function _seg0(){ if(!state.seg)state.seg=[{}]; if(!state.seg[0])state.seg[0]={}; return state.seg[0]; }
function _sx(){ const s=state.seg&&state.seg[0]; return (s&&s.sx!=null)?s.sx:128; }
function _ix(){ const s=state.seg&&state.seg[0]; return (s&&s.ix!=null)?s.ix:128; }
function _fx(){ const s=state.seg&&state.seg[0]; return (s&&s.fx!=null)?s.fx:0; }
function applyUI(){
  const on=!!state.on, bri=state.bri||0, pct=Math.round(bri/255*100);
  $("dot").className="dot "+(state.offline?"off":(on?"on":"off"));
  $("status").textContent=state.offline?"⚠️ Лампа недоступна":(on?("Включено · "+pct+"%"):"Выключено");
  $("power").textContent=on?"⏻ Выключить":"⏻ Включить";
  $("power").className="power press"+(on?"":" off");
  $("bri").value=bri; briLive(bri);
  $("spd").value=_sx(); spdLive(_sx()); $("inten").value=_ix(); intenLive(_ix());
  paintBulb(); placeThumb(); markFx(); markSwatch();
}
function curRGB(){ try{ const c=state.seg[0].col[0]; return [c[0]|0,c[1]|0,c[2]|0]; }catch(e){ return [255,210,127]; } }
function curColor(){ const c=curRGB(); return "rgb("+c[0]+","+c[1]+","+c[2]+")"; }
function paintBulb(){ const b=$("bulb"); if(!b) return;
  const on=!!state.on && !state.offline;
  b.style.setProperty("--lc", curColor());
  b.classList.toggle("off", !on);
  b.style.setProperty("--lb", on ? (0.12+(state.bri||0)/255*0.88).toFixed(2) : "0"); }
function briLive(v){ $("briv").textContent=Math.round(v/255*100)+"%"; $("bri").style.setProperty("--p",(v/255*100)+"%");
  const b=$("bulb"); if(b && !state.offline){ b.classList.remove("off");
    b.style.setProperty("--lb",(0.12+v/255*0.88).toFixed(2)); } }
function spdLive(v){ $("spdv").textContent=Math.round(v/255*100)+"%"; $("spd").style.setProperty("--p",(v/255*100)+"%"); }
function intenLive(v){ $("intv").textContent=Math.round(v/255*100)+"%"; $("inten").style.setProperty("--p",(v/255*100)+"%"); }
function cmd(p){ fetch("/api/cmd",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).catch(()=>{}); }
function toggle(){ buzz(); state.on=!state.on; state.offline=false; applyUI(); cmd({on:state.on}); }
function setBri(v){ state.on=true; state.bri=parseInt(v); state.offline=false; applyUI(); cmd({on:true,bri:parseInt(v)}); }
function setSpd(v){ _seg0().sx=parseInt(v); state.offline=false; applyUI(); cmd({seg:[{sx:parseInt(v)}]}); }
function setInten(v){ _seg0().ix=parseInt(v); state.offline=false; applyUI(); cmd({seg:[{ix:parseInt(v)}]}); }
function setColor(rgb){ buzz(); state.on=true; state.offline=false;
  _seg0().col=[rgb]; applyUI(); cmd({on:true,seg:[{col:[rgb]}]}); }
function setFx(idx){ buzz(); state.on=true; state.offline=false; _seg0().fx=idx; applyUI(); cmd({on:true,seg:[{fx:idx}]}); }
function applyScene(p){ buzz(); state.on=true; state.offline=false;
  state.bri=p.bri; const s=p.seg[0]; const t=_seg0();
  if(s.col)t.col=s.col; if(s.fx!=null)t.fx=s.fx; if(s.sx!=null)t.sx=s.sx;
  applyUI(); cmd(p); }

/* --- HSV ↔ RGB --- */
function hsv2rgb(h,s,v){ h=(h%360+360)%360; const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r,g,b; if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]; }
function rgb2hsv(r,g,b){ r/=255;g/=255;b/=255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0; if(d){ if(mx===r)h=60*(((g-b)/d)%6); else if(mx===g)h=60*((b-r)/d+2); else h=60*((r-g)/d+4); }
  return [(h+360)%360, mx?d/mx:0, mx]; }

/* --- цветовое колесо --- */
let wheelSendT=0;
function wheelPick(ev){ const w=$("wheel"); const rc=w.getBoundingClientRect();
  const cx=rc.left+rc.width/2, cy=rc.top+rc.height/2, R=rc.width/2-6;
  const pt=ev.touches?ev.touches[0]:ev; let dx=pt.clientX-cx, dy=pt.clientY-cy;
  let dist=Math.hypot(dx,dy); if(dist>R){ dx*=R/dist; dy*=R/dist; dist=R; }
  const hue=(Math.atan2(dy,dx)*180/Math.PI+90+360)%360, sat=Math.min(1,dist/R);
  const rgb=hsv2rgb(hue,sat,1);
  state.on=true; state.offline=false; _seg0().col=[rgb];
  paintBulb(); placeThumb(); markSwatch();
  const now=Date.now(); if(now-wheelSendT>110){ wheelSendT=now; cmd({on:true,seg:[{col:[rgb]}]}); } }
function placeThumb(){ const w=$("wheel"), th=$("wthumb"); if(!w||!th||!w.clientWidth) return;
  const R=w.clientWidth/2-6, c=curRGB(), hsv=rgb2hsv(c[0],c[1],c[2]);
  const ang=(hsv[0]-90)*Math.PI/180, d=hsv[1]*R;
  th.style.left=(w.clientWidth/2+Math.cos(ang)*d)+"px";
  th.style.top=(w.clientHeight/2+Math.sin(ang)*d)+"px";
  th.style.background="rgb("+c[0]+","+c[1]+","+c[2]+")";
  w.classList.toggle("off", !state.on || state.offline); }
function initWheel(){ const w=$("wheel"); let down=false;
  const start=e=>{ down=true; buzz(); wheelPick(e); e.preventDefault(); };
  const move=e=>{ if(down){ wheelPick(e); e.preventDefault(); } };
  const end=()=>{ if(down){ down=false; cmd({on:true,seg:[{col:[curRGB()]}]}); } };
  w.addEventListener("touchstart",start,{passive:false});
  w.addEventListener("touchmove",move,{passive:false});
  w.addEventListener("touchend",end);
  w.addEventListener("mousedown",start);
  window.addEventListener("mousemove",move);
  window.addEventListener("mouseup",end); }

/* --- быстрые образцы / сцены / эффекты --- */
function buildColors(){ const box=$("colors"); box.innerHTML="";
  COLORS.forEach(c=>{ const b=document.createElement("button");
    b.className="sw press"; b.style.background=c[0]; b.dataset.rgb=c[1].join(",");
    b.onclick=()=>setColor(c[1]); box.appendChild(b); }); }
function markSwatch(){ const c=curRGB().join(",");
  document.querySelectorAll("#colors .sw").forEach(b=>b.classList.toggle("wsel", b.dataset.rgb===c)); }
function buildScenes(){ const box=$("scenes"); box.innerHTML="";
  SCENES.forEach(s=>{ const b=document.createElement("button"); b.className="scene press";
    b.innerHTML='<span class="se">'+s[0]+'</span>'+s[1]; b.onclick=()=>applyScene(s[2]); box.appendChild(b); }); }
function buildFx(){ const box=$("fx"); box.innerHTML=""; const q=($("fxsearch").value||"").toLowerCase().trim();
  FXLIST.forEach(f=>{ if(q && !f[0].toLowerCase().includes(q)) return;
    const b=document.createElement("button"); b.className="fxchip press"; b.textContent=f[0];
    b.dataset.fx=f[1]; b.onclick=()=>setFx(f[1]); box.appendChild(b); });
  markFx(); }
function filterFx(){ buildFx(); }
function markFx(){ const cur=String(_fx());
  document.querySelectorAll("#fx .fxchip").forEach(b=>b.classList.toggle("sel", b.dataset.fx===cur)); }
async function loadEffects(){
  try{ const r=await fetch("/api/effects"); if(!r.ok) throw 0; const d=await r.json();
    const ef=d.effects||[]; if(ef.length>3){
      FXLIST = ef.map((n,i)=>[n,i]).filter(p=>p[0] && p[0]!=="RSVD");
      buildFx(); } }
  catch(e){}
}
async function refresh(){
  try{ const r=await fetch("/api/state"); if(!r.ok) throw 0; const s=await r.json(); s.offline=false; state=s; }
  catch(e){ state.offline=true; }
  applyUI();
}

/* ---------- ТВ ---------- */
const PROTO={"ws-token":"WebSocket+токен (2018+)","ws":"WebSocket (2016-17)","legacy":"Legacy (2014-15)","encrypted":"Шифрованный (PIN)"};
function showRemote(on){ $("remote").style.display = on?"block":"none"; }
async function tv(key){
  buzz();
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); showTab('tv'); return; }
  try{
    const r=await fetch("/api/tv",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
    if(r.ok){ toast("✓ "+key.replace("KEY_","").replace(/_$/,"")); }
    else{ const d=await r.json().catch(()=>({})); toast("⚠️ "+(d.error?"нет связи":"нет связи с ТВ")); }
  }catch(e){ toast("⚠️ нет связи с ТВ"); }
}
async function app(id){
  buzz();
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); return; }
  toast("Запускаю…");
  try{ const r=await fetch("/api/tvapp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app:id})});
    toast(r.ok?"✓ Запущено":"⚠️ Не вышло (нужен WebSocket-ТВ)"); }
  catch(e){ toast("⚠️ нет связи"); }
}
async function tvPower(on){
  buzz();
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); return; }
  toast(on?"🟢 Включаю…":"⚫ Выключаю…");
  try{ const r=await fetch("/api/tvpower",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({on})});
    toast(r.ok?(on?"✓ Включено":"✓ Выключено"):"⚠️ Нет связи с ТВ"); }
  catch(e){ toast("⚠️ нет связи"); }
}
async function ytBrowser(){
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); return; }
  const q=prompt("Что открыть на YouTube? (пусто — просто YouTube)");
  if(q===null) return;
  buzz(); toast("🌐 Открываю в браузере ТВ…");
  try{ const r=await fetch("/api/tvbrowser",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(q.trim()? {query:q.trim()} : {url:"https://m.youtube.com"})});
    toast(r.ok?"✓ Открыто в браузере":"⚠️ Не вышло (нужен WebSocket-ТВ)"); }
  catch(e){ toast("⚠️ нет связи"); }
}
async function ytPlay(){
  const q=($("ytq").value||"").trim();
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); showTab('tv'); return; }
  if(!q){ toast("Напиши, что искать"); return; }
  buzz(); toast("▶️ Ищу и включаю: "+q);
  try{ const r=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text:"включи на ютубе "+q})});
    const d=await r.json().catch(()=>({})); toast(d.msg||(r.ok?"✓ Готово":"⚠️ Не вышло")); }
  catch(e){ toast("⚠️ нет связи"); }
}
const APPSTYLE=[["youtube","linear-gradient(135deg,#ff3d3d,#cc0000)"],["netflix","linear-gradient(135deg,#e50914,#7a060d)"],
  ["prime","linear-gradient(135deg,#00b3ff,#0066cc)"],["spotify","linear-gradient(135deg,#1db954,#11833c)"],
  ["кинопоиск","linear-gradient(135deg,#ff6b00,#cc4400)"],["twitch","linear-gradient(135deg,#9147ff,#6441a5)"],
  ["окко","linear-gradient(135deg,#7c5cff,#5a3ad6)"],["ivi","linear-gradient(135deg,#ff2d55,#c01e3c)"]];
function appStyle(name){ const n=(name||"").toLowerCase();
  for(const[k,g]of APPSTYLE){ if(n.includes(k)) return g; } return "var(--card2)"; }
async function loadApps(){
  if(!$("tvip").value.trim()){ toast("⚠️ Введи IP телевизора"); showTab('tv'); return; }
  toast("🔄 Читаю приложения с ТВ…");
  try{ const r=await fetch("/api/tvapps"); const d=await r.json(); const apps=d.apps||[];
    if(!apps.length){ toast("Пусто — нужен включённый ТВ и WebSocket"); return; }
    const g=$("appgrid"); g.innerHTML="";
    apps.forEach(a=>{ const b=document.createElement("button"); b.className="app press";
      const st=appStyle(a.name); b.style.background=st; if(st==="var(--card2)") b.style.border="1px solid var(--line)";
      b.textContent=a.name; b.onclick=()=>app(a.appId); g.appendChild(b); });
    toast("✓ Приложений: "+apps.length); }
  catch(e){ toast("⚠️ Не вышло (нужен WebSocket-ТВ)"); }
}
async function saveTvIp(){
  const ip=$("tvip").value.trim();
  await fetch("/api/tvconfig",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip})}).catch(()=>{});
  $("tvstatus").textContent=ip?("IP сохранён: "+ip):"Введи IP телевизора";
  showRemote(!!ip);
}
async function detectTv(){
  const ip=$("tvip").value.trim();
  if(!ip){ toast("⚠️ Сначала введи IP"); return; }
  await fetch("/api/tvconfig",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip})}).catch(()=>{});
  $("tvstatus").textContent="🔍 Определяю…";
  try{ const r=await fetch("/api/tvdetect",{method:"POST"}); const d=await r.json();
    if(r.ok&&d.method){ $("tvstatus").textContent="✅ ТВ готов"; if(d.model)$("tvname").textContent=d.model;
      $("tvinfo").textContent=(d.model?d.model+" · ":"")+"протокол: "+(PROTO[d.method]||d.method); showRemote(true);
    } else $("tvstatus").textContent="⚠️ ТВ не найден — проверь IP и что ТВ включён";
  }catch(e){ $("tvstatus").textContent="⚠️ Ошибка определения"; }
}
async function scanTv(){
  $("tvstatus").textContent="📡 Ищу телевизоры… (3 сек)"; $("tvlist").innerHTML="";
  try{ const r=await fetch("/api/tvscan"); const d=await r.json(); const tvs=d.tvs||[];
    if(!tvs.length){ $("tvstatus").textContent="Не найдено — введи IP вручную"; return; }
    tvs.forEach(t=>{ const b=document.createElement("button");
      b.className="wide press"; b.textContent="📺 "+(t.model||t.name||"Samsung")+" — "+t.ip;
      b.onclick=()=>{ $("tvip").value=t.ip; saveTvIp(); detectTv(); };
      $("tvlist").appendChild(b); });
    $("tvstatus").textContent="Найдено: "+tvs.length+" — выбери свой";
  }catch(e){ $("tvstatus").textContent="⚠️ Ошибка поиска"; }
}
async function loadTvIp(){
  try{ const r=await fetch("/api/tvconfig"); const d=await r.json();
    if(d.ip){ $("tvip").value=d.ip; showRemote(true);
      $("tvstatus").textContent=d.method?"ТВ готов":("ТВ: "+d.ip);
      if(d.model)$("tvname").textContent=d.model;
      if(d.method)$("tvinfo").textContent=(d.model?d.model+" · ":"")+"протокол: "+(PROTO[d.method]||d.method);
    } else showRemote(false);
  }catch(e){ showRemote(false); }
}

/* ---------- Таймеры ---------- */
function tmrApply(d){
  if($("tmrLampS")) $("tmrLampS").textContent = d.lamp ? ("через "+d.lamp+" мин") : "выкл";
  if($("tmrTvS")) $("tmrTvS").textContent = d.tv ? ("через "+d.tv+" мин") : "выкл";
}
async function tmr(kind, mins){
  buzz();
  try{ const r=await fetch("/api/timer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,minutes:mins})});
    tmrApply(await r.json()); toast(mins ? ("⏱ "+(kind==='lamp'?'Лампа':'ТВ')+" — "+mins+" мин") : "Таймер снят"); }
  catch(e){ toast("⚠️ Ошибка"); }
}
async function tmrStatus(){ try{ const r=await fetch("/api/timer"); tmrApply(await r.json()); }catch(e){} }

/* ---------- Голос ---------- */
function voiceStart(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ const t=prompt("Скажи команду текстом (распознавание недоступно):"); if(t) voiceSend(t); return; }
  const r = new SR(); r.lang="ru-RU"; r.interimResults=false; r.maxAlternatives=1;
  $("mic").classList.add("rec"); toast("🎤 Слушаю…");
  r.onresult = e => { const t=e.results[0][0].transcript; toast("«"+t+"»"); voiceSend(t); };
  r.onerror = () => { $("mic").classList.remove("rec"); toast("⚠️ Не расслышал"); };
  r.onend = () => $("mic").classList.remove("rec");
  try{ r.start(); }catch(e){ $("mic").classList.remove("rec"); toast("⚠️ Микрофон недоступен"); }
}
async function voiceSend(text){
  try{ const r=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
    const d=await r.json(); toast(d.msg||"Готово"); refresh(); }
  catch(e){ toast("⚠️ Ошибка"); }
}

buildColors(); buildScenes(); buildFx(); initWheel();
refresh(); loadEffects(); loadTvIp(); tmrStatus();
setInterval(()=>{ refresh(); tmrStatus(); }, 3000);
</script>
</body>
</html>"""


class _Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/api/state":
            try:
                self._send(200, _lamp_get("/json/state"))
            except Exception:
                self._send(502, b'{"error":"offline"}')
        elif self.path == "/api/effects":
            try:
                d = json.loads(_lamp_get("/json"))
                self._send(200, json.dumps(
                    {"effects": d.get("effects", []), "palettes": d.get("palettes", [])},
                    ensure_ascii=False).encode())
            except Exception:
                self._send(502, b'{"error":"offline"}')
        elif self.path == "/api/tvconfig":
            try:
                self._send(200, json.dumps(
                    {"ip": _TV.get("ip", ""), "method": _TV.get("method", ""),
                     "name": _TV.get("name", ""), "model": _TV.get("model", "")}).encode())
            except Exception:
                self._send(502, b'{"error":"cfg"}')
        elif self.path == "/api/tvscan":
            try:
                tvs = tvremote.discover(3.0)
                self._send(200, json.dumps({"tvs": tvs}, ensure_ascii=False).encode())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/tvapps":
            try:
                apps = tvremote.list_apps()
                self._send(200, json.dumps({"apps": apps}, ensure_ascii=False).encode())
            except Exception:
                self._send(200, b'{"apps":[]}')
        elif self.path == "/api/timer":
            self._send(200, json.dumps(
                {"lamp": timers.remaining("lamp"), "tv": timers.remaining("tv")}).encode())
        elif self.path == "/manifest.json":
            self._send(200, MANIFEST.encode("utf-8"), "application/manifest+json; charset=utf-8")
        elif self.path in ("/icon.png", "/apple-touch-icon.png",
                           "/apple-touch-icon-precomposed.png"):
            try:
                self._send(200, _asset_bytes("icon-512.png"), "image/png")
            except Exception:
                self._send(404, b"", "text/plain")
        elif self.path in ("/icon-192.png", "/icon-512.png", "/cover.png"):
            try:
                self._send(200, _asset_bytes(self.path.lstrip("/")), "image/png")
            except Exception:
                self._send(404, b"", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path == "/api/cmd":
            try:
                self._send(200, _lamp_post("/json/state", self._body()))
            except Exception:
                self._send(502, b'{"error":"offline"}')
        elif self.path == "/api/tvconfig":
            try:
                ip = (json.loads(self._body() or b"{}").get("ip") or "").strip()
                _TV.update(ip=ip, method="", mac="", name="", model="")
                tvremote.save_config()
                self._send(200, json.dumps({"ip": _TV["ip"]}).encode())
            except Exception:
                self._send(400, b'{"error":"bad"}')
        elif self.path == "/api/tvdetect":
            try:
                if not _TV["ip"]:
                    self._send(400, b'{"error":"no_ip"}'); return
                info = tvremote.detect(_TV["ip"])
                _TV.update(method=info.get("method") or "", mac=info.get("mac", ""),
                           name=info.get("name", ""), model=info.get("model", ""))
                tvremote.save_config()
                ok = bool(_TV["method"])
                self._send(200 if ok else 502, json.dumps(
                    {"method": _TV["method"], "name": _TV["name"],
                     "model": _TV["model"]}).encode())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/tv":
            try:
                key = json.loads(self._body() or b"{}").get("key", "")
                if not _TV["ip"]:
                    self._send(400, b'{"error":"no_ip"}'); return
                if key == "KEY_POWER" and _TV.get("mac"):
                    try:
                        tvremote.wake_on_lan(_TV["mac"])
                    except Exception:
                        pass
                method = tvremote.send_key(_TV["ip"], key, _TV["method"] or None)
                if method and method != _TV["method"]:
                    _TV["method"] = method
                    tvremote.save_config()
                self._send(200, json.dumps({"ok": True, "method": method}).encode())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/tvapp":
            try:
                app_id = json.loads(self._body() or b"{}").get("app", "")
                if not _TV["ip"]:
                    self._send(400, b'{"error":"no_ip"}'); return
                tvremote.run_app(_TV["ip"], app_id, _TV["method"] or None)
                self._send(200, b'{"ok":true}')
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/tvpower":
            try:
                if not _TV["ip"]:
                    self._send(400, b'{"error":"no_ip"}'); return
                on = bool(json.loads(self._body() or b"{}").get("on"))
                ok = tvremote.power(on)
                self._send(200 if ok else 502, json.dumps({"ok": ok}).encode())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/tvbrowser":
            try:
                if not _TV["ip"]:
                    self._send(400, b'{"error":"no_ip"}'); return
                d = json.loads(self._body() or b"{}")
                q = (d.get("query") or "").strip()
                url = d.get("url") or (
                    "https://m.youtube.com/results?search_query=" + urllib.parse.quote(q)
                    if q else "https://www.google.com")
                ok = tvremote.open_browser(url, _TV["method"] or None)
                self._send(200 if ok else 502, json.dumps({"ok": ok}).encode())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/timer":
            try:
                d = json.loads(self._body() or b"{}")
                kind = d.get("kind")
                if kind in ("lamp", "tv"):
                    timers.set_timer(kind, d.get("minutes", 0))
                self._send(200, json.dumps(
                    {"lamp": timers.remaining("lamp"), "tv": timers.remaining("tv")}).encode())
            except Exception:
                self._send(400, b'{"error":"bad"}')
        elif self.path == "/api/voice":
            try:
                text = json.loads(self._body() or b"{}").get("text", "")
                ok, msg = voice.handle(text)
                self._send(200, json.dumps({"ok": ok, "msg": msg}, ensure_ascii=False).encode())
            except Exception as e:
                self._send(502, json.dumps({"ok": False, "msg": str(e)}).encode())
        else:
            self._send(404, b"not found", "text/plain")

    def log_message(self, *a):
        pass


def serve(wled_ip: str, port: int = 8080):
    """Запустить веб-сервер в фоне. Возвращает (thread, server)."""
    global _IP
    _IP = wled_ip
    tvremote.load_config()
    timers.init(wled_ip)
    voice.init(wled_ip)
    srv = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return t, srv
