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

PORT = 8191
BASE = f"http://127.0.0.1:{PORT}"

def req(path, method="GET", token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token: r.add_header("X-Intellect-Token", token)
    if data: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
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
