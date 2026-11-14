#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ai_brain.py — «интеллект» бота на GPT.

Подключается как УМНАЯ ПОДСТРАХОВКА к voice.py: если разбор по ключевым словам
не понял фразу, GPT разбирает свободную речь («сделай чтобы было уютно», «что-то
скучно, оживи комнату», «приглуши свет и поставь телик потише») в структурные
действия над лампой (WLED) и телевизором (Samsung) и выполняет их теми же
низкоуровневыми функциями, что и правила.

Ключ берётся из OPENAI_API_KEY (файл .env). Нет ключа или сети — модуль молча
отключается, и бот работает как раньше, на правилах.
"""
from __future__ import annotations

import os
import json
import logging

import voice          # переиспользуем проверенные примитивы (_lamp/_tv/...)
import tvremote
import timers

log = logging.getLogger("ai")

MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")


def available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


SYSTEM = """Ты — «умный дом» в Telegram-боте. Пользователь пишет свободной речью
по-русски. Преврати это в действия над ЛАМПОЙ (WLED) и ТЕЛЕВИЗОРОМ (Samsung) и
дай короткий дружелюбный ответ. Верни СТРОГО JSON:
{"actions":[...], "reply":"коротко, 1 предложение, по-русски, можно эмодзи"}

Действия (можно несколько; пустой список — если это не про свет/ТВ):
ЛАМПА:
  {"type":"lamp_power","on":true|false}
  {"type":"lamp_brightness","percent":1..100}       # абсолютная яркость
  {"type":"lamp_dim","delta":-80..80}               # ярче(+)/тусклее(-)
  {"type":"lamp_color","rgb":[r,g,b]}               # подбери цвет по смыслу/настроению
  {"type":"lamp_warm"} | {"type":"lamp_cold"}       # тёплый / холодный белый
ТЕЛЕВИЗОР:
  {"type":"tv_power","on":true|false}
  {"type":"tv_volume","dir":"up"|"down","steps":1..10}
  {"type":"tv_mute"}
  {"type":"tv_channel","num":"1".."999"}
  {"type":"tv_key","key":"KEY_UP|KEY_DOWN|KEY_LEFT|KEY_RIGHT|KEY_ENTER|KEY_RETURN|KEY_MENU|KEY_HOME|KEY_PLAY|KEY_PAUSE"}
  {"type":"tv_app","name":"youtube|netflix|prime|spotify|<название>"}
  {"type":"tv_youtube","query":"что искать и включить на YouTube"}
ТАЙМЕР:
  {"type":"timer","target":"lamp"|"tv","minutes":0..600}   # 0 — отменить

Понимай намёки: «уютно/вечер» → тёплый тусклый свет; «режет глаза/ярко» → тусклее;
«не вижу/почитать» → ярче; «вечеринка» → яркий цветной; «тихо/ночь» → тише ТВ.
Никаких действий вне списка. Только валидный JSON без текста вокруг."""


def _lamp_bri_now() -> int:
    """Текущая яркость лампы 0..255 (для относительных команд). 128 если недоступна."""
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://{voice.WLED_IP}/json/state", timeout=3) as r:
            return int(json.loads(r.read()).get("bri", 128))
    except Exception:
        return 128


def _exec(action: dict) -> bool:
    t = (action.get("type") or "").lower()
    try:
        if t == "lamp_power":
            return voice._lamp({"on": bool(action.get("on", True))})
        if t == "lamp_brightness":
            p = max(1, min(100, int(action["percent"])))
            return voice._lamp({"on": True, "bri": round(p / 100 * 255)})
        if t == "lamp_dim":
            cur = _lamp_bri_now()
            nb = max(5, min(255, cur + round(int(action.get("delta", 0)) / 100 * 255)))
            return voice._lamp({"on": True, "bri": nb})
        if t == "lamp_color":
            rgb = [int(c) for c in action["rgb"]][:3]
            return voice._lamp({"on": True, "seg": [{"col": [rgb]}]})
        if t == "lamp_warm":
            return voice._lamp({"on": True, "seg": [{"col": [[255, 170, 80]]}]})
        if t == "lamp_cold":
            return voice._lamp({"on": True, "seg": [{"col": [[255, 255, 255]]}]})

        if t == "tv_power":
            return tvremote.power(bool(action.get("on", True)))
        if t == "tv_volume":
            key = "KEY_VOLUP" if action.get("dir") == "up" else "KEY_VOLDOWN"
            import time
            for _ in range(max(1, min(10, int(action.get("steps", 3))))):
                voice._tv(key); time.sleep(0.35)
            return True
        if t == "tv_mute":
            return voice._tv("KEY_MUTE")
        if t == "tv_channel":
            voice._digits(str(action["num"])); return True
        if t == "tv_key":
            return voice._tv(str(action["key"]))
        if t == "tv_app":
            res = voice._open_app_by_name(str(action.get("name", "")).lower())
            return bool(res and res[0])
        if t == "tv_youtube":
            ok, _ = voice.handle("включи на ютубе " + str(action.get("query", "")))
            return ok
        if t == "timer":
            timers.set_timer(action.get("target", "lamp"), int(action.get("minutes", 0)))
            return True
    except Exception as e:
        log.warning(f"exec {t}: {e}")
    return False


def interpret(text: str):
    """Разобрать фразу через GPT и выполнить. Возвращает (ok, reply) или None."""
    if not available():
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=30, max_retries=1)
        resp = client.chat.completions.create(
            model=MODEL,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": text}],
        )
        data = json.loads(resp.choices[0].message.content)
    except Exception as e:
        log.warning(f"AI недоступен: {e}")
        return None

    actions = data.get("actions") or []
    reply = (data.get("reply") or "").strip()
    if not isinstance(actions, list) or not actions:
        # Чистый разговор без действий — вернём ответ, если он есть
        return (True, reply) if reply else None

    done = sum(1 for a in actions if _exec(a))
    if done == 0:
        return (False, reply or "Не смог выполнить 🤔")
    return (True, reply or "Готово ✨")
