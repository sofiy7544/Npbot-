#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Таймеры авто-выключения (sleep-таймер) для лампы и телевизора.

Реализованы на threading.Timer — работают из любого контекста (и из бота,
и из веб-приложения), без привязки к event loop. Действия выключения —
синхронные (urllib для лампы, tvremote.send_key для ТВ).
"""

import time
import threading
import logging
import urllib.request

import tvremote

log = logging.getLogger("timers")

WLED_IP = "192.168.1.106"          # задаётся через init()
_timers = {}                        # kind -> {"timer", "ends_at", "minutes"}
_gen = {}                           # kind -> поколение (чтобы устаревший таймер не сработал)
_lock = threading.Lock()


def init(wled_ip: str):
    global WLED_IP
    WLED_IP = wled_ip


# ----------------------- Действия выключения -----------------------
def _lamp_off():
    try:
        req = urllib.request.Request(
            f"http://{WLED_IP}/json/state", data=b'{"on":false}',
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=4).read()
        log.info("Таймер: лампа выключена")
    except Exception as e:
        log.warning(f"timer lamp off: {e}")


def _tv_off():
    cfg = tvremote.config
    if not cfg.get("ip"):
        return
    try:
        # KEY_POWEROFF, а не KEY_POWER: toggle включал уже выключенный ТВ среди ночи
        if tvremote.power(False):
            log.info("Таймер: телевизор выключен")
    except Exception as e:
        log.warning(f"timer tv off: {e}")


_ACTIONS = {"lamp": _lamp_off, "tv": _tv_off}


# ----------------------- Управление таймерами -----------------------
def set_timer(kind: str, minutes) -> int:
    """Поставить таймер на N минут (0 или меньше — отменить). Возвращает остаток."""
    cancel(kind)
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        minutes = 0
    if minutes <= 0 or kind not in _ACTIONS:
        return 0
    with _lock:
        _gen[kind] = _gen.get(kind, 0) + 1     # новое поколение
        g = _gen[kind]
        t = threading.Timer(minutes * 60, _fire, args=(kind, g))
        t.daemon = True
        _timers[kind] = {"timer": t, "ends_at": time.time() + minutes * 60,
                         "minutes": minutes}
        t.start()
    return minutes


def _fire(kind: str, g: int):
    # Действие выполняется ТОЛЬКО если это всё ещё актуальное поколение таймера.
    with _lock:
        if _gen.get(kind) != g:
            return                              # таймер заменён/отменён — не срабатываем
        _timers.pop(kind, None)
    _ACTIONS[kind]()


def cancel(kind: str):
    with _lock:
        _gen[kind] = _gen.get(kind, 0) + 1     # инвалидируем текущее поколение
        info = _timers.pop(kind, None)
    if info:
        info["timer"].cancel()


def remaining(kind: str) -> int:
    """Сколько минут осталось (0 — таймер не активен)."""
    with _lock:
        info = _timers.get(kind)
    if not info:
        return 0
    return max(0, round((info["ends_at"] - time.time()) / 60))
