"""
registry.py — реестр устройств + проверка доступности.

Хранит объекты устройств, пишет снимки состояния в device_states (для панели и
мониторинга), отдаёт сводный статус. Метаданные устройств — в таблице devices.
"""
from __future__ import annotations

import json
import time

from ..core.interfaces import Device


class DeviceRegistry:
    def __init__(self, db=None):
        self.db = db
        self._devices: dict[str, Device] = {}

    def add(self, key: str, device: Device) -> None:
        self._devices[key] = device
        if self.db:
            try:
                self.db.execute(
                    "INSERT INTO devices(type, name, address, enabled, created_at) "
                    "VALUES (?,?,?,1,?) ON CONFLICT(type, address) DO NOTHING",
                    (device.type, key, device.id(), time.time()))
            except Exception:
                pass

    def get(self, key: str) -> Device | None:
        return self._devices.get(key)

    def keys(self) -> list[str]:
        return list(self._devices)

    def status(self) -> dict:
        """Снимок состояния всех устройств (для Dashboard/мониторинга)."""
        out = {}
        for key, dev in self._devices.items():
            try:
                st = dev.get_state()
                out[key] = {"type": dev.type, "online": st.online, **st.data}
                self._persist(dev, st)
            except Exception as e:
                out[key] = {"type": dev.type, "online": False, "error": type(e).__name__}
        return out

    def _persist(self, dev: Device, st) -> None:
        if not self.db:
            return
        try:
            row = self.db.query_one(
                "SELECT id FROM devices WHERE type=? AND address=?", (dev.type, dev.id()))
            if row:
                now = time.time()
                self.db.insert("device_states", {
                    "device_id": row["id"], "online": 1 if st.online else 0,
                    "state": json.dumps(st.data, ensure_ascii=False, default=str),
                    "checked_at": now})
                # история только за 3 дня — база на слабом ПК не должна расти бесконечно
                self._persist_n = getattr(self, "_persist_n", 0) + 1
                if self._persist_n % 200 == 1:
                    self.db.execute("DELETE FROM device_states WHERE checked_at < ?", (now - 3 * 86400,))
        except Exception:
            pass
