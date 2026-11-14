"""
server.py — HTTP-сервер веб-панели INTELLECT (http.server, без зависимостей).

Отдаёт страницу, иконки/манифест и JSON-API (под паролем). Запускается в
фоновом потоке рядом с ботом. Лёгкий — подходит для слабого ПК.
"""
from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .api import WebAPI
from .page import PAGE, CLASSIC_PAGE

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

    def start(self) -> str:
        api = self.api

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

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
                return api.authorized(self.headers.get("X-Intellect-Token"))

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
