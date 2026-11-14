#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 6 (Devices): WLED на фейковом транспорте + инструменты Brain."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.devices import WledDevice, DeviceRegistry, register_device_tools
from intellect.devices.wled import kelvin_to_rgb
from intellect.ai import ToolRegistry, Brain, ModelRouter, FakeProvider
from intellect.core.interfaces import ToolCall, DeviceState

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


class FakeTransport:
    """Эмулирует лампу: хранит состояние, принимает POST, отвечает на GET."""
    def __init__(self):
        self.state = {"on": False, "bri": 128, "seg": [{"col": [[255, 255, 255]], "fx": 0}]}
        self.posts = []
    def get_json(self, url):
        if url.endswith("/json/state"):
            return self.state
        if url.endswith("/json/info"):
            return {"name": "Лампа-тест"}
        raise ValueError(url)
    def post_json(self, url, payload):
        self.posts.append(payload)
        self.state.update({k: v for k, v in payload.items() if k != "seg"})
        if "seg" in payload:
            self.state["seg"] = payload["seg"]
        return True


def test_wled_payloads():
    t = FakeTransport()
    lamp = WledDevice("1.2.3.4", transport=t)
    check("power on", lamp.apply({"action": "power", "on": True}) and t.state["on"] is True)
    check("brightness 50% -> bri 128", lamp.apply({"action": "brightness", "percent": 50})
          and t.posts[-1]["bri"] == 128)
    check("color rgb", lamp.apply({"action": "color", "rgb": [10, 20, 30]})
          and t.posts[-1]["seg"][0]["col"][0] == [10, 20, 30])
    check("effect index", lamp.apply({"action": "effect", "index": 5})
          and t.posts[-1]["seg"][0]["fx"] == 5)


def test_wled_state():
    t = FakeTransport(); t.state["on"] = True; t.state["bri"] = 255
    lamp = WledDevice("1.2.3.4", transport=t)
    st = lamp.get_state()
    check("get_state online", st.online)
    check("get_state brightness 100%", st.data["brightness"] == 100)
    check("get_state name", st.data["name"] == "Лампа-тест")


def test_kelvin():
    warm = kelvin_to_rgb(2700); cold = kelvin_to_rgb(6500)
    check("тёплый краснее холодного", warm[0] >= cold[0] and warm[2] < cold[2])


def test_brain_controls_lamp_via_tools():
    t = FakeTransport()
    lamp = WledDevice("1.2.3.4", transport=t)
    reg = ToolRegistry()
    register_device_tools(reg, wled=lamp)
    check("зарегистрированы инструменты лампы", "lamp_color" in reg.names())
    # мозг решает вызвать lamp_color
    prov = FakeProvider(scripted=lambda m: {"text": "",
        "tool_calls": [ToolCall("lamp_color", {"name": "синий"})]})
    brain = Brain(prov, ModelRouter("f", "s"), reg)
    res = brain.understand("сделай свет синим")
    check("лампа реально получила синий",
          t.posts and t.posts[-1]["seg"][0]["col"][0] == [0, 0, 255])
    check("ответ про цвет", "цвет" in res.reply.lower())


def test_registry_status():
    class _Dev:
        type = "mock"
        def id(self): return "x"
        def get_state(self): return DeviceState(online=True, data={"on": True})
        def apply(self, c): return True
        def available(self): return True
    reg = DeviceRegistry(db=None)
    reg.add("mock", _Dev())
    st = reg.status()
    check("статус устройства", st["mock"]["online"] is True)


if __name__ == "__main__":
    print("=== ЭТАП 6: тесты Devices ===")
    for t in (test_wled_payloads, test_wled_state, test_kelvin,
              test_brain_controls_lamp_via_tools, test_registry_status):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
