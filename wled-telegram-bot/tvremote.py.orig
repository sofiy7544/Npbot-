#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Универсальное управление телевизором Samsung по локальной сети (WiFi).

Поддерживает все сетевые протоколы Samsung с автоопределением:
  • ws-token : WebSocket secure, порт 8002 + токен (модели 2018+, Tizen)
  • ws       : WebSocket,        порт 8001          (модели 2016-2017)
  • encrypted: WebSocket+PIN,    порт 8000          (часть 2014-2015 H/J)
  • legacy   : плоский протокол, порт 55000         (модели 2014-2015)
  • Wake-on-LAN — включение полностью выключенного ТВ (магический пакет)

Автоопределение (detect) опрашивает телевизор, выбирает рабочий протокол и
запоминает его — дальше используется только он (лишние не трогаются).

Лучшее берётся из готовых решений: для ws/ws-token используется библиотека
samsungtvws (поддержка токена/REST); legacy и Wake-on-LAN реализованы на
чистом Python без зависимостей.
"""

import os
import json
import time
import socket
import base64
import select
import logging
import threading
import urllib.request

log = logging.getLogger("tvremote")
# samsungtvws на КАЖДОЕ подключение пишет INFO «New token 12345678» — это ключ
# доступа к телевизору, ему не место в logs\bot.log (журналы пересылают).
logging.getLogger("samsungtvws").setLevel(logging.WARNING)

_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(_DIR, "tv_token.txt")
NAME = "WLED Remote"

# Известные методы
WS_TOKEN = "ws-token"
WS = "ws"
ENCRYPTED = "encrypted"
LEGACY = "legacy"

# Общий конфиг телевизора — ЕДИНЫЙ для кнопок бота, веб-пульта и ИИ-ядра
# (intellect/devices/samsung_tv.py). ip из переменной окружения имеет
# приоритет над файлом tv.json.
CONFIG_FILE = os.path.join(_DIR, "tv.json")
config = {"ip": os.getenv("SAMSUNG_TV_IP", ""), "method": "", "mac": "", "name": "", "model": ""}
_mtime = -1.0   # mtime прочитанного tv.json (-1 — ещё не читали)


def _env_ip() -> str:
    # Читаем при каждом вызове: wled_bot импортирует этот модуль ДО загрузки .env,
    # поэтому значение на момент импорта всегда пустое.
    return os.getenv("SAMSUNG_TV_IP", "").strip()


def load_config():
    global _mtime
    env_ip = _env_ip()
    if env_ip:
        config["ip"] = env_ip
    try:
        _mtime = os.path.getmtime(CONFIG_FILE)
    except OSError:
        _mtime = None          # tv.json ещё нет (ТВ не настроен)
        return
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        for k in config:
            if k == "ip" and env_ip:
                continue
            if data.get(k):
                config[k] = data[k]
    except Exception:
        pass


def current() -> dict:
    """Актуальный общий конфиг. Если tv.json поменяли на ходу (кнопки, веб-пульт,
    руками) — перечитываем, без перезапуска бота. Возвращает тот же словарь config."""
    try:
        m = os.path.getmtime(CONFIG_FILE)
    except OSError:
        m = None
    if m != _mtime:
        load_config()
    return config


def save_config():
    global _mtime
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(dict(config), f, ensure_ascii=False)  # копия — thread-safe
        _mtime = os.path.getmtime(CONFIG_FILE)              # свою запись не перечитывать
    except Exception:
        pass


# ----------------------- Вспомогательное -----------------------
def _local_ip(target: str) -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _port_open(ip: str, port: int, timeout: float = 1.2) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((ip, port)) == 0
    except Exception:
        return False
    finally:
        s.close()


def _rest_info(ip: str) -> dict | None:
    """REST-инфо телевизора (порт 8001) — есть у моделей 2016+."""
    try:
        with urllib.request.urlopen(f"http://{ip}:8001/api/v2/", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


# ----------------------- Поиск телевизоров в сети -----------------------
def discover(timeout: float = 3.0) -> list:
    """Найти телевизоры в локальной сети по SSDP (UPnP/DIAL).
    Возвращает список {ip, name, model, method}. Не требует пульта."""
    sts = [
        "urn:dial-multiscreen-org:service:dial:1",     # YouTube/cast
        "urn:samsung.com:device:RemoteControlReceiver:1",
        "ssdp:all",
    ]
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    seen = {}
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        except Exception:
            pass
        s.settimeout(1.0)
        for st in sts:
            msg = ("M-SEARCH * HTTP/1.1\r\n"
                   "HOST: 239.255.255.250:1900\r\n"
                   'MAN: "ssdp:discover"\r\n'
                   "MX: 1\r\n"
                   f"ST: {st}\r\n\r\n").encode()
            try:
                s.sendto(msg, ("239.255.255.250", 1900))
            except Exception:
                pass
        end = time.monotonic() + timeout
        while time.monotonic() < end and len(seen) < 24:   # верхний предел отвечающих
            try:
                data, addr = s.recvfrom(4096)
            except socket.timeout:
                continue
            except Exception:
                break
            seen.setdefault(addr[0], data.decode("utf-8", "ignore").lower())
    finally:
        s.close()   # сокет закрывается всегда, даже при исключении

    results = []
    for ip, hdrs in list(seen.items())[:12]:   # не опрашивать REST у всех подряд
        info = _rest_info(ip)
        if info:  # ответил REST — это точно Samsung 2016+
            dev = info.get("device", {}) or {}
            token = str(dev.get("TokenAuthSupport", "")).lower() == "true"
            results.append({
                "ip": ip,
                "name": dev.get("name", "") or info.get("name", ""),
                "model": dev.get("modelName", "") or dev.get("model", ""),
                "method": WS_TOKEN if token else WS,
            })
        elif "samsung" in hdrs:
            results.append({"ip": ip, "name": "Samsung TV", "model": "", "method": ""})
    return results


# ----------------------- Автоопределение -----------------------
def detect(ip: str) -> dict:
    """Определить протокол ТВ. Возвращает {method, mac, name, model}."""
    res = {"method": None, "mac": "", "name": "", "model": ""}

    info = _rest_info(ip)
    if info:
        dev = info.get("device", {}) or {}
        res["mac"] = dev.get("wifiMac", "") or dev.get("ethernetMac", "")
        res["name"] = dev.get("name", "") or info.get("name", "")
        res["model"] = dev.get("modelName", "") or dev.get("model", "")
        token_support = str(dev.get("TokenAuthSupport", "")).lower() == "true"
        res["method"] = WS_TOKEN if token_support else WS
        return res

    # REST не ответил — пробуем по открытым портам
    if _port_open(ip, 8002):
        res["method"] = WS_TOKEN
    elif _port_open(ip, 8001):
        res["method"] = WS
    elif _port_open(ip, 55000):
        res["method"] = LEGACY
    elif _port_open(ip, 8000):
        res["method"] = ENCRYPTED
    return res


# ----------------------- Одно WebSocket-соединение с ТВ -----------------------
# Раньше КАЖДАЯ клавиша открывала новое TLS-соединение и новый сеанс на ТВ, а
# старое не закрывала. ТВ на каждый сеанс выдавал новый токен — 5 строк
# «New token …» за 14 с в logs\bot.log. Теперь соединение одно: открывается
# при первой команде и переиспользуется, пока ТВ его не закрыл и прошло
# меньше _WS_IDLE сек с прошлой команды.
_WS_IDLE = 30.0
_KEY_PAUSE = 1.0        # пауза после клавиши (прежний key_press_delay библиотеки)
_ws_lock = threading.Lock()
_ws_conn = {"key": None, "tv": None, "used": 0.0}


def _ws_close(tv) -> None:
    """Закрыть соединение сразу: close-кадр ТВ без ожидания ответа + сокет."""
    conn, tv.connection = tv.connection, None
    if conn is None:
        return
    try:
        conn.close(timeout=0)
    except Exception:
        pass
    try:
        conn.shutdown()
    except Exception:
        pass


def _ws_drop() -> None:
    """Забыть и закрыть общее соединение (вызывать под _ws_lock)."""
    tv = _ws_conn["tv"]
    _ws_conn.update(key=None, tv=None, used=0.0)
    if tv is not None:
        _ws_close(tv)


def _ws_alive(tv) -> bool:
    """Соединение живо? Накопившиеся события ТВ вычитываются и выбрасываются;
    если ТВ закрыл соединение (сон, перезагрузка) — не живо."""
    conn = tv.connection
    try:
        if conn is None or not conn.connected:
            return False
        sock = conn.sock
        while select.select([sock], [], [], 0)[0] or getattr(sock, "pending", lambda: 0)():
            conn.recv_data(control_frame=True)    # событие/ping ТВ — не нужно
            if not conn.connected:
                return False
        return True
    except Exception:
        return False


def _ws_call(ip: str, port: int, fn, timeout: float = 6):
    """Выполнить fn(tv) на общем соединении с ТВ (при необходимости — открыть)."""
    from samsungtvws import SamsungTVWS  # ленивый импорт
    with _ws_lock:
        tv = _ws_conn["tv"]
        if (tv is not None and _ws_conn["key"] == (ip, port)
                and time.monotonic() - _ws_conn["used"] < _WS_IDLE and _ws_alive(tv)):
            try:
                result = fn(tv)
                _ws_conn["used"] = time.monotonic()
                return result
            except Exception:
                pass                          # соединение оборвалось — откроем новое
        _ws_drop()
        tv = SamsungTVWS(host=ip, port=port, token_file=TOKEN_FILE, name=NAME, timeout=timeout)
        try:
            result = fn(tv)                   # send_command сам откроет соединение
        except Exception:
            _ws_close(tv)
            raise
        _ws_conn.update(key=(ip, port), tv=tv, used=time.monotonic())
        return result


# ----------------------- Отправители клавиш -----------------------
def _send_ws(ip: str, key: str, secure: bool):
    port = 8002 if secure else 8001
    _ws_call(ip, port, lambda tv: tv.send_key(key, key_press_delay=0), timeout=6)
    time.sleep(_KEY_PAUSE)  # как раньше, но вне _ws_lock: быстрые нажатия не ждут друг друга


def _b64(s: str) -> bytes:
    return base64.b64encode(s.encode()).decode().encode()


def _send_legacy(ip: str, key: str):
    port = 55000
    app = b"iphone..iapp.samsung"
    myip = _b64(_local_ip(ip))
    mac = _b64("00:11:22:33:44:55")
    name = _b64(NAME)

    auth = (b"\x64\x00"
            + bytes([len(myip)]) + b"\x00" + myip
            + bytes([len(mac)]) + b"\x00" + mac
            + bytes([len(name)]) + b"\x00" + name)
    head = (b"\x00" + bytes([len(app)]) + b"\x00" + app
            + bytes([len(auth)]) + b"\x00" + auth)

    k = _b64(key)
    cmd = b"\x00\x00\x00" + bytes([len(k)]) + b"\x00" + k
    keypkt = (b"\x00" + bytes([len(app)]) + b"\x00" + app
              + bytes([len(cmd)]) + b"\x00" + cmd)

    sock = socket.socket()
    sock.settimeout(5)
    try:
        sock.connect((ip, port))
        sock.send(head)
        sock.send(keypkt)
    finally:
        sock.close()


def _send_encrypted(ip: str, key: str):
    # Шифрованный протокол (часть H/J 2014-2015) требует PIN-пейринга.
    raise RuntimeError(
        "ТВ требует шифрованного протокола (порт 8000, PIN-пейринг). "
        "Напишите модель телевизора — настрою отдельно."
    )


# ----------------------- Wake-on-LAN -----------------------
def wake_on_lan(mac: str):
    """Включить выключенный ТВ магическим пакетом (нужен его MAC)."""
    mac = (mac or "").replace(":", "").replace("-", "").strip()
    if len(mac) != 12:
        return
    try:
        raw = bytes.fromhex(mac)
    except ValueError:
        return  # не похоже на MAC
    data = b"\xff" * 6 + raw * 16
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        s.sendto(data, ("255.255.255.255", 9))
    finally:
        s.close()


# ----------------------- Публичная отправка -----------------------
def _dispatch(ip: str, key: str, method: str):
    if method == WS_TOKEN:
        _send_ws(ip, key, secure=True)
    elif method == WS:
        _send_ws(ip, key, secure=False)
    elif method == LEGACY:
        _send_legacy(ip, key)
    elif method == ENCRYPTED:
        _send_encrypted(ip, key)
    else:
        raise RuntimeError(f"Неизвестный протокол: {method}")


def run_app(ip: str, app_id: str, method: str | None = None) -> str:
    """Запустить приложение (YouTube/Netflix и т.п.). Только WebSocket-модели."""
    from samsungtvws import SamsungTVWS  # ленивый импорт
    ports = (8001, 8002) if method == WS else (8002, 8001)
    last = None
    for port in ports:
        try:
            _ws_call(ip, port, lambda tv: tv.run_app(app_id), timeout=8)
            return WS_TOKEN if port == 8002 else WS
        except Exception as e:
            last = e
    raise last if last else RuntimeError("приложения доступны только на WebSocket-ТВ")


# Кэш списка приложений ТВ (чтобы не опрашивать каждый раз).
_apps_cache = {"ip": "", "apps": []}


def list_apps(ip: str | None = None, method: str | None = None, force: bool = False) -> list:
    """Список установленных приложений [{name, appId}] через WebSocket.
    Источник истины — сам телевизор, поэтому не нужно угадывать ID."""
    ip = ip or config.get("ip")
    if not ip:
        return []
    if not force and _apps_cache["ip"] == ip and _apps_cache["apps"]:
        return _apps_cache["apps"]
    try:
        from samsungtvws import SamsungTVWS  # ленивый импорт
    except Exception:
        return _apps_cache["apps"] if _apps_cache["ip"] == ip else []
    ports = (8001, 8002) if (method or config.get("method")) == WS else (8002, 8001)
    last = None
    for port in ports:
        try:
            raw = _ws_call(ip, port, lambda tv: tv.app_list(), timeout=8) or []
            apps = [{"name": a.get("name", ""), "appId": str(a.get("appId", ""))}
                    for a in raw if a.get("appId") and a.get("name")]
            if apps:
                _apps_cache.update(ip=ip, apps=apps)
                return apps
        except Exception as e:
            last = e
    if last:
        log.warning(f"list_apps: {last}")
    return _apps_cache["apps"] if _apps_cache["ip"] == ip else []


def power(turn_on: bool) -> bool:
    """Надёжное вкл/выкл ТВ. Вкл = Wake-on-LAN + KEY_POWERON; выкл = KEY_POWEROFF."""
    ip = config.get("ip")
    if not ip:
        return False
    method = config.get("method") or None
    try:
        if turn_on:
            if config.get("mac"):
                wake_on_lan(config["mac"])         # разбудить выключенный ТВ
            try:
                send_key(ip, "KEY_POWERON", method)
            except Exception:
                pass                               # ТВ ещё спит — хватит WoL
            return True
        send_key(ip, "KEY_POWEROFF", method)        # явное выключение (не toggle)
        return True
    except Exception as e:
        log.warning(f"power: {e}")
        return False


def open_browser(url: str, method: str | None = None) -> bool:
    """Открыть веб-браузер телевизора на URL (только WebSocket-модели)."""
    ip = config.get("ip")
    if not ip:
        return False
    try:
        from samsungtvws import SamsungTVWS  # ленивый импорт
    except Exception:
        return False
    ports = (8001, 8002) if (method or config.get("method")) == WS else (8002, 8001)
    last = None
    for port in ports:
        try:
            _ws_call(ip, port, lambda tv: tv.open_browser(url), timeout=8)
            return True
        except Exception as e:
            last = e
    log.warning(f"open_browser: {last}")
    return False


def send_key(ip: str, key: str, method: str | None = None) -> str:
    """Послать клавишу. Пробует выбранный/определённый протокол, а при неудаче
    — остальные (фолбэк). Возвращает протокол, который реально сработал, чтобы
    вызывающий мог его запомнить."""
    if not method:
        method = detect(ip).get("method")  # лучший кандидат по автоопределению

    # Порядок попыток: сначала лучший кандидат, затем остальные как фолбэк.
    order = []
    for m in ([method] if method else []) + [WS_TOKEN, WS, LEGACY]:
        if m and m not in order:
            order.append(m)

    errors = []
    for m in order:
        try:
            _dispatch(ip, key, m)
            return m  # этот протокол сработал
        except Exception as e:
            errors.append(f"{m}: {e}")
    raise RuntimeError(" | ".join(errors) or "ТВ недоступен")
