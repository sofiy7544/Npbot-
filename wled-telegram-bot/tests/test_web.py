#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 9 (Web): HTTP-сервер панели, авторизация, API."""
import os, sys, json, tempfile, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["OPENAI_API_KEY"] = ""          # без ключа → предсказуемый фолбэк
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "web.db")
os.environ["ALLOWED_USERS"] = "42"
os.environ["ACCESS_PASSWORD"] = "1234"
os.environ["WLED_IP"] = "1.2.3.4"

from intellect.config import load_settings
from intellect.db.database import Database
from intellect.app import IntellectApp
from intellect.web import IntellectWeb
from intellect.web.server import _RateLimiter

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")

def _free_port():
    import socket as _s
    with _s.socket() as t:
        t.bind(("127.0.0.1", 0)); return t.getsockname()[1]
PORT = _free_port()   # свой порт на прогон: параллельные прогоны/чужие процессы не мешают
BASE = f"http://127.0.0.1:{PORT}"

def req(path, method="GET", token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token: r.add_header("X-Intellect-Token", token)
    if data: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=8) as resp:
            req.last_headers = dict(resp.headers)
            raw = resp.read() or b"{}"
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        req.last_headers = dict(e.headers)
        return e.code, {}


def main():
    st = load_settings()
    app = IntellectApp(st, db=Database(st.db_path))
    app.wled._t = type("T", (), {"get_json": lambda s,u: {"name":"L"} if u.endswith("info") else {"on":False,"bri":0,"seg":[{"col":[[0,0,0]],"fx":0}]},
                                 "post_json": lambda s,u,p: True})()
    web = IntellectWeb(app, port=PORT); web.start()

    print("[auth]")
    code,_ = req("/api/status")
    check("без токена → 401", code == 401)
    code,_ = req("/api/status", token="wrong")
    check("неверный токен → 401", code == 401)
    code,data = req("/api/status", token="1234")
    check("верный токен → 200", code == 200)
    check("в статусе есть ai", "ai" in data)

    print("\n[page]")
    with urllib.request.urlopen(BASE + "/", timeout=5) as resp:
        html = resp.read().decode("utf-8", "ignore")
        check("страница отдаётся (HTML с INTELLECT)",
              resp.status == 200 and "INTELLECT" in html)

    print("\n[memory]")
    req("/api/memory", "POST", token="1234", body={"content": "вечером выключать свет"})
    code,data = req("/api/memory", token="1234")
    check("память добавилась и читается",
          any("выключать свет" in i["content"] for i in data["items"]))
    mid = data["items"][0]["id"]
    req("/api/memory", "DELETE", token="1234", body={"id": mid})
    code,data = req("/api/memory", token="1234")
    check("память удалилась", all(i["id"] != mid for i in data["items"]))

    print("\n[tasks]")
    req("/api/tasks/add", "POST", token="1234", body={"title": "купить молоко"})
    code,data = req("/api/tasks", token="1234")
    check("задача добавилась", any(t["title"] == "купить молоко" for t in data["items"]))

    print("\n[chat/devices/system]")
    code,data = req("/api/chat", "POST", token="1234", body={"text": "привет"})
    check("чат отвечает (200 + reply)", code == 200 and "reply" in data)
    code,data = req("/api/devices", token="1234")
    check("устройства в ответе", "lamp" in data["devices"])
    code,data = req("/api/system", token="1234")
    check("система: есть host", "host" in data)


    print("\n[2.3.0: единый API для сайта]")
    code, data = req("/api/ping")
    check("/api/ping без пароля → 200, auth=true, версия", code == 200 and data.get("auth") is True and data.get("version"))
    code, _ = req("/api/lamp/state")
    check("/api/lamp/state без пароля → 401", code == 401)
    code, data = req("/api/lamp/state", token="1234")
    check("/api/lamp/state: лампы нет → online=false, пустые списки", code == 200 and data["online"] is False and data["effects"] == [])
    code, data = req("/api/lamp/raw", "POST", token="1234", body={})
    check("/api/lamp/raw пустая команда → 400", code == 400)
    code, data = req("/api/timer", token="1234")
    check("/api/timer → {lamp, tv}", code == 200 and set(data) >= {"lamp", "tv"})
    code, data = req("/api/timer", "POST", token="1234", body={"kind": "lamp", "minutes": 0})
    check("/api/timer отмена → 200", code == 200 and data["lamp"] == 0)
    code, data = req("/api/timer", "POST", token="1234", body={"kind": "x", "minutes": 5})
    check("/api/timer неверный kind → 400", code == 400)
    import tvremote, tempfile as _tf
    tvremote.CONFIG_FILE = os.path.join(_tf.mkdtemp(), "tv.json"); tvremote.config.update(ip="", method=""); tvremote._mtime = -1.0
    code, data = req("/api/tv/config", token="1234")
    check("/api/tv/config: ТВ не настроен → configured=false", code == 200 and data["configured"] is False)
    code, data = req("/api/tv/key", "POST", token="1234", body={"key": "KEY_UP"})
    check("/api/tv/key без ТВ → 400 с подсказкой «Найти телевизор»", code == 400)
    code, data = req("/api/tv/apps", token="1234")
    check("/api/tv/apps без ТВ → пустой список", code == 200 and data["apps"] == [])
    code, data = req("/api/chat/cancel", "POST", token="1234", body={})
    check("/api/chat/cancel → reply", code == 200 and "reply" in data)
    code, data = req("/api/chat/confirm", "POST", token="1234", body={})
    check("/api/chat/confirm без ожидающего → «нечего»", code == 200 and "нечего" in data["reply"].lower())
    code, data = req("/api/panel", token="1234")
    check("/api/panel → password_required=true", code == 200 and data["password_required"] is True)
    code, data = req("/api/devices/command", "POST", token="1234", body={"device": "lamp", "command": {"action": "scene", "name": "сон"}})
    check("сцена «сон» через /api/devices/command → ok", code == 200 and "ok" in data)

    print("\n[только домашняя сеть: без CORS, чужие адреса — 403]")
    r = urllib.request.Request(BASE + "/api/devices", method="OPTIONS")
    r.add_header("Origin", "https://evil.example.com"); r.add_header("Access-Control-Request-Method", "GET")
    with urllib.request.urlopen(r, timeout=5) as resp:
        check("preflight с чужого сайта — без Allow-Origin", "Access-Control-Allow-Origin" not in dict(resp.headers))
    r = urllib.request.Request(BASE + "/api/ping"); r.add_header("Origin", "https://user.github.io")
    with urllib.request.urlopen(r, timeout=5) as resp:
        check("обычный ответ — без Allow-Origin", resp.headers.get("Access-Control-Allow-Origin") is None)
    from intellect.web import server as _srv
    loc = _srv.is_local_client
    check("дом/ПК — свои", all(loc(x) for x in ("127.0.0.1", "192.168.1.107", "10.0.0.5", "172.16.3.4",
                                                    "169.254.1.1", "::1", "fe80::1%eth0", "::ffff:192.168.1.5")))
    check("интернет — чужие", not any(loc(x) for x in ("8.8.8.8", "104.16.1.1", "2001:4860::8888",
                                                          "::ffff:8.8.8.8", "", "?", "мусор")))
    _orig = _srv.is_local_client
    _srv.is_local_client = lambda ip: False          # как будто запрос пришёл из интернета
    try:
        code, data = req("/api/ping")
        check("запрос не из домашней сети → 403", code == 403)
        code, data = req("/", token="1234")
        check("и страница сайта не отдаётся → 403", code == 403)
        code, data = req("/api/chat", "POST", token="1234", body={"text": "привет"})
        check("и POST → 403", code == 403)
    finally:
        _srv.is_local_client = _orig
    code, _ = req("/api/ping")
    check("с самого ПК — снова 200", code == 200)

    print("\n[надёжность пароля]")
    from intellect.web.api import WebAPI as _W
    check("5750/пусто/1234 — слабые", all(_W.password_is_weak(x) for x in ("5750", "", "1234", "12345")))
    check("случайный из 10 символов — надёжный", not _W.password_is_weak("aZ3kQ9mT2p"))

    print("\n[единый сайт site/ отдаётся ботом]")
    import intellect.web.server as _srv
    sd = Path(_tf.mkdtemp()); (sd / "index.html").write_text("<!doctype html><title>INTELLECT site</title>", encoding="utf-8")
    (sd / "app.js").write_text("console.log(1)", encoding="utf-8"); (sd / "api.json").write_text('{"api":"x"}', encoding="utf-8")
    old_site = _srv._SITE; _srv._SITE = sd
    try:
        with urllib.request.urlopen(BASE + "/", timeout=5) as resp:
            check("/ → site/index.html", resp.status == 200 and b"INTELLECT site" in resp.read())
        with urllib.request.urlopen(BASE + "/app.js", timeout=5) as resp:
            check("/app.js с правильным типом", "javascript" in resp.headers.get("Content-Type", ""))
        code, _ = req("/api.json")
        check("api.json локально НЕ отдаётся (сайт возьмёт этот же адрес)", code == 404)
        code, _ = req("/../.env")
        check("выход за папку site/ закрыт", code in (404, 400))
    finally:
        _srv._SITE = old_site

    print("\n[rate-limit]")
    rl = _RateLimiter()
    # 3 запроса в окне 10 секунд
    allowed = sum(rl.allow("1.1.1.1", "b", 3, 10.0) for _ in range(5))
    check("rate-limit пропускает ровно 3 из 5", allowed == 3)
    allowed_other = rl.allow("2.2.2.2", "b", 3, 10.0)
    check("другой IP считается независимо", allowed_other is True)
    for _ in range(10):
        rl.note_auth_fail("9.9.9.9")
    check("10 неудачных авторизаций → IP блокируется", rl.is_locked("9.9.9.9"))
    check("чистый IP не заблокирован", not rl.is_locked("1.1.1.1"))
    rl.note_auth_ok("9.9.9.9")
    check("успешная авторизация снимает блок", not rl.is_locked("9.9.9.9"))

    web.stop()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)


if __name__ == "__main__":
    print("=== ЭТАП 9: тесты Web ===")
    main()
