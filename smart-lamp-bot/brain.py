"""
brain.py — «интеллект» лампы.

Превращает человеческую фразу («сделай потусклее и потеплее», «врубай киношный
свет», «мне холодно от этого света») в список структурированных действий
для LampController, плюс короткий ответ ОТ ЛИЦА самой лампы (с характером).

Основной путь — GPT (OpenAI, JSON-режим, функция interpret_ai).
Если ключа нет или запрос не удался — откатываемся на простой парсер по
правилам (interpret_rules), чтобы бот работал всегда.
"""

from __future__ import annotations

import json
import os
import re

from lamp import LampState, SCENES, KELVIN_MIN, KELVIN_MAX

MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """Ты — «мозг» умной лампы с лёгким характером: тёплая, с юмором,
отвечаешь коротко и живо, по-русски, иногда с эмодзи. Ты и ЕСТЬ лампа.

Пользователь пишет обычным языком. Твоя задача — вернуть СТРОГО JSON вида:
{"actions": [ ... ], "reply": "короткий ответ от лица лампы (1-2 предложения)"}

Возможные элементы в actions (можно несколько сразу, можно пустой список):
{"type":"power","on":true|false}                 — включить/выключить
{"type":"brightness","percent":1..100}           — задать яркость абсолютно
{"type":"brightness_delta","percent":-100..100}  — ярче(+)/тусклее(-) относительно текущей
{"type":"temperature","kelvin":1700..6500}        — белый: 2200 очень тёплый, 2700 тёплый, 4000 нейтральный, 6500 холодный
{"type":"temperature_delta","kelvin":-2000..2000} — теплее(-)/холоднее(+)
{"type":"color","rgb":[r,g,b]}                    — цветной свет (сам подбери RGB по названию цвета/настроению)
{"type":"scene","name":"..."}                     — готовая сцена, name из списка: %(scenes)s
{"type":"status"}                                 — пользователь просто спросил текущее состояние

Правила:
- Понимай намёки: «мне светло/режет глаза» -> тусклее; «мрачно/темно» -> ярче;
  «уютно/вечер» -> тёплый тусклый; «не вижу/читать» -> ярче нейтральный; «романтика» -> сцена.
- Если просьба вообще не про свет — actions пустой, но всё равно ответь в характере.
- Никогда не выдумывай типы действий вне списка. Только валидный JSON, без текста вокруг.

Текущее состояние лампы: %(state)s."""


def _build_system(state: LampState) -> str:
    return SYSTEM_PROMPT % {
        "scenes": ", ".join(SCENES.keys()),
        "state": state.human(),
    }


def interpret_ai(text: str, state: LampState) -> dict:
    """Через GPT. Бросает исключение, если не вышло — ловится в interpret()."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0.5,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _build_system(state)},
            {"role": "user", "content": text},
        ],
    )
    data = json.loads(resp.choices[0].message.content)
    actions = data.get("actions") or []
    reply = (data.get("reply") or "").strip()
    if not isinstance(actions, list):
        actions = []
    return {"actions": actions, "reply": reply, "source": "ai"}


# ───────────────────────── Фолбэк на правилах ──────────────────────────

COLOR_WORDS = {
    "красн": (255, 0, 0), "червон": (255, 0, 0),
    "зелён": (0, 220, 0), "зелен": (0, 220, 0),
    "син": (0, 60, 255), "голуб": (0, 160, 255),
    "жёлт": (255, 210, 0), "желт": (255, 210, 0),
    "оранж": (255, 120, 0), "помаранч": (255, 120, 0),
    "фиолет": (150, 0, 255), "пурпур": (170, 0, 160),
    "розов": (255, 80, 170), "малин": (220, 20, 90),
    "бирюз": (0, 210, 180), "мятн": (90, 230, 160),
    "белый": None,  # белый -> режим white, не цвет
}


def interpret_rules(text: str, state: LampState) -> dict:
    """Простой парсер — работает без интернета и без ключа."""
    t = text.lower().strip()
    actions: list[dict] = []
    reply = "готово 💡"

    # сцены по названию
    for name in SCENES:
        if name in t:
            actions.append({"type": "scene", "name": name})
            return {"actions": actions, "reply": f"ставлю сцену «{name}» ✨", "source": "rules"}

    # вкл/выкл (без \b — на кириллице границы слова мешают; off проверяем первым)
    if re.search(r"выключ|выруб|погас|туши|гаси|\boff\b|спать", t):
        return {"actions": [{"type": "power", "on": False}], "reply": "всё, гашу свет 😴", "source": "rules"}
    if re.search(r"включ|врубай|врубись|зажги|загор|\bon\b", t):
        actions.append({"type": "power", "on": True})
        reply = "горю! 💡"

    # яркость в процентах
    m = re.search(r"(\d{1,3})\s*%", t)
    if m:
        actions.append({"type": "brightness", "percent": int(m.group(1))})
        reply = f"яркость {int(m.group(1))}%"

    # ярче/тусклее
    if re.search(r"ярче|светлее|побольше свет|прибав", t):
        actions.append({"type": "brightness_delta", "percent": +25}); reply = "делаю ярче ☀️"
    if re.search(r"тусклее|потускн|темнее|приглуши|убав|режет глаз|слишком светло", t):
        actions.append({"type": "brightness_delta", "percent": -25}); reply = "приглушаю 🌙"

    # теплее/холоднее
    if re.search(r"теплее|потепл|уютн|жёлт свет|желт свет", t):
        actions.append({"type": "temperature_delta", "kelvin": -800}); reply = "грею свет 🔥"
    if re.search(r"холодн|белее|поярче бел|дневн", t):
        actions.append({"type": "temperature_delta", "kelvin": +800}); reply = "охлаждаю свет ❄️"

    # конкретный цвет
    for key, rgb in COLOR_WORDS.items():
        if key in t:
            if rgb is None:
                actions.append({"type": "temperature", "kelvin": 4000})
                reply = "белый свет 🤍"
            else:
                actions.append({"type": "color", "rgb": list(rgb)})
                reply = "лови цвет 🎨"
            break

    # статус
    if not actions and re.search(r"статус|как дела|что сейчас|состоян|какой свет", t):
        return {"actions": [{"type": "status"}], "reply": f"сейчас я: {state.human()}", "source": "rules"}

    if not actions:
        reply = "хм, не поняла про свет 🤔 скажи, например: «сделай потеплее и потусклее» или «врубай кино»"

    return {"actions": actions, "reply": reply, "source": "rules"}


def interpret(text: str, state: LampState) -> dict:
    """Главная точка входа: сначала AI, при любой проблеме — правила."""
    if os.getenv("OPENAI_API_KEY"):
        try:
            res = interpret_ai(text, state)
            # если AI вернул пустоту и ничего не сказал — подстрахуемся правилами
            if res["actions"] or res["reply"]:
                return res
        except Exception as e:
            print(f"[brain] AI недоступен, откат на правила: {e}")
    return interpret_rules(text, state)
