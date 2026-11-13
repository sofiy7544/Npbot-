"""
lamp.py — модель состояния лампы и драйверы «железа».

Здесь всё, что знает КАК светить. Выше (brain.py) решается ЧТО сделать,
ниже (драйверы) — через что именно управлять реальной лампой.

Драйвер выбирается в .env переменной LAMP_BACKEND:
  sim       — симулятор (по умолчанию), работает без оборудования
  yeelight  — реальная лампа Yeelight/Xiaomi по локальной сети

Чтобы добавить свою лампу (Tuya, Tapo, ESP, ...) — достаточно написать
класс-наследник LampDriver и зарегистрировать его в make_driver().
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, asdict
from pathlib import Path

# Границы «железа» — типичные для умных ламп
BRI_MIN, BRI_MAX = 1, 100          # яркость, %
KELVIN_MIN, KELVIN_MAX = 1700, 6500  # цветовая температура белого, K

STATE_FILE = Path(__file__).parent / "lamp_state.json"


# ─────────────────────────── Состояние лампы ───────────────────────────

@dataclass
class LampState:
    power: bool = False
    brightness: int = 60           # 1..100
    mode: str = "white"            # "white" (по температуре) | "color" (RGB)
    kelvin: int = 2700             # используется в режиме white
    rgb: tuple[int, int, int] = (255, 180, 80)  # используется в режиме color

    def clamp(self) -> "LampState":
        self.brightness = max(BRI_MIN, min(BRI_MAX, int(self.brightness)))
        self.kelvin = max(KELVIN_MIN, min(KELVIN_MAX, int(self.kelvin)))
        r, g, b = self.rgb
        self.rgb = (
            max(0, min(255, int(r))),
            max(0, min(255, int(g))),
            max(0, min(255, int(b))),
        )
        if self.mode not in ("white", "color"):
            self.mode = "white"
        return self

    def human(self) -> str:
        """Короткое человекочитаемое описание — для ответов и статуса."""
        if not self.power:
            return "выключена"
        if self.mode == "white":
            if self.kelvin <= 2400:
                warmth = "очень тёплый"
            elif self.kelvin <= 3200:
                warmth = "тёплый"
            elif self.kelvin <= 4500:
                warmth = "нейтральный"
            else:
                warmth = "холодный"
            return f"белый свет, {warmth} ({self.kelvin}K), яркость {self.brightness}%"
        r, g, b = self.rgb
        return f"цвет RGB({r},{g},{b}), яркость {self.brightness}%"


# ───────────────── Температура (K) → RGB для отрисовки ──────────────────

def kelvin_to_rgb(kelvin: int) -> tuple[int, int, int]:
    """Приближение Таннера Хелланда: цветовая температура → RGB.
    Нужно только чтобы «белый тёплый/холодный» выглядел правдоподобно на картинке."""
    temp = max(1000, min(40000, kelvin)) / 100.0

    if temp <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(temp) - 161.1195681661
    else:
        r = 329.698727446 * ((temp - 60) ** -0.1332047592)
        g = 288.1221695283 * ((temp - 60) ** -0.0755148492)

    if temp >= 66:
        b = 255.0
    elif temp <= 19:
        b = 0.0
    else:
        b = 138.5177312231 * math.log(temp - 10) - 305.0447927307

    return (
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b))),
    )


def display_rgb(state: LampState) -> tuple[int, int, int]:
    """Итоговый цвет свечения с учётом режима и яркости — для картинки."""
    if not state.power:
        return (40, 40, 46)
    base = state.rgb if state.mode == "color" else kelvin_to_rgb(state.kelvin)
    k = 0.25 + 0.75 * (state.brightness / 100.0)  # не гасим в ноль, чтобы цвет был виден
    return tuple(int(c * k) for c in base)


# ─────────────────────────── Драйверы «железа» ──────────────────────────

class LampDriver:
    """Базовый интерфейс. Любая реальная лампа реализует эти методы."""

    def apply(self, state: LampState) -> None:
        """Отправить ВСЁ состояние на лампу (идемпотентно)."""
        raise NotImplementedError


class SimulatedLamp(LampDriver):
    """Ничего не делает с железом — состояние живёт в LampState/файле.
    Нужен, чтобы бот работал и его было видно (картинкой) без оборудования."""

    def apply(self, state: LampState) -> None:
        pass  # вся «работа» — это сохранение состояния контроллером


class YeelightLamp(LampDriver):
    """Реальная лампа Yeelight/Xiaomi по локальной сети.

    Требует: pip install yeelight, и включённый «режим LAN/разработчика»
    в приложении Yeelight (иначе лампа не принимает локальные команды).
    IP лампы задаётся в .env (YEELIGHT_IP).
    """

    def __init__(self, ip: str):
        from yeelight import Bulb  # импорт здесь, чтобы sim-режим не требовал пакет
        self.ip = ip
        self._Bulb = Bulb
        self.bulb = Bulb(ip, effect="smooth", duration=400, auto_on=True)

    def apply(self, state: LampState) -> None:
        if not state.power:
            self.bulb.turn_off()
            return
        self.bulb.turn_on()
        if state.mode == "color":
            r, g, b = state.rgb
            self.bulb.set_rgb(r, g, b)
        else:
            self.bulb.set_color_temp(state.kelvin)
        self.bulb.set_brightness(state.brightness)


def make_driver() -> LampDriver:
    backend = os.getenv("LAMP_BACKEND", "sim").strip().lower()
    if backend == "yeelight":
        ip = os.getenv("YEELIGHT_IP", "").strip()
        if not ip:
            raise RuntimeError("LAMP_BACKEND=yeelight, но YEELIGHT_IP не задан в .env")
        return YeelightLamp(ip)
    # сюда позже: "tuya" -> TuyaLamp(...), "tapo" -> TapoLamp(...)
    return SimulatedLamp()


# ──────────────────── Контроллер: применяет действия ────────────────────

SCENES: dict[str, dict] = {
    # name -> частичное состояние
    "утро":       {"power": True, "mode": "white", "kelvin": 5200, "brightness": 90},
    "день":       {"power": True, "mode": "white", "kelvin": 4300, "brightness": 100},
    "вечер":      {"power": True, "mode": "white", "kelvin": 2700, "brightness": 55},
    "ужин":       {"power": True, "mode": "white", "kelvin": 2500, "brightness": 45},
    "чтение":     {"power": True, "mode": "white", "kelvin": 4000, "brightness": 95},
    "работа":     {"power": True, "mode": "white", "kelvin": 4500, "brightness": 100},
    "фокус":      {"power": True, "mode": "white", "kelvin": 4500, "brightness": 100},
    "кино":       {"power": True, "mode": "color", "rgb": (40, 20, 90), "brightness": 20},
    "ночник":     {"power": True, "mode": "color", "rgb": (120, 40, 10), "brightness": 8},
    "романтика":  {"power": True, "mode": "color", "rgb": (200, 30, 60), "brightness": 25},
    "вечеринка":  {"power": True, "mode": "color", "rgb": (255, 0, 160), "brightness": 100},
    "релакс":     {"power": True, "mode": "color", "rgb": (30, 120, 160), "brightness": 35},
}


class LampController:
    """Хранит состояние, применяет действия от мозга, толкает в драйвер."""

    def __init__(self, driver: LampDriver | None = None):
        self.driver = driver or make_driver()
        self.state = self._load()

    # --- персистентность ---
    def _load(self) -> LampState:
        try:
            data = json.loads(STATE_FILE.read_text("utf-8"))
            st = LampState(**data)
            st.rgb = tuple(st.rgb)
            return st.clamp()
        except Exception:
            return LampState()

    def _save(self) -> None:
        try:
            STATE_FILE.write_text(json.dumps(asdict(self.state), ensure_ascii=False, indent=2), "utf-8")
        except Exception:
            pass

    # --- применение одного действия ---
    def apply_action(self, action: dict) -> None:
        t = (action.get("type") or "").lower()
        s = self.state

        if t == "power":
            s.power = bool(action.get("on", True))
        elif t == "power_toggle":
            s.power = not s.power
        elif t == "brightness":
            s.power = True
            s.brightness = int(action["percent"])
        elif t == "brightness_delta":
            s.power = True
            s.brightness = s.brightness + int(action["percent"])
        elif t == "temperature":
            s.power = True
            s.mode = "white"
            s.kelvin = int(action["kelvin"])
        elif t == "temperature_delta":
            s.power = True
            s.mode = "white"
            s.kelvin = s.kelvin + int(action["kelvin"])
        elif t == "color":
            s.power = True
            s.mode = "color"
            rgb = action["rgb"]
            s.rgb = (int(rgb[0]), int(rgb[1]), int(rgb[2]))
        elif t == "scene":
            name = (action.get("name") or "").lower().strip()
            patch = SCENES.get(name)
            if patch:
                for k, v in patch.items():
                    setattr(s, k, tuple(v) if k == "rgb" else v)
        elif t == "status":
            pass  # ничего не меняем — только рассказать
        # неизвестные типы молча игнорируем

        s.clamp()

    def apply_many(self, actions: list[dict]) -> LampState:
        for a in actions or []:
            try:
                self.apply_action(a)
            except Exception:
                continue
        # один раз пушим итог в железо и сохраняем
        try:
            self.driver.apply(self.state)
        except Exception as e:
            print(f"[driver] ошибка применения к лампе: {e}")
        self._save()
        return self.state
