"""
samsung_tv.py — устройство Samsung TV.

Обёртка над существующим проверенным модулем tvremote.py (ws/legacy/WoL, SSDP) —
не переписываем работающее, а приводим к единому интерфейсу Device. Логику
подключения/протокола оставляем в tvremote.

Единый источник истины — общий конфиг tvremote (tv.json + tv_token.txt), тот же,
что у кнопок пульта в Telegram и у веб-пульта. Своего IP устройство не хранит:
иначе ИИ и кнопки смотрят в разные места. tv.json, изменённый на ходу,
подхватывается без перезапуска (tvremote.current()).
"""
from __future__ import annotations

import logging
import time

from ..core.interfaces import Device, DeviceState

log = logging.getLogger("intellect.tv")


def _tv():
    """Ленивый импорт корневого модуля tvremote (есть в рантайме бота)."""
    import tvremote
    return tvremote


class SamsungTVDevice(Device):
    type = "samsung_tv"

    def __init__(self, ip: str | None = None):
        # Совместимость: явный IP лишь подставляется в ОБЩИЙ конфиг, если там пусто.
        if ip:
            try:
                cfg = _tv().current()
                if not cfg.get("ip"):
                    cfg["ip"] = ip
            except Exception:
                pass

    @staticmethod
    def _cfg() -> dict:
        return _tv().current()

    def configured(self) -> bool:
        try:
            return bool(self._cfg().get("ip"))
        except Exception:
            return False

    def id(self) -> str:
        try:
            return self._cfg().get("ip", "")
        except Exception:
            return ""

    def get_state(self) -> DeviceState:
        try:
            tv = _tv()
            cfg = tv.current()
            ip = cfg.get("ip") or ""
            data = {"ip": ip, "method": cfg.get("method", ""), "model": cfg.get("model", ""),
                    "name": cfg.get("name", ""), "configured": bool(ip)}
            if not ip:
                return DeviceState(online=False, data=data)
            online = tv._port_open(ip, 8001) or tv._port_open(ip, 8002) or tv._port_open(ip, 55000)
            return DeviceState(online=bool(online), data=data)
        except Exception:
            return DeviceState(online=False)

    @staticmethod
    def _key(tv, cfg: dict, key: str) -> None:
        # как кнопки пульта (wled_bot._tv_key): запомнить реально сработавший протокол
        m = tv.send_key(cfg["ip"], key, cfg.get("method") or None)
        if m and m != cfg.get("method"):
            cfg["method"] = m
            tv.save_config()

    def apply(self, command: dict) -> bool:
        action = (command.get("action") or "").lower()
        try:
            tv = _tv()
            cfg = tv.current()
            if not cfg.get("ip"):
                return False               # не настроен — не стучимся в пустой адрес
            if action == "power":
                return bool(tv.power(bool(command.get("on", True))))
            if action == "volume":
                key = "KEY_VOLUP" if command.get("dir") == "up" else "KEY_VOLDOWN"
                for _ in range(max(1, min(10, int(command.get("steps", 3))))):
                    self._key(tv, cfg, key)
                    time.sleep(0.35)
                return True
            if action == "mute":
                self._key(tv, cfg, "KEY_MUTE")
                return True
            if action == "key":
                self._key(tv, cfg, str(command["key"]))
                return True
            if action == "app":
                return self._open_app(tv, cfg, str(command.get("name", "")))
        except Exception as e:
            log.warning(f"ТВ {action}: {type(e).__name__}: {e}")
            return False
        return False

    @staticmethod
    def _open_app(tv, cfg: dict, name: str) -> bool:
        apps = {"youtube": "111299001912", "ютуб": "111299001912",
                "netflix": "3201907018807", "нетфл": "3201907018807"}
        name = name.lower()
        for kw, app_id in apps.items():
            if kw in name:
                tv.run_app(cfg["ip"], app_id, cfg.get("method") or None)
                return True
        return False
