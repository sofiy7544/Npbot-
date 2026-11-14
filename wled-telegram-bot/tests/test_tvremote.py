#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты пульта Samsung (tvremote): одно соединение на все клавиши, переподключение,
токен телевизора не попадает в журнал. Настоящая samsungtvws + фейковый ТВ на 127.0.0.1."""
import base64, hashlib, io, json, logging, os, random, socket, struct, sys, tempfile, threading, time
import urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import diaglog
import tvremote

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def _frame(payload: bytes, opcode: int = 1) -> bytes:
    n = len(payload)
    head = bytes([0x80 | opcode]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack("!H", n))
    return head + payload


def _exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


class FakeTV:
    """Минимальный «телевизор»: WebSocket /api/v2/channels/samsung.remote.control.
    На каждое подключение — ms.channel.connect с НОВЫМ токеном (как UE55NU7093 из журнала)."""
    def __init__(self, close_after=None):
        self.sessions, self.close_after, self._live = [], close_after, {}
        self.srv = socket.socket(); self.srv.bind(("127.0.0.1", 0)); self.srv.listen(8)
        self.port = self.srv.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def open_now(self):
        return len(self._live)

    def _accept(self):
        while True:
            try:
                s, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._session, args=(s,), daemon=True).start()

    def _session(self, s):
        rec = None
        try:
            req = b""
            while b"\r\n\r\n" not in req:
                req += s.recv(4096) or b"\r\n\r\n"
            lines = req.decode().split("\r\n")
            hdr = {k.lower(): v.strip() for k, v in (l.split(":", 1) for l in lines[1:] if ":" in l)}
            key = base64.b64encode(hashlib.sha1((hdr["sec-websocket-key"] +
                  "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            s.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Accept: {key}\r\n\r\n").encode())
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(lines[0].split()[1]).query))
            rec = {"name": base64.b64decode(q.get("name", "")).decode(), "issued": str(random.randint(10**7, 10**8 - 1)),
                   "cmds": [], "end": None}
            self.sessions.append(rec); self._live[id(rec)] = s
            s.sendall(_frame(json.dumps({"event": "ms.channel.connect", "data": {"token": rec["issued"]}}).encode()))
            s.sendall(_frame(b'{"event": "ms.remote.touchEnable", "data": {}}'))   # событие, которое бот не читает
            while True:
                b0, b1 = _exact(s, 2)
                n = b1 & 0x7F
                if n == 126:
                    n = struct.unpack("!H", _exact(s, 2))[0]
                mask = _exact(s, 4)
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(_exact(s, n)))
                if b0 & 0x0F == 8:
                    rec["end"] = "close-кадр"; s.sendall(_frame(data[:2], 8)); return
                if b0 & 0x0F != 1:
                    continue                                                 # pong и прочие служебные кадры
                cmd = json.loads(data); rec["cmds"].append(cmd)
                p = cmd.get("params", {})
                if p.get("event") == "ed.installedApp.get":
                    s.sendall(_frame(json.dumps({"event": "ed.installedApp.get", "data": {"data": [
                        {"name": "YouTube", "appId": "111299001912"}]}}).encode()))
                s.sendall(_frame(b"ping", 9))                                # ТВ может слать ping
                if self.close_after and len(rec["cmds"]) >= self.close_after:
                    s.sendall(_frame(b"\x03\xe8", 8)); rec["end"] = "закрыл ТВ"; return
        except (EOFError, OSError, ValueError, KeyError):
            if rec is not None and rec["end"] is None:
                rec["end"] = "обрыв"
        finally:
            if rec is not None:
                self._live.pop(id(rec), None)
            s.close()

    def stop(self):
        try:
            self.srv.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.srv.close()


def keys(rec):
    return [c["params"].get("DataOfCmd") or c["params"].get("event") for c in rec["cmds"]]


_real_ws_call = tvremote._ws_call
_TMP = tempfile.mkdtemp()


def _use(tv):
    """Порт 8002/8001 → порт фейкового ТВ; токен — во временный файл (не трогаем настоящий)."""
    with tvremote._ws_lock:
        tvremote._ws_drop()
    tvremote.TOKEN_FILE = os.path.join(_TMP, "tv_token.txt")
    tvremote.CONFIG_FILE = os.path.join(_TMP, "tv.json")      # настоящий tv.json бота не читаем
    tvremote._KEY_PAUSE = 0.05
    tvremote._WS_IDLE = 30.0
    port = tv.port if tv else 1     # 1 — заведомо закрытый порт («ТВ выключен»)
    tvremote._ws_call = lambda ip, _p, fn, timeout=6: _real_ws_call(ip, port, fn, timeout=2)


def test_one_connection_for_many_keys():
    tv = FakeTV(); _use(tv)
    seq = ["KEY_PAUSE", "KEY_PLAY", "KEY_VOLUP", "KEY_VOLDOWN", "KEY_MUTE"]
    for k in seq:
        tvremote.send_key("127.0.0.1", k, "ws-token")
    check(f"5 клавиш → 1 подключение к ТВ (было 5 и 5 «New token»), сейчас: {len(tv.sessions)}",
          len(tv.sessions) == 1)
    check("все клавиши дошли по порядку", keys(tv.sessions[0]) == seq)
    check("имя клиента прежнее — «WLED Remote» (ТВ не спросит разрешение заново)",
          tv.sessions[0]["name"] == tvremote.NAME == "WLED Remote")
    tv.stop()


def test_concurrent_taps():
    tv = FakeTV(); _use(tv); errs = []
    def tap(k):
        try:
            tvremote.send_key("127.0.0.1", k, "ws-token")
        except Exception as e:
            errs.append(e)
    th = [threading.Thread(target=tap, args=(f"KEY_{i}",)) for i in range(6)]
    [t.start() for t in th]; [t.join() for t in th]
    check("6 одновременных нажатий → 1 подключение, без ошибок",
          len(tv.sessions) == 1 and not errs and len(tv.sessions[0]["cmds"]) == 6)
    tv.stop()


def test_reconnect_when_tv_closed():
    tv = FakeTV(close_after=2); _use(tv)
    for k in ["KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_ENTER"]:
        tvremote.send_key("127.0.0.1", k, "ws-token")
        time.sleep(0.05)
    check("ТВ закрыл соединение (сон/перезагрузка) → бот сам переподключился, клавиши не потерялись",
          [keys(r) for r in tv.sessions] == [["KEY_UP", "KEY_DOWN"], ["KEY_LEFT", "KEY_RIGHT"], ["KEY_ENTER"]])
    tv.stop()


def test_idle_reconnect_closes_old():
    tv = FakeTV(); _use(tv); tvremote._WS_IDLE = 0.2
    tvremote.send_key("127.0.0.1", "KEY_HOME", "ws-token")
    time.sleep(0.35)
    tvremote.send_key("127.0.0.1", "KEY_HOME", "ws-token")
    time.sleep(0.2)
    check("после простоя — новое подключение, а старое закрыто корректно (не висит)",
          len(tv.sessions) == 2 and tv.sessions[0]["end"] == "close-кадр" and tv.open_now() == 1)
    tv.stop()


def test_apps_use_same_connection():
    tv = FakeTV(); _use(tv)
    old_ip = tvremote.config.get("ip"); tvremote.config["ip"] = "127.0.0.1"
    try:
        tvremote.send_key("127.0.0.1", "KEY_HOME", "ws-token")
        tvremote.run_app("127.0.0.1", "111299001912", "ws-token")
        apps = tvremote.list_apps("127.0.0.1", "ws-token", force=True)
        ok = tvremote.open_browser("https://m.youtube.com", "ws-token")
    finally:
        tvremote.config["ip"] = old_ip
    check("приложения/браузер/список — по тому же подключению", len(tv.sessions) == 1 and ok)
    check("список приложений читается (лишние события ТВ не мешают)",
          apps == [{"name": "YouTube", "appId": "111299001912"}])
    tv.stop()


def test_tv_off():
    _use(None)
    t0 = time.monotonic()
    try:
        tvremote.send_key("127.0.0.1", "KEY_MUTE", "ws-token"); failed = False
    except RuntimeError:
        failed = True
    check("ТВ выключен → понятная ошибка, ничего не закэшировано",
          failed and tvremote._ws_conn["tv"] is None and time.monotonic() - t0 < 10)


def test_tv_token_not_in_log():
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(diaglog.RedactingFormatter("%(asctime)s | %(levelname)s | %(message)s"))
    root = logging.getLogger(); old = (root.level, root.handlers[:])
    root.handlers = [h]; root.setLevel(logging.INFO)            # как в wled_bot.py
    tv = FakeTV(); _use(tv)
    try:
        tvremote.send_key("127.0.0.1", "KEY_HOME", "ws-token")
    finally:
        root.handlers = old[1]; root.setLevel(old[0])
    issued = tv.sessions[0]["issued"]
    check("токен ТВ сохранён в tv_token.txt (пульт работает как раньше)",
          open(tvremote.TOKEN_FILE).read() == issued)
    check("в журнал НЕ попала строка «New token <токен ТВ>»", issued not in buf.getvalue())
    tv.stop()
    for raw in ("2026-01-01 10:00:00,000 | INFO | New token 12345678",
                "WS url wss://192.168.1.50:8002/api/v2/channels/samsung.remote.control?name=V0xF&token=12345678",
                "Save token to file: 12345678", "event {'data': {'token': '12345678'}}", '{"token":"12345678"}'):
        check(f"redact прячет токен ТВ: {raw[:48]}…", "12345678" not in diaglog.redact(raw))
    plain = "Лампа 192.168.1.20, ID 5550001234, порт 8090, WLED_BOT_TOKEN = задан (1122…, формат ок)"
    check("обычные числа/ID/IP и маска токена бота не тронуты", diaglog.redact(plain) == plain)


def test_saved_token_is_sent_on_8002():
    from samsungtvws import SamsungTVWS
    path = os.path.join(_TMP, "t.txt")
    with open(path, "w") as f:
        f.write("87654321")
    url = SamsungTVWS("192.168.1.50", port=8002, token_file=path, name=tvremote.NAME)._format_websocket_url(
        "samsung.remote.control")
    check("на 8002 сохранённый токен уходит в URL (wss, &token=…)",
          url.startswith("wss://192.168.1.50:8002/api/v2/channels/samsung.remote.control?") and "token=87654321" in url)


if __name__ == "__main__":
    print("=== Пульт Samsung (tvremote): одно соединение, токен не в журнале ===")
    for t in (test_one_connection_for_many_keys, test_concurrent_taps, test_reconnect_when_tv_closed,
              test_idle_reconnect_closes_old, test_apps_use_same_connection, test_tv_off,
              test_tv_token_not_in_log, test_saved_token_is_sent_on_8002):
        print(f"\n[{t.__name__}]")
        try:
            t()
        except Exception as e:
            check(f"{t.__name__}: исключение {e!r}", False)
    tvremote._ws_call = _real_ws_call
    with tvremote._ws_lock:
        tvremote._ws_drop()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
