#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты 2.4.0 «только локально»: текст /panel без интернета; бот со старым .env
(TUNNEL=1, GITHUB_TOKEN, PAGES_URL) НЕ поднимает туннель и не ходит на GitHub."""
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


def test_panel_message():
    m = panel_link.panel_message(lan_url="http://192.168.1.107:8090", password="aZ3kQ9mT2p")
    check("в /panel есть домашний адрес и пароль", "192.168.1.107:8090" in m and "aZ3kQ9mT2p" in m)
    check("в /panel нет интернета/туннеля/GitHub", not any(x in m.lower() for x in ("trycloudflare", "github", "туннел")))
    check("в /panel сказано, что только дома", "только в домашней сети" in m)
    m2 = panel_link.panel_message(lan_url=None, password=None)
    check("панель не запущена → честно", "не запущена" in m2)
    check("HTML-опасные символы экранированы", "<" not in panel_link.panel_message(
        lan_url="http://x/<b>", password="p<w>12345").replace("<b>Панель", "").replace("<code>", "").replace("</code>", "").replace("</b>", ""))
    check("в panel_link больше нет GitHub-публикации", not hasattr(panel_link, "publish_api_url"))
    check("tunnel.py удалён из проекта", not (ROOT / "tunnel.py").exists())


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


OLD_FILES = ("cloudflared.exe", "tunnel.py", "GITHUB_RESEARCH.md", "site/config.js", "tests/test_tunnel.py")


def _run_bot(env_text, seconds=14, old_files=()):
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".env", "__pycache__", "*.db", "*.log", "logs", ".git", "site"))
    (work / ".env").write_text(env_text, encoding="utf-8")
    for rel in old_files:                       # как после распаковки 2.4.0 поверх 2.3.x
        (work / rel).parent.mkdir(parents=True, exist_ok=True); (work / rel).write_text("old")
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
    left = [rel for rel in old_files if (work / rel).exists()]
    shutil.rmtree(work.parent, ignore_errors=True)
    _run_bot.left = left
    return out, log, diag


def test_old_env_stays_local():
    env = (f"WLED_BOT_TOKEN={FAKE_TOK}\nALLOWED_USERS=42\nWLED_IP=127.0.0.1\nACCESS_PASSWORD=aZ3kQ9mT2p\n"
           "TUNNEL=1\nPAGES_URL=https://user.github.io/intellect/\nGITHUB_PAGES_REPO=user/x\nGITHUB_TOKEN=ghp_fake\n")
    out, log, diag = _run_bot(env, old_files=OLD_FILES)
    check("бот запустился", "Бот запущен" in log)
    check("старые файлы туннеля/GitHub удалены при запуске", _run_bot.left == [])
    check("в журнале записано, что удалено", "Удалены ненужные файлы" in log)
    check("туннель НЕ поднят, хотя в .env TUNNEL=1", "trycloudflare" not in log and "trycloudflare" not in out)
    check("в журнале объяснено, что TUNNEL больше не используется", "TUNNEL в .env больше не используется" in log)
    check("в Telegram не ушли адреса интернета", "github.io" not in out and "trycloudflare" not in out)
    check("diag: доступ — только домашняя сеть", "только домашняя сеть" in diag)


if __name__ == "__main__":
    print("=== Панель только дома: /panel, старый .env с TUNNEL=1 ===")
    for t in (test_panel_message, test_old_env_stays_local):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
