"""
server.py — HTTP-сервер веб-панели INTELLECT (http.server, без зависимостей).

Отдаёт страницу, иконки/манифест и JSON-API (под паролем). Запускается в
фоновом потоке рядом с ботом. Лёгкий — подходит для слабого ПК.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .api import WebAPI
from .page import PAGE, CLASSIC_PAGE


class _RateLimiter:
    """Простой скользящий счётчик запросов на IP (без зависимостей).

    Для каждого (ip, bucket) держим deque меток времени. Если за `window`
    секунд набралось больше `limit` — отказ. Отдельный bucket под /api/chat
    (дорогой — OpenAI), отдельный под auth (чтобы не перебирали пароль).
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque] = {}
        self._failed: dict[str, tuple[int, float]] = {}  # ip → (кол-во, до_когда)

    def allow(self, ip: str, bucket: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        key = (ip, bucket)
        with self._lock:
            dq = self._hits.setdefault(key, deque())
            while dq and now - dq[0] > window:
                dq.popleft()
            if len(dq) >= limit:
                return False
            dq.append(now)
            return True

    def note_auth_fail(self, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            cnt, _ = self._failed.get(ip, (0, 0.0))
            cnt += 1
            # после 10 подряд — блок на 15 минут
            until = now + (900 if cnt >= 10 else 0)
            self._failed[ip] = (cnt, until)

    def note_auth_ok(self, ip: str) -> None:
        with self._lock:
            self._failed.pop(ip, None)

    def is_locked(self, ip: str) -> bool:
        now = time.monotonic()
        with self._lock:
            entry = self._failed.get(ip)
            if not entry:
                return False
            _cnt, until = entry
            if until and now < until:
                return True
            if until and now >= until:
                self._failed.pop(ip, None)
            return False

_ASSETS = Path(__file__).resolve().parent.parent.parent / "assets"

_MANIFEST = json.dumps({
    "name": "INTELLECT", "short_name": "INTELLECT", "display": "standalone",
    "background_color": "#07070c", "theme_color": "#07070c",
    "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png",
               "purpose": "any maskable"}],
}, ensure_ascii=False)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class IntellectWeb:
    def __init__(self, app, port: int = 8090):
        self.api = WebAPI(app)
        self.port = port
        self._httpd = None
        self._rl = _RateLimiter()

    def start(self) -> str:
        api = self.api
        rl = self._rl

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _ip(self) -> str:
                # X-Forwarded-For корректен только за доверенным прокси, здесь
                # ставим ограничение по прямому адресу клиента.
                try:
                    return self.client_address[0]
                except Exception:
                    return "?"

            def _rate_ok(self, bucket: str, limit: int, window: float) -> bool:
                ip = self._ip()
                if rl.is_locked(ip):
                    self._send(429, {"error": "too many failed attempts, wait 15 min"})
                    return False
                if not rl.allow(ip, bucket, limit, window):
                    self._send(429, {"error": "rate limit"})
                    return False
                return True

            def _send(self, code, body, ctype="application/json; charset=utf-8"):
                if isinstance(body, (dict, list)):
                    body = json.dumps(body, ensure_ascii=False, default=str).encode()
                elif isinstance(body, str):
                    body = body.encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _asset(self, name, ctype):
                try:
                    self._send(200, (_ASSETS / name).read_bytes(), ctype)
                except Exception:
                    self._send(404, b"", "text/plain")

            def _body(self):
                n = int(self.headers.get("Content-Length", 0))
                if not n:
                    return {}
                try:
                    return json.loads(self.rfile.read(n) or b"{}")
                except Exception:
                    return {}

            def _auth(self):
                ok = api.authorized(self.headers.get("X-Intellect-Token"))
                ip = self._ip()
                if ok:
                    rl.note_auth_ok(ip)
                else:
                    rl.note_auth_fail(ip)
                return ok

            # ---------- GET ----------
            def do_GET(self):
                p = self.path.split("?")[0]
                if p in ("/", "/index.html"):
                    return self._send(200, PAGE, "text/html; charset=utf-8")
                if p == "/classic":
                    return self._send(200, CLASSIC_PAGE, "text/html; charset=utf-8")
                if p == "/manifest.json":
                    return self._send(200, _MANIFEST, "application/manifest+json; charset=utf-8")
                if p in ("/icon.png", "/apple-touch-icon.png"):
                    return self._asset("icon-512.png", "image/png")
                if p in ("/icon-192.png", "/icon-512.png"):
                    return self._asset(p.lstrip("/"), "image/png")
                if p.startswith("/api/"):
                    # общий лимит на все GET-API: 60 запросов в минуту с IP
                    if not self._rate_ok("api_get", 60, 60.0):
                        return
                    if not self._auth():
                        return self._send(401, {"error": "unauthorized"})
                    routes = {
                        "/api/status": api.status, "/api/devices": api.devices,
                        "/api/memory": api.memory_list, "/api/automations": api.automations,
                        "/api/tasks": api.tasks, "/api/system": api.system}
                    fn = routes.get(p)
                    if fn:
                        code, data = fn()
                        return self._send(code, data)
                return self._send(404, {"error": "not found"})

            # ---------- POST ----------
            def do_POST(self):
                p = self.path.split("?")[0]
                # /api/chat ходит в OpenAI — жёсткий лимит; остальные POST мягче
                if p == "/api/chat":
                    if not self._rate_ok("api_chat", 20, 60.0):
                        return
                else:
                    if not self._rate_ok("api_post", 40, 60.0):
                        return
                if not self._auth():
                    return self._send(401, {"error": "unauthorized"})
                body = self._body()
                routes = {
                    "/api/chat": api.chat,
                    "/api/devices/command": api.device_command,
                    "/api/memory": api.memory_add,
                    "/api/automations/toggle": api.automation_toggle,
                    "/api/automations/delete": api.automation_delete,
                    "/api/tasks/add": api.task_add,
                    "/api/tasks/done": api.task_done}
                fn = routes.get(p)
                if fn:
                    code, data = fn(body)
                    return self._send(code, data)
                return self._send(404, {"error": "not found"})

            # ---------- DELETE ----------
            def do_DELETE(self):
                if not self._rate_ok("api_post", 40, 60.0):
                    return
                if not self._auth():
                    return self._send(401, {"error": "unauthorized"})
                if self.path.split("?")[0] == "/api/memory":
                    code, data = api.memory_delete(self._body())
                    return self._send(code, data)
                return self._send(404, {"error": "not found"})

        self._httpd = ThreadingHTTPServer(("0.0.0.0", self.port), H)
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()
        return f"http://{lan_ip()}:{self.port}"

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()


def start_web(app, port: int = 8090) -> str:
    """Запустить панель, вернуть URL для телефона."""
    return IntellectWeb(app, port).start()
