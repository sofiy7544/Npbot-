#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Голосовые/текстовые команды: разбор русской фразы → действие над лампой/ТВ.

Распознавание речи делает браузер (Web Speech API) и присылает текст; здесь
мы разбираем намерение по ключевым словам и выполняем. Телевизор «тупой» —
между его действиями делаем паузы (STEP_DELAY).

Что умеет ТВ:
  питание, громкость/без звука, каналы (в т.ч. по номеру), навигация
  (вверх/вниз/влево/вправо/ок/назад/домой/меню), медиа (плей/пауза/стоп,
  перемотка вперёд-назад, в т.ч. «на N минут» — приблизительно), запуск
  приложений (YouTube/Netflix/Prime/Spotify) и поиск+запуск на YouTube.

Честно про ограничения: внутренний поиск Netflix («найди такой-то сериал,
серию 3, перемотай на 10:00») публичный API Samsung не поддерживает — это
закрыто самим Netflix. YouTube ищет и запускает полноценно.
"""

import re
import json
import time
import logging
import urllib.request
import urllib.parse

import tvremote

log = logging.getLogger("voice")

WLED_IP = "192.168.1.106"      # задаётся через init()
STEP_DELAY = 1.5               # пауза между действиями ТВ (медленный телевизор)

# Идентификаторы приложений Tizen (для run_app). Самые ходовые — проверенные.
# Если какое-то не открывается — пришлите точное название, подставлю ID с ТВ.
APPS = {
    "ютуб": "111299001912", "youtube": "111299001912",
    "нетфл": "3201907018807", "netflix": "3201907018807",
    "прайм": "3201910019365", "prime": "3201910019365", "amazon": "3201910019365",
    "spotify": "3201606009684", "спотифай": "3201606009684",
}
YT_ID = APPS["youtube"]
NF_ID = APPS["netflix"]

# Навигация по меню телевизора голосом.
NAV = {
    "вверх": "KEY_UP", "наверх": "KEY_UP",
    "вниз": "KEY_DOWN",
    "влево": "KEY_LEFT", "налево": "KEY_LEFT",
    "вправо": "KEY_RIGHT", "направо": "KEY_RIGHT",
    "домой": "KEY_HOME", "главн": "KEY_HOME",
    "выход": "KEY_EXIT",
    "источник": "KEY_SOURCE", "hdmi": "KEY_HDMI", "хдми": "KEY_HDMI",
}

COLORS = {
    "красн": [255, 0, 0], "оранж": [255, 90, 0], "жёлт": [255, 200, 0],
    "желт": [255, 200, 0], "зел": [0, 255, 0], "голуб": [0, 200, 255],
    "син": [0, 0, 255], "фиолет": [150, 0, 255], "розов": [255, 0, 150],
    "бел": [255, 255, 255], "тёпл": [255, 170, 80], "тепл": [255, 170, 80],
}


def init(wled_ip: str):
    global WLED_IP
    WLED_IP = wled_ip


# ----------------------- Низкоуровневые действия -----------------------
def _lamp(payload: dict) -> bool:
    try:
        req = urllib.request.Request(
            f"http://{WLED_IP}/json/state", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=4).read()
        return True
    except Exception as e:
        log.warning(f"voice lamp: {e}")
        return False


def _tv(key: str) -> bool:
    cfg = tvremote.config
    if not cfg.get("ip"):
        return False
    try:
        tvremote.send_key(cfg["ip"], key, cfg.get("method") or None)
        return True
    except Exception as e:
        log.warning(f"voice tv: {e}")
        return False


def _tv_app(app_id: str) -> bool:
    cfg = tvremote.config
    if not cfg.get("ip"):
        return False
    try:
        tvremote.run_app(cfg["ip"], app_id, cfg.get("method") or None)
        return True
    except Exception as e:
        log.warning(f"voice app: {e}")
        return False


def _digits(num: str, enter: bool = True):
    """Набрать номер канала по цифрам (ТВ принимает их по одной)."""
    for d in num:
        _tv("KEY_" + d)
        time.sleep(0.35)
    if enter:
        _tv("KEY_ENTER")


def _seek(minutes: float, back: bool) -> str:
    """Перемотка нажатиями FF/REW. На ТВ это приблизительно (~10 c за нажатие)."""
    secs = minutes * 60
    presses = max(1, min(30, round(secs / 10)))   # ограничим, чтобы не спамить
    key = "KEY_REWIND_" if back else "KEY_FF_"
    for _ in range(presses):
        _tv(key)
        time.sleep(0.25)
    unit = f"{int(minutes)} мин" if minutes >= 1 else f"{int(secs)} с"
    return ("⏪ Перемотал назад на " if back else "⏩ Перемотал вперёд на ") + unit


def _yt_search(query: str):
    """Первый videoId из поиска YouTube (без API-ключа, best-effort)."""
    try:
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9"})
        html = urllib.request.urlopen(req, timeout=5).read().decode("utf-8", "ignore")
        m = re.search(r'"videoId":"([0-9A-Za-z_-]{11})"', html)
        return m.group(1) if m else None
    except Exception as e:
        log.warning(f"yt search: {e}")
        return None


def _yt_cast(video_id: str) -> bool:
    """Запустить конкретное видео на ТВ через DIAL (best-effort)."""
    cfg = tvremote.config
    if not cfg.get("ip"):
        return False
    try:
        req = urllib.request.Request(
            f"http://{cfg['ip']}:8080/ws/apps/YouTube",
            data=("v=" + video_id).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception as e:
        log.warning(f"yt cast: {e}")
        return False


def _find_installed(t: str):
    """Сопоставить фразу с реальным списком приложений телевизора.
    Возвращает (appId, name) или None. Так открывается ЛЮБОЕ приложение
    (Кинопоиск, ivi, Okko, Wink…) без угадывания ID."""
    try:
        apps = tvremote.list_apps()
    except Exception as e:
        log.warning(f"list_apps: {e}")
        return None
    for a in apps:
        nm = (a.get("name") or "").lower().strip()
        if not nm:
            continue
        if nm in t:
            return a["appId"], a["name"]
        # совпадение по значимому слову названия («кинопоиск hd» → «кинопоиск»)
        for w in re.split(r"[\s/.-]+", nm):
            if len(w) >= 4 and w in t:
                return a["appId"], a["name"]
    return None


def _open_app_by_name(t: str):
    """Найти приложение по ключевому слову в фразе. Вернуть (ok, msg) или None."""
    for kw, app_id in APPS.items():
        if kw in t:
            title = ("YouTube" if app_id == YT_ID else
                     "Netflix" if app_id == NF_ID else kw.capitalize())
            return _tv_app(app_id), f"📺 Открываю {title}"
    hit = _find_installed(t)          # живой список приложений с ТВ
    if hit:
        return _tv_app(hit[0]), f"📺 Открываю {hit[1]}"
    return None


# ----------------------- Разбор + выполнение -----------------------
def handle(text: str):
    """Разобрать фразу и выполнить. Возвращает (ok, сообщение)."""
    t = (text or "").lower().strip()
    if not t:
        return False, "Не расслышал"

    # YouTube с запросом: «включи на ютубе ...» — через браузер ТВ (надёжно)
    m = re.search(r"(?:ютуб[еа]?|youtube)\s+(.+)", t)
    if m and any(w in t for w in ("включ", "найд", "поставь", "запусти", "вруб")):
        query = m.group(1).strip(" .,!?-")
        vid = _yt_search(query)
        url = (f"https://m.youtube.com/watch?v={vid}" if vid
               else "https://m.youtube.com/results?search_query=" + urllib.parse.quote(query))
        if tvremote.open_browser(url):
            return True, f"▶️ YouTube (браузер): {query}"
        # запасной путь — нативное приложение + DIAL-каст
        _tv_app(YT_ID); time.sleep(STEP_DELAY)
        if vid and _yt_cast(vid):
            return True, f"▶️ YouTube: {query}"
        return True, f"Открыл YouTube — набери «{query}»"

    # Телевизор: питание (надёжно: выкл = POWEROFF, вкл = WoL+POWERON)
    is_tv = bool("телевизор" in t or "телек" in t or "телик" in t or re.search(r"\bтв\b", t))
    if is_tv and ("выключ" in t or "выруб" in t):
        return tvremote.power(False), "📺 Выключаю телевизор"
    if is_tv and ("включ" in t or "вруб" in t) and not any(k in t for k in APPS):
        return tvremote.power(True), "📺 Включаю телевизор"

    # Запуск приложений по названию (нетфликс/прайм/spotify/…)
    if any(w in t for w in ("включ", "открой", "запусти", "вруб", "поставь")):
        res = _open_app_by_name(t)
        if res:
            return res
    if "браузер" in t or "интернет" in t:
        return tvremote.open_browser("https://www.google.com"), "🌐 Открываю браузер на ТВ"

    # Громкость
    if "громче" in t or "погромче" in t:
        for _ in range(3):
            _tv("KEY_VOLUP"); time.sleep(0.4)
        return True, "🔊 Громче"
    if "тише" in t or "потише" in t:
        for _ in range(3):
            _tv("KEY_VOLDOWN"); time.sleep(0.4)
        return True, "🔉 Тише"
    if "без звука" in t or "выключи звук" in t or "приглуши звук" in t or "mute" in t or "мьют" in t:
        return _tv("KEY_MUTE"), "🔇 Звук"

    # Медиа: плей/пауза/стоп
    if "пауз" in t or "поставь на паузу" in t:
        return _tv("KEY_PAUSE"), "⏸ Пауза"
    if "продолж" in t or "воспроизв" in t or re.search(r"\bплей\b", t) or "play" in t:
        return _tv("KEY_PLAY"), "▶️ Воспроизведение"
    if re.search(r"\bстоп\b", t) or "останови воспро" in t:
        return _tv("KEY_STOP"), "⏹ Стоп"

    # Перемотка «на N минут/секунд» (приблизительно)
    mr = re.search(r"перемот\w*.*?(\d{1,3})\s*(минут|мин|секунд|сек)", t)
    if mr:
        n = int(mr.group(1))
        mins = n if mr.group(2).startswith("мин") else n / 60
        back = "назад" in t
        return True, _seek(mins, back)
    if "перемот" in t or "промот" in t:
        back = "назад" in t
        for _ in range(3):
            _tv("KEY_REWIND_" if back else "KEY_FF_"); time.sleep(0.25)
        return True, ("⏪ Перематываю назад" if back else "⏩ Перематываю вперёд")
    if "следующ" in t and ("серия" in t or "видео" in t or "трек" in t):
        return _tv("KEY_FF_"), "⏭ Следующее"

    # Каналы
    mc = (re.search(r"канал\w*\s*(\d{1,3})", t) or re.search(r"(\d{1,3})\s*канал", t)
          or re.search(r"переключи(?:сь)?\s*на\s*(\d{1,3})", t))
    if mc and (is_tv or "канал" in t):
        _digits(mc.group(1))
        return True, f"📺 Канал {mc.group(1)}"
    if "следующий канал" in t or "канал вперёд" in t or "переключи канал" in t:
        return _tv("KEY_CHUP"), "📺 Следующий канал"
    if "предыдущий канал" in t or "канал назад" in t:
        return _tv("KEY_CHDOWN"), "📺 Предыдущий канал"

    # Навигация по меню ТВ
    if is_tv or any(k in t for k in NAV):
        if t in ("ок", "окей", "выбрать", "выбери", "нажми ок", "энтер", "enter"):
            return _tv("KEY_ENTER"), "⏎ ОК"
        for kw, key in NAV.items():
            if re.search(r"\b" + re.escape(kw), t):
                return _tv(key), f"🎮 {kw.capitalize()}"
        if "назад" in t and is_tv:
            return _tv("KEY_RETURN"), "↩️ Назад"
        if "меню" in t:
            return _tv("KEY_MENU"), "☰ Меню"

    # Лампа
    is_lamp = "ламп" in t or "свет" in t or "подсветк" in t
    if is_lamp and ("выключ" in t or "погаси" in t or "выруб" in t):
        return _lamp({"on": False}), "💡 Выключаю свет"
    if is_lamp and ("включ" in t or "зажг" in t or "вруб" in t):
        return _lamp({"on": True}), "💡 Включаю свет"
    if "ярче" in t or "светлее" in t:
        return _lamp({"on": True, "bri": 255}), "☀️ Ярче"
    if "темнее" in t or "тусклее" in t or "приглуши свет" in t:
        return _lamp({"on": True, "bri": 40}), "🌙 Темнее"
    mb = re.search(r"ярк\w*\s+(?:на\s+|до\s+)?(\d{1,3})", t)
    if mb:
        p = max(1, min(100, int(mb.group(1))))
        return _lamp({"on": True, "bri": round(p / 100 * 255)}), f"💡 Яркость {p}%"
    for key, rgb in COLORS.items():
        if key in t and ("цвет" in t or "сделай" in t or is_lamp or "включ" in t):
            return _lamp({"on": True, "seg": [{"col": [rgb]}]}), "🎨 Меняю цвет"

    # Правила не распознали — подключаем «интеллект» (GPT), если есть ключ.
    try:
        import ai_brain
        res = ai_brain.interpret(text)
        if res is not None:
            return res
    except Exception as e:
        log.warning(f"ai fallback: {e}")

    return False, "Не понял команду 🤔"
