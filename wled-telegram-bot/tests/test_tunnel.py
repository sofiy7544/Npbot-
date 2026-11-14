#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты tunnel.py: разбор URL, перезапуск, stop(), отсутствие бинарника, скачивание.
Сети нет: cloudflared подменён скриптом на Python, скачивание — локальным http.server."""
import os, sys, io, logging, tempfile, threading, time, shutil
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import tunnel

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


FAKE = r'''
import sys, time, os
# Фейковый cloudflared: печатает URL в стиле cloudflared, живёт TTL секунд (или вечно).
n_file = os.environ.get("FAKE_COUNTER")
n = 0
if n_file:
    try: n = int(open(n_file).read() or 0)
    except Exception: n = 0
    open(n_file, "w").write(str(n + 1))
ttl = float(os.environ.get("FAKE_TTL", "0"))
print("2026-11-14T12:00:00Z INF Thank you for trying Cloudflare Tunnel.", flush=True)
print("2026-11-14T12:00:01Z INF +--------------------------------------------------------------+", flush=True)
print("2026-11-14T12:00:01Z INF |  https://run%d-abc.trycloudflare.com  |" % n, flush=True)
if ttl > 0:
    time.sleep(ttl); sys.exit(3)
while True:
    time.sleep(3600)
'''


def _fake_cmd(tmp, counter=True):
    path = os.path.join(tmp, "fake_cloudflared.py")
    open(path, "w", encoding="utf-8").write(FAKE)
    if counter:
        os.environ["FAKE_COUNTER"] = os.path.join(tmp, "counter")
    return [sys.executable, "-u", path]


def _wait(cond, timeout=8.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_url_parsed_and_callback():
    tmp = tempfile.mkdtemp()
    os.environ.pop("FAKE_TTL", None)
    got = []
    t = tunnel.Tunnel(command=_fake_cmd(tmp), backoff_min=0.2, backoff_max=0.5)
    t.on_url(got.append)
    t.start(8090)
    check("URL разобран из вывода", _wait(lambda: t.url == "https://run0-abc.trycloudflare.com"))
    time.sleep(0.5)
    check("on_url вызван ровно один раз с этим URL", got == ["https://run0-abc.trycloudflare.com"])
    check("последние строки вывода сохранены", any("Thank you" in l for l in t.last_output()))
    t.stop()
    check("после stop() URL = None", t.url is None)
    check("после stop() процесс завершён", t._proc is not None and t._proc.poll() is not None)
    check("on_url получил None при остановке", got[-1] is None)
    shutil.rmtree(tmp, ignore_errors=True)


def test_restart_after_death():
    tmp = tempfile.mkdtemp()
    os.environ["FAKE_TTL"] = "0.6"
    got = []
    t = tunnel.Tunnel(command=_fake_cmd(tmp), backoff_min=0.2, backoff_max=0.5)
    t.on_url(got.append)
    t.start(8090)
    check("первый URL появился", _wait(lambda: "https://run0-abc.trycloudflare.com" in got))
    check("после смерти процесса URL сброшен в None", _wait(lambda: None in got, 5))
    check("перезапуск дал НОВЫЙ URL и callback сработал",
          _wait(lambda: "https://run1-abc.trycloudflare.com" in got, 8))
    t.stop()
    os.environ.pop("FAKE_TTL", None)
    shutil.rmtree(tmp, ignore_errors=True)


def test_missing_binary_no_download():
    buf = io.StringIO()
    h = logging.StreamHandler(buf); tunnel.log.addHandler(h); tunnel.log.setLevel(logging.INFO)
    old_bin, old_env = tunnel.BIN_PATH, os.environ.pop(tunnel.TUNNEL_BIN_ENV, None)
    old_which = shutil.which
    tunnel.BIN_PATH = os.path.join(tempfile.mkdtemp(), "nope.exe")
    shutil.which = lambda *a, **k: None
    try:
        t = tunnel.Tunnel(allow_download=False, backoff_min=0.2, backoff_max=0.3)
        try:
            t.start(8090)
            raised = False
        except Exception:
            raised = True
        time.sleep(0.6)
        check("start() без бинарника не бросает", not raised)
        check("URL остаётся None", t.url is None)
        check("в журнале предупреждение", "cloudflared не найден" in buf.getvalue())
        check("last_error заполнен", bool(t.last_error))
        t.stop()
    finally:
        tunnel.BIN_PATH = old_bin
        shutil.which = old_which
        tunnel.log.removeHandler(h)
        if old_env: os.environ[tunnel.TUNNEL_BIN_ENV] = old_env


class _H(BaseHTTPRequestHandler):
    big = b"MZ" + b"\0" * (tunnel.MIN_BIN_SIZE + 1024)
    small = b"MZ" + b"\0" * 1000
    def do_GET(self):
        data = self.big if self.path == "/big" else self.small
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers()
        self.wfile.write(data)
    def log_message(self, *a): pass


def test_download_helper():
    srv = HTTPServer(("127.0.0.1", 0), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    tmp = tempfile.mkdtemp()
    dest = os.path.join(tmp, "cloudflared.exe")
    try:
        got = tunnel.download_binary(base + "/big", dest)
        check("большой MZ-файл скачан и переименован", got == dest and os.path.getsize(dest) > tunnel.MIN_BIN_SIZE)
        try:
            tunnel.download_binary(base + "/small", os.path.join(tmp, "x.exe"))
            rejected = False
        except ValueError:
            rejected = True
        check("маленький файл отклонён", rejected and not os.path.exists(os.path.join(tmp, "x.exe")))
        check("временных .part не осталось", not [f for f in os.listdir(tmp) if f.endswith(".part")])
    finally:
        srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)


def test_url_regex():
    line = "2026-11-14T12:00:00Z INF +--- https://abc-def.trycloudflare.com ---+"
    check("regex ловит адрес trycloudflare", tunnel.URL_RE.search(line).group(0) == "https://abc-def.trycloudflare.com")
    check("regex не ловит чужие домены", tunnel.URL_RE.search("https://evil.example.com") is None)


if __name__ == "__main__":
    print("=== Туннель Cloudflare: разбор URL, перезапуск, стоп, скачивание ===")
    for t in (test_url_regex, test_url_parsed_and_callback, test_restart_after_death,
              test_missing_binary_no_download, test_download_helper):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
