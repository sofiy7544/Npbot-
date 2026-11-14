#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты панели из интернета: публикация адреса на GitHub, текст /panel,
запуск туннеля ботом (с фейковым cloudflared), запрет при слабом пароле."""
import os, sys, json, base64, threading, tempfile, shutil, subprocess, time, stat
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _free_port():
    import socket as _s
    with _s.socket() as t:
        t.bind(("127.0.0.1", 0)); return t.getsockname()[1]
os.environ["INTELLECT_LOCK_PORT"] = str(_free_port())

import panel_link

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")

FAKE_TOK = "1122334455:AAFakeTokenForTestsOnly_abcdefghijkl"


class FakeGitHub(BaseHTTPRequestHandler):
    """Хранит один файл; проверяет Bearer-токен; считает запросы."""
    store = {}          # path → (sha, content_b64)
    calls = []
    token = "ghp_testtoken"

    def log_message(self, *a): pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        FakeGitHub.calls.append(("GET", self.path))
        if self.headers.get("Authorization") != f"Bearer {FakeGitHub.token}":
            return self._send(401, {"message": "Bad credentials"})
        p = self.path.split("?")[0]
        if p in FakeGitHub.store:
            sha, content = FakeGitHub.store[p]
            return self._send(200, {"sha": sha, "content": content})
        self._send(404, {"message": "Not Found"})

    def do_PUT(self):
        FakeGitHub.calls.append(("PUT", self.path))
        if self.headers.get("Authorization") != f"Bearer {FakeGitHub.token}":
            return self._send(401, {"message": "Bad credentials"})
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        existing = FakeGitHub.store.get(self.path)
        if existing and body.get("sha") != existing[0]:
            return self._send(409, {"message": "sha mismatch"})
        sha = f"sha{len(FakeGitHub.calls)}"
        FakeGitHub.store[self.path] = (sha, body["content"])
        self._send(201 if not existing else 200, {"content": {"sha": sha}})


def test_publish_api_url():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    panel_link.GITHUB_API = f"http://127.0.0.1:{srv.server_address[1]}"
    FakeGitHub.store.clear(); FakeGitHub.calls.clear()
    ok = panel_link.publish_api_url("user/intellect", "ghp_testtoken", "https://a1.trycloudflare.com")
    check("файла нет → создан (GET 404 → PUT 201)", ok and [c[0] for c in FakeGitHub.calls] == ["GET", "PUT"])
    saved = json.loads(base64.b64decode(FakeGitHub.store["/repos/user/intellect/contents/api.json"][1]))
    check("в api.json записан адрес", saved["api"] == "https://a1.trycloudflare.com")
    FakeGitHub.calls.clear()
    ok = panel_link.publish_api_url("user/intellect", "ghp_testtoken", "https://a1.trycloudflare.com")
    check("тот же адрес → без лишней записи (только GET)", ok and [c[0] for c in FakeGitHub.calls] == ["GET"])
    FakeGitHub.calls.clear()
    ok = panel_link.publish_api_url("user/intellect", "ghp_testtoken", "https://b2.trycloudflare.com")
    saved = json.loads(base64.b64decode(FakeGitHub.store["/repos/user/intellect/contents/api.json"][1]))
    check("новый адрес → перезаписан с правильным sha", ok and saved["api"] == "https://b2.trycloudflare.com")
    ok = panel_link.publish_api_url("user/intellect", "wrong", "https://c3.trycloudflare.com")
    check("неверный токен → False, без исключения", ok is False)
    check("пустые параметры → False", panel_link.publish_api_url("", "", "") is False)
    panel_link.GITHUB_API = "http://127.0.0.1:9"      # закрытый порт
    t0 = time.time(); ok = panel_link.publish_api_url("user/intellect", "ghp_testtoken", "https://d4.trycloudflare.com")
    check("GitHub недоступен → False быстро", ok is False and time.time() - t0 < 10)
    srv.shutdown()


def test_panel_message():
    m = panel_link.panel_message(lan_url="http://192.168.1.107:8090", tunnel_url="https://x.trycloudflare.com",
                                 pages_url="https://user.github.io/intellect/", password="aZ3kQ9mT2p",
                                 tunnel_enabled=True, weak_password=False)
    check("в /panel есть сайт, прямой адрес, дом и пароль",
          all(x in m for x in ("github.io", "trycloudflare", "192.168.1.107", "aZ3kQ9mT2p")))
    m2 = panel_link.panel_message(lan_url="http://192.168.1.107:8090", tunnel_url=None, pages_url=None,
                                  password="5750", tunnel_enabled=True, weak_password=True)
    check("слабый пароль → предупреждение, а не «поднимается»", "слабый" in m2 and "поднимается" not in m2)
    m3 = panel_link.panel_message(lan_url="http://x", tunnel_url=None, pages_url=None, password="aZ3kQ9mT2p",
                                  tunnel_enabled=True, weak_password=False)
    check("туннель ещё поднимается → так и сказано", "поднимается" in m3)
    check("HTML-опасные символы экранированы", "<" not in panel_link.panel_message(
        lan_url="http://x/<b>", tunnel_url=None, pages_url=None, password="p<w>12345",
        tunnel_enabled=False, weak_password=False).replace("<b>Панель", "").replace("<code>", "").replace("</code>", "").replace("</b>", ""))


# ---------- сквозной: настоящий wled_bot.py, фейковые Telegram и cloudflared ----------
FAKE_CF = """#!/bin/sh
echo '2026-11-14T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...' >&2
echo '2026-11-14T12:00:01Z INF +--------------------------------------------------------------------------------------------+' >&2
echo '2026-11-14T12:00:01Z INF |  https://fake-panel-url.trycloudflare.com                                               |' >&2
sleep 30
"""
PRE = (
    "import sys, os, json, asyncio, runpy\n"
    "import telegram.request._httpxrequest as hx\n"
    "SENT = []\n"
    "async def fake(self, url, method, request_data=None, read_timeout=None, write_timeout=None, connect_timeout=None, pool_timeout=None):\n"
    "    m = url.rsplit('/', 1)[-1]\n"
    "    if m == 'getMe':\n"
    "        return 200, json.dumps({'ok': True, 'result': {'id': 1, 'is_bot': True, 'first_name': 'x', 'username': 'x_bot'}}).encode()\n"
    "    if m == 'sendMessage':\n"
    "        p = request_data.parameters if request_data else {}\n"
    "        print('SENT_MESSAGE ' + json.dumps(p, ensure_ascii=False), flush=True)\n"
    "        return 200, json.dumps({'ok': True, 'result': {'message_id': 1, 'date': 0, 'chat': {'id': 42, 'type': 'private'}, 'text': 'x'}}).encode()\n"
    "    if m == 'getWebhookInfo':\n"
    "        return 200, json.dumps({'ok': True, 'result': {'url': '', 'has_custom_certificate': False, 'pending_update_count': 0}}).encode()\n"
    "    if m == 'getUpdates':\n"
    "        await asyncio.sleep(1)\n"
    "        if os.path.exists('STOP'): raise SystemExit(0)\n"
    "        return 200, json.dumps({'ok': True, 'result': []}).encode()\n"
    "    return 200, json.dumps({'ok': True, 'result': True}).encode()\n"
    "hx.HTTPXRequest.do_request = fake\n"
    "sys.argv = [sys.argv[1]]\n"
    "runpy.run_path(sys.argv[0], run_name='__main__')\n"
)


def _run_bot(env_text, seconds=14):
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".env", "__pycache__", "*.db", "*.log", "logs", ".git", "site"))
    (work / ".env").write_text(env_text, encoding="utf-8")
    cf = work / "fake_cloudflared.sh"; cf.write_text(FAKE_CF); cf.chmod(cf.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if k not in ("WLED_BOT_TOKEN", "ALLOWED_USERS", "OPENAI_API_KEY", "WLED_IP", "ACCESS_PASSWORD", "TUNNEL")}
    env.update(WEB_PORT="0", INTELLECT_WEB_PORT=str(_free_port()), PYTHONIOENCODING="utf-8", CLOUDFLARED_PATH=str(cf))
    pr = subprocess.Popen([sys.executable, "-c", PRE, str(work / "wled_bot.py")], cwd=work, env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    time.sleep(seconds); (work / "STOP").write_text("1")
    try:
        out = pr.communicate(timeout=30)[0]
    except subprocess.TimeoutExpired:
        pr.kill(); out = pr.communicate()[0]
    log = (work / "logs" / "bot.log").read_text(encoding="utf-8") if (work / "logs" / "bot.log").exists() else ""
    diag = (work / "logs" / "diag.txt").read_text(encoding="utf-8") if (work / "logs" / "diag.txt").exists() else ""
    shutil.rmtree(work.parent, ignore_errors=True)
    return out, log, diag


def test_bot_starts_tunnel_and_notifies():
    env = f"WLED_BOT_TOKEN={FAKE_TOK}\nALLOWED_USERS=42\nWLED_IP=127.0.0.1\nACCESS_PASSWORD=aZ3kQ9mT2p\nTUNNEL=1\nPAGES_URL=https://user.github.io/intellect/\n"
    out, log, diag = _run_bot(env)
    check("бот поднял туннель и получил адрес", "fake-panel-url.trycloudflare.com" in log)
    check("владельцу в Telegram ушла ссылка с паролем", "SENT_MESSAGE" in out and "fake-panel-url" in out and "aZ3kQ9mT2p" in out)
    check("в сообщении есть сайт на GitHub Pages", "user.github.io" in out)
    check("diag: туннель включён", "Туннель (TUNNEL): 1" in diag)
    check("пароль не попал в журнал бота", "aZ3kQ9mT2p" not in log)


def test_bot_refuses_tunnel_with_weak_password():
    env = f"WLED_BOT_TOKEN={FAKE_TOK}\nALLOWED_USERS=42\nWLED_IP=127.0.0.1\nACCESS_PASSWORD=5750\nTUNNEL=1\n"
    out, log, diag = _run_bot(env, seconds=10)
    check("слабый пароль → туннель НЕ поднят", "trycloudflare" not in log)
    check("в журнале понятное предупреждение", "пароль панели слабый" in log)
    env2 = f"WLED_BOT_TOKEN={FAKE_TOK}\nALLOWED_USERS=42\nWLED_IP=127.0.0.1\nACCESS_PASSWORD=aZ3kQ9mT2p\nTUNNEL=0\n"
    out, log, diag = _run_bot(env2, seconds=10)
    check("TUNNEL=0 → туннель не поднимается", "trycloudflare" not in log and "Туннель (TUNNEL): 0" in diag)


if __name__ == "__main__":
    print("=== Панель из интернета: GitHub api.json, /panel, туннель ===")
    for t in (test_publish_api_url, test_panel_message, test_bot_starts_tunnel_and_notifies,
              test_bot_refuses_tunnel_with_weak_password):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
