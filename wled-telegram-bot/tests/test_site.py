#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты единого сайта site/: фейковый API (контракт intellect/web) + Playwright.

Основной сценарий 2.4.0 — сайт отдаёт сам бот (same-origin, только дома). Логика
экранов проверяется и с сайтом на ДРУГОМ порту (адрес API введён вручную) —
фейковый API это разрешает. Проверяется, что сайт не ходит ни на какие внешние адреса.
Если Playwright/Chromium недоступны — тест честно пропускается (0 fail).
"""
import os, sys, json, threading, time, shutil, tempfile, socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


# ----------------------------------------------------------------- фейковый API
PASSWORD = "secret-123"
CALLS = []          # (method, path, body)

LAMP = {"on": False, "bri": 128, "seg": [{"col": [[255, 170, 80]], "fx": 0, "sx": 128, "ix": 128, "pal": 0}]}
TV = {"ip": "", "method": "", "name": "", "model": "", "configured": False}
TIMERS = {"lamp": 0, "tv": 0}
PENDING = {"v": False}


def _deep_update(dst, src):
    for k, v in src.items():
        if k == "seg" and isinstance(v, list) and v:
            for kk, vv in v[0].items():
                dst["seg"][0][kk] = vv
        elif k == "on" and v == "t":
            dst["on"] = not dst["on"]
        else:
            dst[k] = v


class FakeAPI(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _cors(self):
        o = self.headers.get("Origin")
        if o:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Intellect-Token")

    def _send(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors(); self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Content-Length", "0"); self._cors(); self.end_headers()

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception: return {}

    def _auth(self):
        if self.headers.get("X-Intellect-Token") == PASSWORD:
            return True
        self._send(401, {"error": "unauthorized"}); return False

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/ping":
            return self._send(200, {"ok": True, "app": "INTELLECT", "auth": True, "version": "2.3.0-test"})
        if not self._auth(): return
        CALLS.append(("GET", p, None))
        if p == "/api/devices":
            return self._send(200, {"devices": {
                "lamp": {"online": True, "on": LAMP["on"], "brightness": round(LAMP["bri"] / 255 * 100), "color": LAMP["seg"][0]["col"][0], "effect": LAMP["seg"][0]["fx"], "name": "Лампа"},
                "tv": {"online": bool(TV["ip"]), "ip": TV["ip"], "method": TV["method"], "model": TV["model"], "configured": bool(TV["ip"])}}})
        if p == "/api/lamp/state":
            return self._send(200, {"online": True, "state": LAMP, "effects": ["Solid", "Blink", "Breathe", "Wipe", "RSVD", "Rainbow"], "palettes": ["Default", "Party"]})
        if p == "/api/timer": return self._send(200, dict(TIMERS))
        if p == "/api/tv/config": return self._send(200, dict(TV))
        if p == "/api/tv/scan":
            time.sleep(0.3)
            return self._send(200, {"tvs": [{"ip": "192.168.1.106", "name": "[TV] Samsung", "model": "UE55NU7093", "method": "ws-token"}]})
        if p == "/api/tv/apps": return self._send(200, {"apps": [{"id": "111299001912", "name": "YouTube"}, {"id": "x", "name": "Spotify"}]})
        if p == "/api/memory": return self._send(200, {"items": [{"id": 1, "content": "выключать свет в 23:00", "kind": "fact"}]})
        if p == "/api/automations": return self._send(200, {"items": [{"id": 5, "name": "Вечер", "trigger_type": "cron", "trigger_spec": "0 23 * * *", "enabled": True, "last_run": None}]})
        if p == "/api/tasks": return self._send(200, {"items": [{"id": 9, "title": "купить лампочки", "status": "open"}]})
        if p == "/api/system":
            return self._send(200, {"host": "Zmey32", "os": "Windows-10", "cpu": {"percent": 12.5, "cores": 2}, "ram": {"percent": 69.9, "used_gb": 2.7, "total_gb": 3.9},
                                    "disks": {"C:\\": {"percent": 52, "free_gb": 45.1}, "E:\\": {"percent": 75, "free_gb": 94.2}}, "uptime_hours": 4117.3})
        if p == "/api/status": return self._send(200, {"ai": {"available": True, "model_fast": "gpt-4o-mini", "provider": "openai"}, "voice": {"listen": True, "speak": True}, "automations_active": 1, "tasks_open": 1})
        if p == "/api/panel": return self._send(200, {"lan_url": "http://192.168.1.107:8090", "password_required": True})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        if not self._auth(): return
        b = self._body(); CALLS.append(("POST", p, b))
        if p == "/api/lamp/raw":
            _deep_update(LAMP, b); return self._send(200, {"ok": True, "state": LAMP})
        if p == "/api/devices/command":
            if b.get("command", {}).get("action") == "scene": LAMP["on"] = True
            return self._send(200, {"ok": True})
        if p == "/api/timer":
            TIMERS[b.get("kind", "lamp")] = int(b.get("minutes", 0)) * 60; return self._send(200, dict(TIMERS))
        if p == "/api/tv/config":
            TV.update(ip=b.get("ip", ""), method="ws-token", name="[TV] Samsung", model="UE55NU7093", configured=True); return self._send(200, dict(TV))
        if p in ("/api/tv/key", "/api/tv/power", "/api/tv/app", "/api/tv/browser", "/api/automations/toggle", "/api/automations/delete", "/api/tasks/add", "/api/tasks/done"):
            return self._send(200, {"ok": True})
        if p == "/api/memory": return self._send(200, {"id": 2})
        if p == "/api/chat":
            t = b.get("text", "")
            if "перезагруз" in t:
                PENDING["v"] = True
                return self._send(200, {"reply": "Подтверди действие: computer_restart", "pending_confirmation": ["computer_restart"], "did_actions": False})
            return self._send(200, {"reply": f"Ответ на: {t}", "pending_confirmation": [], "did_actions": False})
        if p == "/api/chat/confirm":
            PENDING["v"] = False; return self._send(200, {"reply": "⏳ Перезагрузка через 20 с", "did_actions": True})
        if p == "/api/chat/cancel":
            PENDING["v"] = False; return self._send(200, {"reply": "Отменено ✖️"})
        self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._auth(): return
        CALLS.append(("DELETE", self.path, self._body())); self._send(200, {"ok": True})


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()


def serve(handler_factory):
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler_factory)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}"


def calls(method, path):
    return [c for c in CALLS if c[0] == method and c[1] == path]


def main():
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(f"  ⚠️ Playwright недоступен ({e!r}) — тесты сайта пропущены")
        print("\nИТОГ: 0 ok, 0 fail"); return 0

    api_srv, api_url = serve(FakeAPI)
    # копия site/ на другом порту — адрес API сохранён в localStorage (как после ручного входа)
    pages_dir = Path(tempfile.mkdtemp()) / "pages"
    shutil.copytree(SITE, pages_dir)
    pages_srv, pages_url = serve(partial(Quiet, directory=str(pages_dir)))
    # чистая копия — для ручного ввода адреса
    plain_dir = Path(tempfile.mkdtemp()) / "plain"
    shutil.copytree(SITE, plain_dir)
    plain_srv, plain_url = serve(partial(Quiet, directory=str(plain_dir)))

    shots = Path("/tmp/claude-0/-home-user-Npbot-/8ec8d52d-19fb-58f8-ae04-b72c9a0bc03e/scratchpad/site-shots")
    try: shots.mkdir(parents=True, exist_ok=True)
    except Exception: shots = None

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        errors = []

        def new_page(width=390, height=844):
            ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1, locale="ru-RU")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            return ctx, page

        print("[вход вручную: адрес API + пароль, сайт с другого origin]")
        ctx, page = new_page()
        page.goto(plain_url + "/index.html")
        page.wait_for_selector("#sheetBg:not(.hidden)", timeout=10000)
        check("без адреса показана шторка подключения", page.is_visible("#apiInput"))
        page.fill("#apiInput", api_url)
        page.fill("#pwdInput", "wrong")
        page.click("#btnLogin")
        page.wait_for_function("document.querySelector('#sheetErr').textContent.length > 0", timeout=10000)
        check("неверный пароль → сообщение «Неверный пароль»", "Неверный пароль" in page.text_content("#sheetErr"))
        page.fill("#pwdInput", PASSWORD)
        page.click("#btnLogin")
        page.wait_for_function("document.querySelector('#sheetBg').classList.contains('hidden')", timeout=10000)
        page.wait_for_function("document.querySelector('#lampStatus').textContent !== '—'", timeout=10000)
        check("после входа загружено состояние лампы (cross-origin)", page.text_content("#lampStatus") in ("включена", "выключена"))
        check("индикатор «на связи»", "online" in page.get_attribute("#dot", "class"))
        check("пароль сохранён в localStorage", page.evaluate("localStorage.getItem('intellect_token')") == PASSWORD)

        print("\n[свет]")
        CALLS.clear()
        page.click("#lampPower")
        page.wait_for_function("document.querySelector('#lampPower').classList.contains('on')", timeout=5000)
        raw = calls("POST", "/api/lamp/raw")
        check("кнопка питания → POST /api/lamp/raw {on:'t'}", raw and raw[-1][2].get("on") == "t")
        page.click("[data-scene='кино']")
        page.wait_for_timeout(500)
        sc = calls("POST", "/api/devices/command")
        check("сцена → devices/command scene=кино", sc and sc[-1][2] == {"device": "lamp", "command": {"action": "scene", "name": "кино"}})
        page.click("#swatches .swatch:nth-child(3)")
        page.wait_for_timeout(400)
        raw = calls("POST", "/api/lamp/raw")
        check("цвет из палитры → seg.col", raw and raw[-1][2].get("seg", [{}])[0].get("col") == [[255, 0, 0]])
        page.fill("#fxSearch", "rain")
        page.wait_for_timeout(200)
        check("поиск эффектов фильтрует список", page.locator("#effects .item").count() == 1 and "Rainbow" in page.text_content("#effects"))
        page.click("#effects .item")
        page.wait_for_timeout(400)
        raw = calls("POST", "/api/lamp/raw")
        check("эффект → seg.fx=5", raw and raw[-1][2].get("seg", [{}])[0].get("fx") == 5)
        page.click("#lampTimerBtns .btn:nth-child(2)")
        page.wait_for_timeout(400)
        tm = calls("POST", "/api/timer")
        check("таймер 30 мин → POST /api/timer", tm and tm[-1][2] == {"kind": "lamp", "minutes": 30})
        if shots:
            page.screenshot(path=str(shots / "phone-light.png"), full_page=True)

        print("\n[ТВ]")
        page.click("#tabbar [data-tab='tv']")
        page.wait_for_selector("[data-screen='tv'].active")
        page.wait_for_timeout(400)
        check("ТВ не настроен → подсказка «Найти телевизор»", page.is_visible("#tvNotSet"))
        page.click("#tvNotSet [data-act='tvscan']")
        page.wait_for_selector("#tvScanList .item", timeout=10000)
        page.click("#tvScanList .item")
        page.wait_for_function("document.querySelector('#tvNotSet').classList.contains('hidden')", timeout=5000)
        cfg = calls("POST", "/api/tv/config")
        check("выбор из поиска → POST /api/tv/config {ip}", cfg and cfg[-1][2] == {"ip": "192.168.1.106"})
        check("шапка ТВ показывает модель", "UE55NU7093" in page.text_content("#tvName"))
        CALLS.clear()
        page.click("[data-key='KEY_UP']")
        page.wait_for_timeout(300)
        k = calls("POST", "/api/tv/key")
        check("D-pad ▲ → POST /api/tv/key KEY_UP", k and k[-1][2] == {"key": "KEY_UP"})
        page.click("#numpad .btn:nth-child(5)")
        page.wait_for_timeout(300)
        check("цифра 5 → KEY_5", calls("POST", "/api/tv/key")[-1][2] == {"key": "KEY_5"})
        page.fill("#ytQuery", "котики"); page.click("#ytGo"); page.wait_for_timeout(300)
        check("YouTube-поиск → /api/tv/browser {query}", calls("POST", "/api/tv/browser")[-1][2] == {"query": "котики"})
        page.click("#tvPower"); page.wait_for_timeout(300)
        check("питание ТВ → /api/tv/power", calls("POST", "/api/tv/power") and "on" in calls("POST", "/api/tv/power")[-1][2])
        if shots:
            page.screenshot(path=str(shots / "phone-tv.png"), full_page=True)

        print("\n[ассистент]")
        page.click("#tabbar [data-tab='chat']")
        page.fill("#chatText", "включи уют"); page.click("#btnSend")
        page.wait_for_function("document.querySelector('#chat').textContent.includes('Ответ на')", timeout=10000)
        check("ответ ИИ показан", "Ответ на: включи уют" in page.text_content("#chat"))
        check("кнопок подтверждения нет", not page.is_visible("#confirmBox"))
        page.fill("#chatText", "перезагрузи комп"); page.keyboard.press("Enter")
        page.wait_for_selector("#confirmBox:not(.hidden)", timeout=10000)
        check("опасное действие → кнопки Подтвердить/Отмена", page.is_visible("#btnConfirm"))
        page.click("#btnConfirm")
        page.wait_for_function("document.querySelector('#chat').textContent.includes('Перезагрузка через')", timeout=10000)
        check("Подтвердить → POST /api/chat/confirm", bool(calls("POST", "/api/chat/confirm")))
        check("после подтверждения кнопки скрыты", not page.is_visible("#confirmBox"))

        print("\n[дом и ПК]")
        page.click("#tabbar [data-tab='home']")
        page.wait_for_selector("#autos .item", timeout=10000)
        check("автоматизация видна с переключателем", page.locator("#autos .switch.on").count() == 1)
        page.click("#autos .switch"); page.wait_for_timeout(300)
        check("переключатель → automations/toggle enabled=false", calls("POST", "/api/automations/toggle")[-1][2] == {"id": 5, "enabled": False})
        page.fill("#taskText", "полить цветы"); page.click("#taskAdd"); page.wait_for_timeout(400)
        check("новая задача → tasks/add", calls("POST", "/api/tasks/add")[-1][2] == {"title": "полить цветы"})
        page.click("#mems .iconbtn"); page.wait_for_timeout(300)
        check("забыть → DELETE /api/memory {id}", calls("DELETE", "/api/memory") and calls("DELETE", "/api/memory")[-1][2] == {"id": 1})
        page.click("#tabbar [data-tab='pc']")
        page.wait_for_selector("#pcCards .card", timeout=10000)
        txt = page.text_content("#pcCards")
        check("карточки ПК: память/диски отрисованы", "Память" in txt and "Диски" in txt and "45.1" in txt)
        check("ошибок JS на странице не было", not errors)
        ctx.close()

        print("\n[сохранённый адрес API]")
        ctx, page = new_page()
        page.add_init_script(f"localStorage.setItem('intellect_token', {json.dumps(PASSWORD)}); localStorage.setItem('intellect_api', {json.dumps(api_url)})")
        page.goto(pages_url + "/index.html")
        page.wait_for_function("document.querySelector('#lampStatus').textContent !== '—'", timeout=10000)
        check("адрес API из localStorage, данные загружены", page.text_content("#lampStatus") in ("включена", "выключена"))
        check("шторка входа не показана", page.evaluate("document.querySelector('#sheetBg').classList.contains('hidden')"))
        ctx.close()

        print("\n[без пароля: 401 → показана шторка входа]")
        ctx, page = new_page()
        page.add_init_script(f"localStorage.setItem('intellect_api', {json.dumps(api_url)})")
        page.goto(pages_url + "/index.html")
        page.wait_for_selector("#sheetBg:not(.hidden)", timeout=10000)
        check("нет пароля → предложено ввести", "пароль" in page.text_content("#sheetTitle").lower())
        ctx.close()

        print("\n[same-origin: сайт отдаёт сам бот]")
        # API-сервер, который отдаёт и статику сайта с того же origin
        class ApiPlusSite(FakeAPI):
            def do_GET(self):
                p = self.path.split("?")[0]
                if p.startswith("/api/"):
                    return FakeAPI.do_GET(self)
                f = SITE / (p.lstrip("/") or "index.html")
                if f.is_file():
                    data = f.read_bytes(); ct = {"html": "text/html", "js": "application/javascript", "css": "text/css", "png": "image/png", "webmanifest": "application/manifest+json"}.get(f.suffix.lstrip("."), "application/octet-stream")
                    self.send_response(200); self.send_header("Content-Type", ct + "; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                else:
                    self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()
        same_srv, same_url = serve(ApiPlusSite)
        ctx, page = new_page()
        page.add_init_script(f"localStorage.setItem('intellect_token', {json.dumps(PASSWORD)})")
        page.goto(same_url + "/")
        page.wait_for_function("document.querySelector('#lampStatus').textContent !== '—'", timeout=10000)
        check("API найден по своему origin (без api.json)", page.text_content("#lampStatus") in ("включена", "выключена"))

        print("\n[только локально: сайт не ходит на внешние адреса]")
        ctx, page = new_page()
        hosts = set()
        page.on("request", lambda r: hosts.add(r.url.split("/")[2]))
        page.add_init_script(f"localStorage.setItem('intellect_token', {json.dumps(PASSWORD)})")
        page.goto(same_url + "/")
        page.wait_for_function("document.querySelector('#lampStatus').textContent !== '—'", timeout=10000)
        page.wait_for_timeout(500)
        check("все запросы — только к самому боту", hosts == {same_url.split("/")[2]})
        site_text = "".join(f.read_text(encoding="utf-8", errors="ignore") for f in SITE.iterdir() if f.suffix in (".html", ".js", ".css"))
        check("в сайте нет адресов GitHub/туннеля", not any(x in site_text for x in ("githubusercontent", "trycloudflare", "github.io", "api.json")))
        check("config.js (источники адреса в интернете) удалён", not (SITE / "config.js").exists())
        ctx.close()

        print("\n[десктоп: сайдбар]")
        ctx, page = new_page(1280, 860)
        page.add_init_script(f"localStorage.setItem('intellect_token', {json.dumps(PASSWORD)})")
        page.goto(same_url + "/")
        page.wait_for_function("document.querySelector('#lampStatus').textContent !== '—'", timeout=10000)
        check("на широком экране виден сайдбар, таббар скрыт", page.is_visible("#sidebar") and not page.is_visible("#tabbar"))
        if shots:
            page.wait_for_timeout(500)   # дождаться анимации появления экрана
            page.screenshot(path=str(shots / "desktop-light.png"))
            page.click("#sidebar [data-tab='tv']"); page.wait_for_timeout(500)
            page.screenshot(path=str(shots / "desktop-tv.png"))
        ctx.close()
        browser.close()

    for s in (api_srv, pages_srv, plain_srv, same_srv):
        s.shutdown()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    return 1 if _fail else 0


if __name__ == "__main__":
    print("=== Единый сайт site/: cross-origin, вход, лампа, ТВ, ассистент, дом, ПК ===")
    sys.exit(main())
