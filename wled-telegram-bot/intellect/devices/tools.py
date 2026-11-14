"""
tools.py — регистрация инструментов устройств в AI Brain.

Именно здесь абстрактный «мозг» получает реальные руки: каждый инструмент
вызывает метод настоящего устройства (WLED/TV). Регистрируется в ToolRegistry
этапа 3. Управление устройствами безопасно (не dangerous).
"""
from __future__ import annotations

import re

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

    reg.add("lamp_scene",
            "Готовая сцена света по настроению. Используй для «спать/спокойно/"
            "ночник/вечер/чтение/работа/кино/дискотека/вечеринка/романтика/релакс». "
            "ВАЖНО: спокойные сцены (сон/ночник/вечер/чтение) выключают любой "
            "мигающий эффект.",
            {"type": "object",
             "properties": {"name": {"type": "string",
                 "enum": list(LAMP_SCENES.keys())}},
             "required": ["name"]},
            lambda a: _apply_scene(lamp, str(a.get("name", "")).lower().strip()))


# Сцены лампы: список команд WLED. fx=0 (Solid) гарантированно гасит мигание.
# Динамические эффекты 8 (Colorloop) и 9 (Rainbow) есть в любой сборке WLED.
LAMP_SCENES = {
    "сон":        [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 150, 60]}, {"action": "brightness", "percent": 6}],
    "спокойно":   [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 150, 60]}, {"action": "brightness", "percent": 8}],
    "ночник":     [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 120, 40]}, {"action": "brightness", "percent": 5}],
    "вечер":      [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 170, 80]}, {"action": "brightness", "percent": 45}],
    "чтение":     [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 240, 220]}, {"action": "brightness", "percent": 95}],
    "работа":     [{"action": "effect", "index": 0}, {"action": "color", "rgb": [255, 255, 255]}, {"action": "brightness", "percent": 100}],
    "кино":       [{"action": "effect", "index": 0}, {"action": "color", "rgb": [40, 20, 90]}, {"action": "brightness", "percent": 20}],
    "романтика":  [{"action": "effect", "index": 0}, {"action": "color", "rgb": [200, 30, 60]}, {"action": "brightness", "percent": 25}],
    "релакс":     [{"action": "effect", "index": 2}, {"action": "color", "rgb": [30, 120, 160]}, {"action": "brightness", "percent": 35}],
    "дискотека":  [{"action": "brightness", "percent": 100}, {"action": "effect", "index": 8}],
    "вечеринка":  [{"action": "brightness", "percent": 100}, {"action": "effect", "index": 8}],
    "радуга":     [{"action": "brightness", "percent": 100}, {"action": "effect", "index": 9}],
}
_SCENE_ALIASES = {"спать": "сон", "ночь": "сон", "party": "вечеринка",
                  "диско": "дискотека", "отдых": "релакс", "фильм": "кино"}


def _apply_scene(lamp, name: str) -> dict:
    name = _SCENE_ALIASES.get(name, name)
    cmds = LAMP_SCENES.get(name)
    if not cmds:
        return {"message": f"Нет сцены «{name}»"}
    ok = True
    for c in cmds:
        ok = lamp.apply(c) and ok
    return {"message": f"✨ Сцена «{name}»" if ok else "⚠️ Лампа недоступна"}


def _lamp_status(lamp) -> dict:
    st = lamp.get_state()
    if not st.online:
        return {"message": "💡 Лампа недоступна"}
    d = st.data
    return {"message": f"💡 Лампа: {'вкл' if d.get('on') else 'выкл'}, "
                       f"яркость {d.get('brightness')}%", "state": d}


TV_NOT_SET = ("📺 Телевизор ещё не настроен. Открой /menu → «📺 Телевизор» → "
              "«🔍 Найти телевизор» — пульт не нужен, найду по сети.")
TV_NO_LINK = ("⚠️ Нет связи с телевизором. Он включён и в той же Wi-Fi? Если на экране "
              "ТВ спрашивает «Разрешить?» — нажми «Разрешить».")
TV_CANT_SEE = ("Что сейчас идёт на экране, я не вижу — телевизор по сети этого "
               "не сообщает.")

# Явная просьба про ПИТАНИЕ ТВ. Без неё мозг не выполнит tv_power, а вызовет
# tv_status: модель «проверяла» телевизор через tv_power («Что щас идет по телеку»).
# Глагол — без состояний («включён», «вимкнений») и без «-ся» («вырубился»).
_PWR = re.compile(r"(?:в|вы|от)ключ(?![её]н)|\b(?:вкл|выкл)\b|вруб|выруб|отруб|гаси|туши|"
                  r"вимк(?!нен)|вімк(?!нен)|запуст|разбуд|розбуд|питани|power|"
                  r"\b(?:on|off)\b", re.I)
_TVN = re.compile(r"телев|телек|телик|телік|\bтв\b|\btv\b", re.I)
_YES = re.compile(r"\b(?:да|ага|угу|давай|ок|окей|конечно|можно|так|yes)\b", re.I)
_NO = re.compile(r"\b(?:не|нет|ні|no)\b|отмен|стоп", re.I)


def _asks_tv_power(text: str) -> bool:
    """Глагол питания и телевизор рядом, в одном предложении: «выключи телек»,
    «телек выключи», «выключи свет и телек». Не просьба: «телек включён?»,
    «выключи звук на телеке» (это mute), «выключи лампу и скажи, что идёт по телеку»."""
    for sent in re.split(r"[.;:!?\n]+", text or ""):
        w = re.findall(r"[\w-]+", sent)
        for i, word in enumerate(w):
            if (not _PWR.search(word) or word.lower().endswith(("ся", "сь"))
                    or (i + 1 < len(w) and w[i + 1].lower().startswith("звук"))):
                continue
            if any(_TVN.search(x) for x in w[max(0, i - 1):i + 4]):
                return True
    return False


def tv_power_requested(text: str, history=None) -> bool:
    """Просили ли ЯВНО включить/выключить ТВ: в этой фразе — или коротким «да» в ответ
    на только что заданный ботом вопрос «Выключить телевизор?». Старые реплики
    («Лампу выключи» парой сообщений раньше) не считаются."""
    if _asks_tv_power(text):
        return True
    last = history[-1] if history else None
    t = (text or "").strip()
    return bool(last is not None and getattr(last, "role", "") == "assistant"
                and _asks_tv_power(getattr(last, "content", "")) and len(t.split()) <= 3
                and not _NO.search(t) and (_YES.search(t) or _PWR.search(t) or _TVN.search(t)))


def _tv_status(tv) -> dict:
    st = tv.get_state()
    d = st.data or {}
    if not d.get("ip"):
        return {"message": TV_NOT_SET}
    name = d.get("model") or d.get("name") or d["ip"]
    if st.online:
        return {"message": f"📺 {name} на связи ({d['ip']}). {TV_CANT_SEE}"}
    return {"message": f"📺 {name} не отвечает ({d['ip']}) — похоже, выключен "
                       f"или не в сети. {TV_CANT_SEE}"}


def _register_tv(reg: ToolRegistry, tv) -> None:
    def do(command: dict, ok_msg: str, fail_msg: str = TV_NO_LINK) -> dict:
        if not getattr(tv, "configured", lambda: True)():
            return {"message": TV_NOT_SET}
        return {"message": ok_msg if tv.apply(command) else fail_msg}

    reg.add("tv_status",
            "Состояние телевизора: настроен ли, на связи ли. Используй для вопросов "
            "«что с телеком», «что идёт по телевизору», «почему не работает». "
            "Что показывается на экране, телевизор не сообщает.",
            dict(_OBJ), lambda a: _tv_status(tv))

    reg.add("tv_power",
            "Включить (on=true) или выключить (on=false) телевизор. ТОЛЬКО по прямой "
            "просьбе включить/выключить ТВ. Не для проверки состояния и не для "
            "вопросов «что идёт» — для этого tv_status.",
            {"type": "object", "properties": {"on": {"type": "boolean"}},
             "required": ["on"]},
            lambda a: do({"action": "power", "on": bool(a.get("on", True))},
                         "📺 Включаю телевизор" if a.get("on", True)
                         else "📺 Выключаю телевизор"),
            intent=tv_power_requested, instead="tv_status")

    reg.add("tv_volume", "Громкость телевизора: dir=up|down, steps=1..10.",
            {"type": "object", "properties": {
                "dir": {"type": "string", "enum": ["up", "down"]},
                "steps": {"type": "integer"}}, "required": ["dir"]},
            lambda a: do({"action": "volume", "dir": a.get("dir"),
                          "steps": a.get("steps", 3)},
                         "🔊 Громче" if a.get("dir") == "up" else "🔉 Тише"))

    reg.add("tv_mute", "Выключить/включить звук телевизора.", dict(_OBJ),
            lambda a: do({"action": "mute"}, "🔇 Звук"))

    reg.add("tv_key", "Нажать клавишу пульта (KEY_UP/KEY_ENTER/KEY_RETURN/KEY_PLAY/…).",
            {"type": "object", "properties": {"key": {"type": "string"}},
             "required": ["key"]},
            lambda a: do({"action": "key", "key": a["key"]}, f"🎮 {a['key']}"))

    reg.add("tv_app", "Открыть приложение на ТВ (youtube/netflix).",
            {"type": "object", "properties": {"name": {"type": "string"}},
             "required": ["name"]},
            lambda a: do({"action": "app", "name": a["name"]}, f"📺 Открываю {a['name']}",
                         "⚠️ Не вышло открыть приложение"))
