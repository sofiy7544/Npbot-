#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты поиска лампы (find_lamp): подсети ПК, окно на адрес, повторы, сам опрос.

Сеть Windows/Wi-Fi имитируется: «пустой» адрес молчит весь таймаут (нет ответа
на ARP), лампа после простоя отвечает на первый контакт только через ~1 с
(первый ARP потерян — Windows повторяет его через 1 с). Время ускорено.
"""
import os, sys, json, time, socket, threading, types, ipaddress
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import find_lamp

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


WLED_INFO = {"ver": "0.14.4", "leds": {"count": 60}, "name": "Лампа", "brand": "WLED", "product": "FOSS"}


# ---------- 1) подсети: реальный адрес ПК пользователя 192.168.1.107 ----------
def test_subnets_for_user_pc():
    saved = find_lamp.local_ipv4s
    try:
        find_lamp.local_ipv4s = lambda: ["192.168.1.107"]
        nets = find_lamp._subnets_to_scan()
        check("ПК 192.168.1.107 → сканируется 192.168.1.0/24", [str(n) for n in nets] == ["192.168.1.0/24"])
        check("…и лампа 192.168.1.110 в этой подсети", ipaddress.ip_address("192.168.1.110") in nets[0])
        check("…это 254 адреса (.1–.254)", len(list(nets[0].hosts())) == 254)
        find_lamp.local_ipv4s = lambda: ["192.168.1.107", "169.254.3.4", "172.24.80.1", "26.10.20.30"]
        check("APIPA/WSL/Radmin рядом с Wi-Fi — не сканируются",
              [str(n) for n in find_lamp._subnets_to_scan()] == ["192.168.1.0/24"])
    finally:
        find_lamp.local_ipv4s = saved


def test_main_adapter_first():
    """Windows отдаёт адаптеры в своём порядке (VirtualBox может быть первым) —
    основная сеть (маршрут по умолчанию) всё равно сканируется первой."""
    class _UDP:
        def __init__(self, *a): pass
        def connect(self, addr): pass
        def getsockname(self): return ("192.168.1.107", 50000)
        def close(self): pass
    fake_socket = types.SimpleNamespace(
        socket=_UDP, AF_INET=socket.AF_INET, SOCK_DGRAM=socket.SOCK_DGRAM, gethostname=lambda: "Zmey32",
        getaddrinfo=lambda *a, **k: [(0, 0, 0, "", ("192.168.56.1", 0)), (0, 0, 0, "", ("192.168.1.107", 0))])
    A = lambda ip: types.SimpleNamespace(family=socket.AF_INET, address=ip)
    fake_psutil = types.SimpleNamespace(net_if_addrs=lambda: {
        "VirtualBox Host-Only Network": [A("192.168.56.1")], "Ethernet": [A("169.254.3.4")],
        "Беспроводная сеть": [A("192.168.1.107")]})
    saved_sock, saved_ps = find_lamp.socket, sys.modules.get("psutil")
    try:
        find_lamp.socket = fake_socket
        sys.modules["psutil"] = fake_psutil
        ips = find_lamp.local_ipv4s()
        check("адрес маршрута по умолчанию — первым", ips[0] == "192.168.1.107")
        check("адреса без повторов", len(ips) == len(set(ips)))
        nets = [str(n) for n in find_lamp._subnets_to_scan()]
        check("основная 192.168.1.0/24 — первой, VirtualBox — после", nets == ["192.168.1.0/24", "192.168.56.0/24"])
    finally:
        find_lamp.socket = saved_sock
        if saved_ps is None: sys.modules.pop("psutil", None)
        else: sys.modules["psutil"] = saved_ps


# ---------- 2) имитация сети Wi-Fi + Windows ----------
SCALE = 0.1                    # 1 «сетевая» секунда = 0.1 настоящей
class FakeLan:
    """Подмена socket.create_connection (ею пользуется http.client)."""
    def __init__(self, lamp="192.168.1.110", first_contact=1.05):
        self.lamp, self.first, self.cold = lamp, first_contact, True
        self.probed = []
        self.lock = threading.Lock()
        self.lst = socket.socket(); self.lst.bind(("127.0.0.1", 0)); self.lst.listen(512)
        self.keep = []
        self.orig = socket.create_connection

    def _serve(self, status, body):
        c = self.orig(("127.0.0.1", self.lst.getsockname()[1]))
        s, _ = self.lst.accept()
        s.sendall(f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
        with self.lock: self.keep.append(s)
        return c

    def create_connection(self, addr, timeout=None, source_address=None, **kw):
        host = addr[0]
        if not host.startswith("192.168."):
            return self.orig(addr, timeout, source_address)
        t = 21.0 if timeout is None else timeout
        with self.lock: self.probed.append(host)
        if host == self.lamp:
            lat = self.first if self.cold else 0.05
            self.cold = False                     # ARP у Windows дорешается и так
            if lat > t:
                time.sleep(t * SCALE); raise TimeoutError("timed out")
            time.sleep(lat * SCALE)
            return self._serve("200 OK", json.dumps(WLED_INFO).encode())
        if host.endswith(".1"):                    # роутер: веб-морда, но не WLED
            return self._serve("404 Not Found", b"no")
        time.sleep(t * SCALE); raise TimeoutError("timed out")   # адреса нет: ARP без ответа

    def __enter__(self):
        socket.create_connection = self.create_connection
        return self

    def __exit__(self, *a):
        socket.create_connection = self.orig
        for s in self.keep: s.close()
        self.lst.close()


def test_discover_window():
    saved = find_lamp.local_ipv4s
    try:
        # контроль: окно 0.4 с (как было) — у адреса одна попытка ARP/SYN
        find_lamp.local_ipv4s = lambda: ["192.168.1.107"]
        with FakeLan(lamp="192.168.1.123") as lan:
            t = time.monotonic(); hits = find_lamp.discover(timeout=0.4); d = (time.monotonic() - t) / SCALE
        check(f"окно 0.4 с (как было): лампа после простоя НЕ найдена, «скан» {d:.1f} с "
              "(в bot.log 14.11 — 1.2 с)", hits == [] and d < 2.0)
        # новое окно по умолчанию; у ПК ещё адаптер VirtualBox
        find_lamp.local_ipv4s = lambda: ["192.168.1.107", "192.168.56.1"]
        with FakeLan(lamp="192.168.1.123") as lan:
            t = time.monotonic(); hits = find_lamp.discover(); d = (time.monotonic() - t) / SCALE
        check("окно 2 с (по умолчанию): та же лампа найдена", [h["ip"] for h in hits] == ["192.168.1.123"])
        check("…с данными WLED (имя, версия, LED)", hits and hits[0]["name"] == "Лампа" and hits[0]["leds"] == 60)
        check("…опрошены все 254 адреса основной /24",
              len({h for h in lan.probed if h.startswith("192.168.1.")}) == 254)
        check("…подсеть VirtualBox после находки не сканировалась",
              not any(h.startswith("192.168.56.") for h in lan.probed))
        check(f"…/24 за разумное время: {d:.1f} с (≈ 2 волны × 2 с)", d < 2 * 2.0 + 3.0)
        # лампы нет нигде — сканируются обе подсети и честно пусто
        with FakeLan(lamp="192.168.9.9") as lan:
            hits = find_lamp.discover()
        check("лампы нет — пустой список, проверены обе подсети",
              hits == [] and any(h.startswith("192.168.56.") for h in lan.probed))
    finally:
        find_lamp.local_ipv4s = saved


def test_check_retries():
    saved_probe, saved_time = find_lamp._probe, find_lamp.time
    try:
        find_lamp.time = types.SimpleNamespace(sleep=lambda s: None)
        seen = []
        def flaky(ip, timeout, why=None, port=None):
            seen.append(timeout)
            if len(seen) < 3:
                if why is not None: why.append("TimeoutError: timed out")
                return None
            return {"ip": ip, "name": "Лампа"}
        find_lamp._probe = flaky
        hit, why = find_lamp.check("192.168.1.110")
        check("ответила с 3-й попытки → найдена", hit and hit["ip"] == "192.168.1.110" and why == "")
        check(f"таймауты растут: {seen}", seen == [2.0, 3.0, 4.0])
        seen.clear()
        find_lamp._probe = lambda ip, timeout, why=None, port=None: (why.append("TimeoutError: timed out"), None)[1]
        hit, why = find_lamp.check("192.168.1.110")
        check("молчит все 3 раза → None и причина для журнала", hit is None and "TimeoutError" in why)
        n = []
        find_lamp._probe = lambda ip, timeout, why=None, port=None: n.append(1)
        find_lamp.check("192.168.1.110", attempts=1)
        check("attempts=1 — ровно одна попытка (как раньше для diag)", len(n) == 1)
    finally:
        find_lamp._probe, find_lamp.time = saved_probe, saved_time


# ---------- 3) настоящий HTTP-опрос ----------
class _H(BaseHTTPRequestHandler):
    routes = {}
    def do_GET(self):
        code, body = self.routes.get(self.server.server_address[1], (404, b"{}"))
        self.send_response(code); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass


def _server(code, body):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _H)
    _H.routes[srv.server_address[1]] = (code, body)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_probe_real_http():
    ok = _server(200, json.dumps(WLED_INFO).encode())
    other = _server(200, json.dumps({"model": "printer"}).encode())
    nf = _server(404, b"not found")
    saved = {k: os.environ.get(k) for k in ("http_proxy", "HTTP_PROXY", "no_proxy", "NO_PROXY")}
    try:
        # системный прокси (на Windows — из реестра) не должен мешать опросу лампы в своей сети
        os.environ.update(http_proxy="http://127.0.0.1:9", HTTP_PROXY="http://127.0.0.1:9", no_proxy="", NO_PROXY="")
        d = find_lamp._probe("127.0.0.1", 2.0, port=ok.server_address[1])
        check("WLED по HTTP распознан (прокси в окружении не мешает)", d and d["name"] == "Лампа" and d["ver"] == "0.14.4")
        d2 = find_lamp._probe(f"127.0.0.1:{ok.server_address[1]}", 2.0)
        check("адрес вида IP:порт тоже работает", d2 and d2["leds"] == 60)
        why = []
        check("чужое устройство (не WLED) → None", find_lamp._probe("127.0.0.1", 2.0, why, port=other.server_address[1]) is None
              and "не WLED" in why[-1])
        why = []
        check("HTTP 404 → None, причина «HTTP 404»", find_lamp._probe("127.0.0.1", 2.0, why, port=nf.server_address[1]) is None
              and "HTTP 404" in why[-1])
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        why = []
        check("закрытый порт → None и причина записана", find_lamp._probe("127.0.0.1", 2.0, why, port=port) is None
              and "Refused" in why[-1])
    finally:
        for k, v in saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
        for srv in (ok, other, nf): srv.shutdown()


def test_cli_exit_code():
    """START.bat пишет код find_lamp.py в start.log — 0 только если лампа найдена."""
    import subprocess
    run = ("import sys; sys.path.insert(0, sys.argv[1]); import find_lamp\n"
           "find_lamp._subnets_to_scan = lambda: []\n"
           "find_lamp.env_ip = lambda: ''\n"
           "find_lamp.discover = (lambda *a, **k: [{'ip': '192.168.1.110', 'name': 'Lamp', 'ver': '0.14', 'leds': 60}])"
           " if sys.argv[2] == 'found' else (lambda *a, **k: [])\n"
           "src = open(find_lamp.__file__, encoding='utf-8').read()\n"
           "g = dict(find_lamp.__dict__, __name__='__main__')\n"
           "exec(src[src.index('if __name__ == \"__main__\":'):], g)\n")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    codes = {m: subprocess.run([sys.executable, "-c", run, str(ROOT), m], env=env, capture_output=True,
                               text=True, encoding="utf-8", timeout=60) for m in ("found", "none")}
    check("python find_lamp.py: нашёл → код 0", codes["found"].returncode == 0 and "WLED_IP=192.168.1.110" in codes["found"].stdout)
    check("python find_lamp.py: не нашёл → код 1 (виден в start.log)", codes["none"].returncode == 1)
    check("…и без пугающего «не найдена.» — только «пока не найдена»",
          "пока не найдена" in codes["none"].stdout and "❌" not in codes["none"].stdout)
    # START.bat: лампа по IP из .env отвечает → без скана всей сети
    run2 = ("import sys; sys.path.insert(0, sys.argv[1]); import find_lamp\n"
            "find_lamp.env_ip = lambda: '192.168.1.110'\n"
            "find_lamp.check = lambda ip, *a, **k: ({'ip': ip, 'name': 'Lamp'}, '') if sys.argv[2] == 'ok' else (None, 'TimeoutError: timed out')\n"
            "find_lamp.discover = lambda *a, **k: (print('DISCOVER_CALLED'), [])[1]\n"
            "src = open(find_lamp.__file__, encoding='utf-8').read()\n"
            "g = dict(find_lamp.__dict__, __name__='__main__')\n"
            "exec(src[src.index('if __name__ == \"__main__\":'):], g)\n")
    r = {m: subprocess.run([sys.executable, "-c", run2, str(ROOT), m], env=env, capture_output=True,
                           text=True, encoding="utf-8", timeout=60) for m in ("ok", "silent")}
    check("лампа из .env отвечает → код 0, сеть не сканируется",
          r["ok"].returncode == 0 and "Лампа на связи: 192.168.1.110" in r["ok"].stdout and "DISCOVER_CALLED" not in r["ok"].stdout)
    check("лампа из .env молчит → причина, затем скан, код 1",
          r["silent"].returncode == 1 and "TimeoutError" in r["silent"].stdout and "DISCOVER_CALLED" in r["silent"].stdout)
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / ".env").write_text("\ufeffWLED_BOT_TOKEN=x\nWLED_IP = 192.168.1.110\n", encoding="utf-8")
    saved = find_lamp.__file__
    try:
        find_lamp.__file__ = str(d / "find_lamp.py")
        check("env_ip читает WLED_IP из .env (BOM, пробелы)", find_lamp.env_ip() == "192.168.1.110")
        (d / ".env").unlink()
        check("env_ip без .env → пусто", find_lamp.env_ip() == "")
    finally:
        find_lamp.__file__ = saved


# ---------- 4) запуск бота: лампа при старте молчит ----------
# LAMP=late — к _post_init отвечает (как 14.11 в 13:54:09); gone — не отвечает и потом;
# second — отвечает со 2-й попытки.
PRE_LAMP_SLOW = (
    "import sys, os, asyncio, types\n"
    "sys.path.insert(0, os.path.dirname(sys.argv[1]))\n"
    "MODE = os.environ['LAMP']; n = {'probe': 0}\n"
    "import find_lamp\n"
    "find_lamp.time = types.SimpleNamespace(sleep=lambda s: None)\n"
    "def _probe(ip, timeout, why=None, port=None):\n"
    "    n['probe'] += 1\n"
    "    if MODE == 'second' and n['probe'] >= 2:\n"
    "        return {'ip': ip, 'name': 'Lamp'}\n"
    "    if why is not None: why.append('TimeoutError: timed out')\n"
    "find_lamp._probe = _probe\n"
    "def _discover(*a, **k):\n"
    "    print('DISCOVER_CALLED', flush=True); return []\n"
    "find_lamp.discover = _discover\n"
    "import wled_bot, httpx\n"
    "def _wled(req):\n"
    "    if MODE == 'gone': raise httpx.ConnectTimeout('timed out', request=req)\n"
    "    if req.url.path == '/json': return httpx.Response(200, json={'info': {'name': 'Lamp'}, 'effects': []})\n"
    "    return httpx.Response(200, json={'on': True, 'bri': 128, 'seg': [{}]})\n"
    "wled_bot._client = httpx.AsyncClient(transport=httpx.MockTransport(_wled))\n"
    "import telegram.ext\n"
    "class _Bot:\n"
    "    async def set_my_commands(self, *a, **k): pass\n"
    "    async def get_webhook_info(self, *a, **k): return types.SimpleNamespace(pending_update_count=0)\n"
    "def _run(self, *a, **k):\n"
    "    asyncio.run(wled_bot._post_init(types.SimpleNamespace(bot=_Bot())))\n"
    "telegram.ext.Application.run_polling = _run\n"
    "wled_bot.main()\n"
)


def test_bot_start_lamp_slow_no_false_alarm():
    """14.11: при старте лампа пару секунд молчала → «Лампа WLED не найдена», а
    через 20 с она отвечала. Теперь: повторы, спокойное «пока не отвечает»,
    вывод — только после повторной проверки в _post_init."""
    from test_startup import _run_bot, REAL_LIKE     # тот же запуск бота в копии проекта
    env = f"WLED_BOT_TOKEN={REAL_LIKE}\nALLOWED_USERS=42\nWLED_IP=192.168.1.110\nOPENAI_API_KEY=\n"
    code, out = _run_bot(env, extra_env={"LAMP": "late"}, pre=PRE_LAMP_SLOW, timeout=90)
    check("молчит при старте: 3 попытки, причина в журнале", "попыток: 3; TimeoutError" in out)
    check("…потом поиск в сети (вдруг сменился IP)", "DISCOVER_CALLED" in out and "пока не отвечает" in out)
    check("…и НЕТ ложной тревоги «не найдена»", "не найдена" not in out)
    check("к _post_init ответила → «🟢 Лампа на связи», без предупреждения",
          "Лампа на связи" in out and "WARNING | Лампа" not in out)

    code, out = _run_bot(env, extra_env={"LAMP": "gone"}, pre=PRE_LAMP_SLOW, timeout=90)
    check("лампа так и не ответила → одно предупреждение с подсказкой /find",
          out.count("WARNING | Лампа WLED по 192.168.1.110 не отвечает") == 1 and "/find" in out)

    code, out = _run_bot(env, extra_env={"LAMP": "second"}, pre=PRE_LAMP_SLOW, timeout=90)
    check("ответила со 2-й попытки → сеть не сканируется, тревог нет",
          "DISCOVER_CALLED" not in out and "пока не отвечает" not in out and "WARNING | Лампа" not in out)


if __name__ == "__main__":
    print("=== Поиск лампы: подсети, окно на адрес, повторы, HTTP-опрос, старт бота ===")
    for t in (test_subnets_for_user_pc, test_main_adapter_first, test_discover_window,
              test_check_retries, test_probe_real_http, test_cli_exit_code,
              test_bot_start_lamp_slow_no_false_alarm):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
