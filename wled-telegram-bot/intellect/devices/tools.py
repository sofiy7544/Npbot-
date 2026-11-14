"""
tools.py — регистрация инструментов устройств в AI Brain.

Именно здесь абстрактный «мозг» получает реальные руки: каждый инструмент
вызывает метод настоящего устройства (WLED/TV). Регистрируется в ToolRegistry
этапа 3. Управление устройствами безопасно (не dangerous).
"""
from __future__ import annotations

from ..ai.tools import ToolRegistry

COLOR_NAMES = {
    "красный": [255, 0, 0], "зелёный": [0, 255, 0], "зеленый": [0, 255, 0],
    "синий": [0, 0, 255], "голубой": [0, 180, 255], "жёлтый": [255, 210, 0],
    "желтый": [255, 210, 0], "оранжевый": [255, 110, 0], "фиолетовый": [150, 0, 255],
    "розовый": [255, 80, 170], "белый": [255, 255, 255], "тёплый": [255, 170, 80],
    "бирюзовый": [0, 210, 180],
}

_OBJ = {"type": "object", "properties": {}}


def register_device_tools(reg: ToolRegistry, *, wled=None, tv=None) -> None:
    if wled is not None:
        _register_wled(reg, wled)
    if tv is not None:
        _register_tv(reg, tv)


def _register_wled(reg: ToolRegistry, lamp) -> None:
    def _power(a):
        on = bool(a.get("on", True))
        ok = lamp.apply({"action": "power", "on": on})
        if not ok:
            return {"message": "⚠️ Лампа недоступна"}
        return {"message": "💡 Свет включён" if on else "💡 Свет выключен"}
    reg.add("lamp_power", "Включить или выключить лампу (свет).",
            {"type": "object", "properties": {"on": {"type": "boolean"}},
             "required": ["on"]}, _power)

    reg.add("lamp_brightness", "Задать яркость лампы в процентах (1-100).",
            {"type": "object", "properties": {"percent": {"type": "integer"}},
             "required": ["percent"]},
            lambda a: {"message": f"☀️ Яркость {int(a['percent'])}%"
                       if lamp.apply({"action": "brightness", "percent": a["percent"]})
                       else "⚠️ Лампа недоступна"})

    def _color(a):
        rgb = a.get("rgb")
        if not rgb and a.get("name"):
            rgb = COLOR_NAMES.get(str(a["name"]).lower().strip())
        if not rgb:
            return {"message": "Не понял цвет"}
        ok = lamp.apply({"action": "color", "rgb": rgb})
        return {"message": "🎨 Поменял цвет" if ok else "⚠️ Лампа недоступна"}
    reg.add("lamp_color", "Задать цвет лампы. Передай rgb [r,g,b] или name (например «синий»).",
            {"type": "object", "properties": {
                "rgb": {"type": "array", "items": {"type": "integer"}},
                "name": {"type": "string"}}},
            _color)

    reg.add("lamp_temperature", "Тёплый/холодный белый по температуре в кельвинах (1700-6500).",
            {"type": "object", "properties": {"kelvin": {"type": "integer"}},
             "required": ["kelvin"]},
            lambda a: {"message": f"🌡 Белый {int(a['kelvin'])}K"
                       if lamp.apply({"action": "temperature", "kelvin": a["kelvin"]})
                       else "⚠️ Лампа недоступна"})

    reg.add("lamp_effect", "Включить эффект лампы по индексу (список — командой /fxlist).",
            {"type": "object", "properties": {"index": {"type": "integer"}},
             "required": ["index"]},
            lambda a: {"message": f"✨ Эффект {int(a['index'])}"
                       if lamp.apply({"action": "effect", "index": a["index"]})
                       else "⚠️ Лампа недоступна"})

    reg.add("lamp_status", "Узнать текущее состояние лампы.", dict(_OBJ),
            lambda a: _lamp_status(lamp))


def _lamp_status(lamp) -> dict:
    st = lamp.get_state()
    if not st.online:
        return {"message": "💡 Лампа недоступна"}
    d = st.data
    return {"message": f"💡 Лампа: {'вкл' if d.get('on') else 'выкл'}, "
                       f"яркость {d.get('brightness')}%", "state": d}


def _register_tv(reg: ToolRegistry, tv) -> None:
    reg.add("tv_power", "Включить или выключить телевизор.",
            {"type": "object", "properties": {"on": {"type": "boolean"}},
             "required": ["on"]},
            lambda a: {"message": ("📺 Включаю телевизор" if a.get("on", True)
                                   else "📺 Выключаю телевизор")
                       if tv.apply({"action": "power", "on": a.get("on", True)})
                       else "⚠️ Телевизор недоступен"})

    reg.add("tv_volume", "Громкость телевизора: dir=up|down, steps=1..10.",
            {"type": "object", "properties": {
                "dir": {"type": "string", "enum": ["up", "down"]},
                "steps": {"type": "integer"}}, "required": ["dir"]},
            lambda a: {"message": ("🔊 Громче" if a.get("dir") == "up" else "🔉 Тише")
                       if tv.apply({"action": "volume", "dir": a.get("dir"),
                                    "steps": a.get("steps", 3)})
                       else "⚠️ Телевизор недоступен"})

    reg.add("tv_mute", "Выключить/включить звук телевизора.", dict(_OBJ),
            lambda a: {"message": "🔇 Звук" if tv.apply({"action": "mute"})
                       else "⚠️ Телевизор недоступен"})

    reg.add("tv_key", "Нажать клавишу пульта (KEY_UP/KEY_ENTER/KEY_RETURN/KEY_PLAY/…).",
            {"type": "object", "properties": {"key": {"type": "string"}},
             "required": ["key"]},
            lambda a: {"message": f"🎮 {a['key']}" if tv.apply({"action": "key", "key": a["key"]})
                       else "⚠️ Телевизор недоступен"})

    reg.add("tv_app", "Открыть приложение на ТВ (youtube/netflix).",
            {"type": "object", "properties": {"name": {"type": "string"}},
             "required": ["name"]},
            lambda a: {"message": f"📺 Открываю {a['name']}"
                       if tv.apply({"action": "app", "name": a["name"]})
                       else "⚠️ Не вышло открыть приложение"})
