"""
wled.py — устройство WLED (официальный JSON API).

Полный набор: питание, яркость, цвет RGB, температура белого, эффект, пресет,
получение состояния. Транспорт инъектируемый (для тестов без железа).
"""
from __future__ import annotations

import json
import math
import urllib.request

from ..core.interfaces import Device, DeviceState

BRI_MAX = 255
KELVIN_MIN, KELVIN_MAX = 1700, 6500


def kelvin_to_rgb(kelvin: int) -> list[int]:
    """Приближение цветовой температуры → RGB (для ламп без CCT)."""
    t = max(KELVIN_MIN, min(KELVIN_MAX, kelvin)) / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else
                               138.5177312231 * math.log(t - 10) - 305.0447927307)
    return [max(0, min(255, int(x))) for x in (r, g, b)]


class HttpTransport:
    """Реальный HTTP-транспорт к лампе (urllib, без внешних зависимостей)."""
    def __init__(self, timeout: float = 4.0):
        self.timeout = timeout

    def get_json(self, url: str) -> dict:
        with urllib.request.urlopen(url, timeout=self.timeout) as r:
            return json.loads(r.read())

    def post_json(self, url: str, payload: dict) -> bool:
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return r.status == 200


class WledDevice(Device):
    type = "wled"

    def __init__(self, ip: str, *, transport: HttpTransport | None = None):
        self.ip = ip
        self._t = transport or HttpTransport()

    def id(self) -> str:
        return self.ip

    # ----------------------- чтение состояния -----------------------
    def get_state(self) -> DeviceState:
        try:
            st = self._t.get_json(f"http://{self.ip}/json/state")
            info = {}
            try:
                info = self._t.get_json(f"http://{self.ip}/json/info")
            except Exception:
                pass
            seg = (st.get("seg") or [{}])[0]
            return DeviceState(online=True, data={
                "on": st.get("on", False),
                "brightness": round(st.get("bri", 0) / BRI_MAX * 100),
                "color": (seg.get("col") or [[0, 0, 0]])[0],
                "effect": seg.get("fx", 0),
                "name": info.get("name", "WLED"),
                "raw": st,
            })
        except Exception:
            return DeviceState(online=False)

    # ----------------------- команды -----------------------
    def apply(self, command: dict) -> bool:
        payload = self._build_payload(command)
        if payload is None:
            return False
        try:
            return self._t.post_json(f"http://{self.ip}/json/state", payload)
        except Exception:
            return False

    @staticmethod
    def _build_payload(cmd: dict) -> dict | None:
        action = (cmd.get("action") or "").lower()
        if action == "power":
            return {"on": bool(cmd.get("on", True))}
        if action == "toggle":
            return {"on": "t"}
        if action == "brightness":
            p = max(1, min(100, int(cmd["percent"])))
            return {"on": True, "bri": round(p / 100 * BRI_MAX)}
        if action == "color":
            rgb = [int(c) for c in cmd["rgb"]][:3]
            return {"on": True, "seg": [{"col": [rgb]}]}
        if action == "temperature":
            rgb = kelvin_to_rgb(int(cmd["kelvin"]))
            return {"on": True, "seg": [{"col": [rgb]}]}
        if action == "effect":
            return {"on": True, "seg": [{"fx": int(cmd["index"])}]}
        if action == "preset":
            return {"ps": int(cmd["preset"])}
        return None
