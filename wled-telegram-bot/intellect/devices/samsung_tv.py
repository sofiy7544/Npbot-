"""
samsung_tv.py — устройство Samsung TV.

Обёртка над существующим проверенным модулем tvremote.py (ws/legacy/WoL, SSDP) —
не переписываем работающее, а приводим к единому интерфейсу Device. Логику
подключения/протокола оставляем в tvremote.
"""
from __future__ import annotations

import time

from ..core.interfaces import Device, DeviceState


def _tv():
    """Ленивый импорт корневого модуля tvremote (есть в рантайме бота)."""
    import tvremote
    return tvremote


class SamsungTVDevice(Device):
    type = "samsung_tv"

    def __init__(self, ip: str | None = None):
        self._ip = ip

    def id(self) -> str:
        try:
            return self._ip or _tv().config.get("ip", "")
        except Exception:
            return self._ip or ""

    def get_state(self) -> DeviceState:
        try:
            tv = _tv()
            ip = self._ip or tv.config.get("ip")
            if not ip:
                return DeviceState(online=False)
            online = tv._port_open(ip, 8001) or tv._port_open(ip, 8002) or tv._port_open(ip, 55000)
            return DeviceState(online=bool(online), data={"ip": ip,
                              "method": tv.config.get("method", "")})
        except Exception:
            return DeviceState(online=False)

    def apply(self, command: dict) -> bool:
        action = (command.get("action") or "").lower()
        try:
            tv = _tv()
            if action == "power":
                return bool(tv.power(bool(command.get("on", True))))
            if action == "volume":
                key = "KEY_VOLUP" if command.get("dir") == "up" else "KEY_VOLDOWN"
                for _ in range(max(1, min(10, int(command.get("steps", 3))))):
                    tv.send_key(tv.config["ip"], key, tv.config.get("method") or None)
                    time.sleep(0.35)
                return True
            if action == "mute":
                tv.send_key(tv.config["ip"], "KEY_MUTE", tv.config.get("method") or None)
                return True
            if action == "key":
                tv.send_key(tv.config["ip"], str(command["key"]), tv.config.get("method") or None)
                return True
            if action == "app":
                return self._open_app(tv, str(command.get("name", "")))
        except Exception:
            return False
        return False

    @staticmethod
    def _open_app(tv, name: str) -> bool:
        apps = {"youtube": "111299001912", "ютуб": "111299001912",
                "netflix": "3201907018807", "нетфл": "3201907018807"}
        name = name.lower()
        for kw, app_id in apps.items():
            if kw in name:
                tv.run_app(tv.config["ip"], app_id, tv.config.get("method") or None)
                return True
        return False
