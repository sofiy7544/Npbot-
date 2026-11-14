#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WLED Telegram Bot — красивое и быстрое управление LED-лампой через Telegram.
Работает напрямую с WLED JSON API — то же, что делает официальное приложение.

Возможности:
  • живая панель состояния (питание, шкала яркости, цвет, эффект) — обновляется на месте
  • быстрый отклик: постоянное (keep-alive) соединение с лампой
  • питание вкл/выкл, яркость −/+ и пресеты
  • цвета, обычные эффекты
  • 🎵 аудио-режим (звукореактивные эффекты — нужна прошивка с AudioReactive + микрофон)
  • /fxlist — реальный список эффектов прямо с лампы

Зависимости:
    pip install "python-telegram-bot>=21" httpx

Запуск:
    export WLED_BOT_TOKEN="токен_от_BotFather"
    python wled_bot.py

Конфигурация через переменные окружения (см. .env.example):
    WLED_BOT_TOKEN — токен бота от @BotFather
    WLED_IP        — IP-адрес устройства WLED (по умолчанию 192.168.1.106)
    ALLOWED_USERS  — список Telegram ID через запятую (узнать у @userinfobot)
"""

import os
import json
import html
import asyncio
import threading
import logging
import urllib.request
from datetime import datetime
# Журналы logs\ — подключаем ДО сторонних библиотек, чтобы в logs\crash.log
# попало даже «не установлена библиотека» (иначе это видно только в окне).
import diaglog
diaglog.install_crash_logging()
# Момент запуска (до тяжёлых импортов): по нему отличаем старые сообщения,
# накопившиеся, пока бот был выключен, от свежих (см. stale_updates.py).
import stale_updates
import httpx
import tvremote
import timers
import voice
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.error import BadRequest
from telegram.ext import (
    Application,
    ApplicationHandlerStop,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    TypeHandler,
    filters,
)


# ----------------------- Загрузка .env -----------------------
def _load_dotenv():
    """Простейшая загрузка переменных из файла .env рядом со скриптом."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    # utf-8-sig: Блокнот может сохранить с BOM; errors=replace: не падать на чужой кодировке
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_dotenv()

# ==================== НАСТРОЙКИ ====================
BOT_TOKEN = os.getenv("WLED_BOT_TOKEN", "ВСТАВЬ_ТОКЕН_ОТ_BOTFATHER")
WLED_IP = os.getenv("WLED_IP", "192.168.1.106")

# Владельцы — заходят сразу, без пароля. Впиши свой ID.
_allowed_raw = os.getenv("ALLOWED_USERS", "")
ALLOWED_USERS = {
    int(x) for x in _allowed_raw.replace(" ", "").split(",") if x.strip().isdigit()
}

# Пароль для остальных: вводят код один раз, дальше бот их запоминает.
# 3 попытки — после трёх ошибок доступ блокируется.
ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "5750")
MAX_ATTEMPTS = 3
# ==================================================

BASE = f"http://{WLED_IP}"
# Логи — и в окно, и в файл logs\bot.log (папку logs\ удобно прислать для разбора).
# Токен и ключи в журнале всегда заменяются на *** (RedactingFormatter).
LOG_FILE = os.path.join(diaglog.ensure_dir(), "bot.log")
_fmt = diaglog.RedactingFormatter("%(asctime)s | %(levelname)s | %(message)s")
_handlers = [logging.StreamHandler()]
try:
    from logging.handlers import RotatingFileHandler
    _handlers.append(RotatingFileHandler(
        LOG_FILE, maxBytes=1_000_000, backupCount=2, encoding="utf-8"))
except Exception:
    pass
for _h in _handlers:
    _h.setFormatter(_fmt)
logging.basicConfig(level=logging.INFO, handlers=_handlers)
log = logging.getLogger("wled-bot")

# Приглушаем шумные сторонние логи. Опрос Telegram (getUpdates) спамил лог
# строками «HTTP Request... 200 OK» каждые 10 секунд И светил токен бота в
# каждой строке. Оставляем только наши понятные сообщения.
for _noisy in ("httpx", "httpcore", "telegram", "telegram.ext", "telegram.request",
               "apscheduler", "apscheduler.scheduler", "asyncio", "hpack"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Постоянный HTTP-клиент с keep-alive — ради быстрого отклика.
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(4.0, connect=2.0),
            limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=30),
        )
    return _client


# Кэш метаданных лампы (имя устройства, список эффектов/палитр).
META = {"name": "WLED", "effects": [], "loaded": False}

# Локальный кэш состояния лампы — чтобы не перечитывать его после каждого
# действия (предсказательное обновление = быстрый отклик).
STATE = {"on": False, "bri": 128, "seg": [{"col": [[255, 255, 255]], "fx": 0}]}
ONLINE = False

# Адрес веб-пульта (http://IP-ПК:порт) — заполняется при запуске веб-сервера.
WEB_URL = ""


def _seg() -> dict:
    segs = STATE.setdefault("seg", [{}])
    if not segs:
        segs.append({})
    return segs[0]

# ----------------------- Доступ по паролю -----------------------
ACCESS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "access.json")
_authorized: set[int] = set()   # кто уже ввёл верный пароль
_blocked: set[int] = set()      # кто израсходовал все попытки
_attempts: dict[int, int] = {}  # uid -> сколько раз ошибся (в памяти)


def _load_access():
    global _authorized, _blocked
    try:
        with open(ACCESS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        _authorized = set(d.get("authorized", []))
        _blocked = set(d.get("blocked", []))
    except Exception:
        pass


def _save_access():
    try:
        with open(ACCESS_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {"authorized": sorted(_authorized), "blocked": sorted(_blocked)},
                f, ensure_ascii=False, indent=2,
            )
    except Exception as e:
        log.warning(f"access save fail: {e}")


def is_allowed(uid: int) -> bool:
    if uid in _blocked:
        return False
    if uid in ALLOWED_USERS or uid in _authorized:
        return True
    # Нет ни владельцев, ни пароля — полностью открытый режим (для теста).
    if not ALLOWED_USERS and not ACCESS_PASSWORD:
        return True
    return False


def _attempts_left(uid: int) -> int:
    return MAX_ATTEMPTS - _attempts.get(uid, 0)


# ----------------------- WLED API -----------------------
async def wled_post(payload: dict) -> bool:
    """Отправить состояние в лампу. True при успехе."""
    try:
        r = await client().post(f"{BASE}/json/state", json=payload)
        return r.status_code == 200
    except Exception as e:
        log.warning(f"Команда лампе не дошла ({type(e).__name__}).")
        return False


async def wled_sync() -> bool:
    """Перечитать состояние лампы в кэш STATE. True если лампа онлайн."""
    global STATE, ONLINE
    try:
        r = await client().get(f"{BASE}/json/state")
        r.raise_for_status()
        STATE = r.json()
        if not ONLINE:
            log.info(f"🟢 Лампа на связи: {BASE}")
        ONLINE = True
        return True
    except Exception as e:
        if ONLINE:
            log.warning(f"🔴 Лампа пропала из сети ({type(e).__name__}).")
        ONLINE = False
        return False


async def wled_meta() -> bool:
    """Подтянуть имя устройства и список эффектов (один раз кэшируем)."""
    try:
        r = await client().get(f"{BASE}/json")
        r.raise_for_status()
        j = r.json()
        META["name"] = (j.get("info") or {}).get("name") or "WLED"
        META["effects"] = j.get("effects") or []
        META["loaded"] = True
        return True
    except Exception as e:
        log.warning(f"Не прочитать данные лампы ({type(e).__name__}).")
        return False


# ----------------------- Палитры -----------------------
# name -> (emoji-свотч, (r, g, b))
COLORS = {
    "Красный":      ("🔴", (255, 0, 0)),
    "Оранжевый":    ("🟠", (255, 90, 0)),
    "Жёлтый":       ("🟡", (255, 200, 0)),
    "Зелёный":      ("🟢", (0, 255, 0)),
    "Голубой":      ("🩵", (0, 200, 255)),
    "Синий":        ("🔵", (0, 0, 255)),
    "Фиолетовый":   ("🟣", (150, 0, 255)),
    "Розовый":      ("🩷", (255, 0, 150)),
    "Тёплый":       ("🟤", (255, 170, 80)),
    "Белый":        ("⚪", (255, 255, 255)),
}

# Обычные эффекты (индексы стабильны между версиями)
EFFECTS = {
    "Статичный":       0,
    "Дыхание":         2,
    "Перелив цветов":  8,
    "Радуга":          9,
    "Мерцание звёзд":  67,
    "Аврора":          38,
    "Молния":          57,
    "Pacifica":        101,
}

# 🎵 Звукореактивные эффекты (нужен AudioReactive-билд + микрофон).
AUDIO = {
    "Эквалайзер (GEQ)": 139,
    "Водопад":          140,
    "Matripix":         131,
    "Гравиметр":        132,
    "Пиксели":          128,
    "Juggles":          130,
    "Midnoise":         135,
    "Freqmatrix":       138,
}

# Шаг яркости для кнопок −/+
BRI_STEP = 26  # ≈10%


# ----------------------- Отрисовка -----------------------
def _bar(pct: int, width: int = 10) -> str:
    filled = round(pct / 100 * width)
    return "▓" * filled + "░" * (width - filled)


def _fx_name(idx: int) -> str:
    eff = META["effects"]
    if 0 <= idx < len(eff):
        return eff[idx]
    return f"#{idx}"


def dashboard(st: dict | None) -> tuple[str, InlineKeyboardMarkup]:
    """Собрать текст панели и клавиатуру по текущему состоянию."""
    name = html.escape(META["name"])

    if st is None:
        text = (
            f"💡 <b>{name}</b>\n"
            "━━━━━━━━━━━━━━\n"
            "⚠️ <b>Лампа недоступна</b>\n\n"
            f"Не достучаться до <code>{WLED_IP}</code>.\n"
            "Проверь, что лампа включена и что её IP верный "
            "(строка <code>WLED_IP</code> в файле .env)."
        )
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Повторить", callback_data="refresh")],
        ])
        return text, kb

    on = bool(st.get("on"))
    bri = int(st.get("bri", 0))
    pct = round(bri / 255 * 100)
    seg = (st.get("seg") or [{}])[0]
    cols = seg.get("col") or [[0, 0, 0]]
    first = cols[0] if cols else [0, 0, 0]
    if not isinstance(first, (list, tuple)):   # WLED иногда отдаёт не список
        first = [0, 0, 0]
    r, g, b = (list(first) + [0, 0, 0])[:3]
    fx = seg.get("fx", 0)
    sx = int(seg.get("sx", 128))
    spct = round(sx / 255 * 100)

    power = "🟢 ВКЛ" if on else "⚪ ВЫКЛ"
    text = (
        f"💡 <b>{name}</b>\n"
        "━━━━━━━━━━━━━━\n"
        f"Питание:  {power}\n"
        f"Яркость:  {_bar(pct)} {pct}%\n"
        f"Скорость: {_bar(spct)} {spct}%\n"
        f"Цвет:     🎨 {r},{g},{b}\n"
        f"Эффект:   ✨ {html.escape(_fx_name(fx))}"
    )
    rem = timers.remaining("lamp")
    if rem:
        text += f"\n⏱ Выключение через {rem} мин"

    toggle = "⏻ Выключить" if on else "⏻ Включить"
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(toggle, callback_data="toggle")],
        # яркость — пресеты с −/+ по краям
        [InlineKeyboardButton("🔅", callback_data="bri:dn"),
         InlineKeyboardButton("25", callback_data="bri:64"),
         InlineKeyboardButton("50", callback_data="bri:128"),
         InlineKeyboardButton("75", callback_data="bri:191"),
         InlineKeyboardButton("100", callback_data="bri:255"),
         InlineKeyboardButton("🔆", callback_data="bri:up")],
        # скорость — компактно, без нагромождения
        [InlineKeyboardButton("🐢 Медленнее", callback_data="sx:dn"),
         InlineKeyboardButton("Быстрее 🐇", callback_data="sx:up")],
        [InlineKeyboardButton("🎨 Цвет", callback_data="nav:color"),
         InlineKeyboardButton("✨ Эффекты", callback_data="nav:fx")],
        [InlineKeyboardButton("🎵 Аудио", callback_data="nav:audio"),
         InlineKeyboardButton("📺 Телевизор", callback_data="nav:tv")],
        [InlineKeyboardButton("⏱ Таймер", callback_data="nav:tmrlamp"),
         InlineKeyboardButton("🔄 Обновить", callback_data="refresh")],
    ])
    return text, kb


def tv_menu() -> tuple[str, InlineKeyboardMarkup]:
    """Меню телевизора: пульт, если ТВ настроен, иначе предложение найти."""
    cfg = tvremote.config
    if not cfg.get("ip"):
        return ("📺 <b>Телевизор не настроен</b>\nНажми «Найти телевизор» — "
                "пульт не нужен, найду по сети.",
                InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔍 Найти телевизор", callback_data="tv:scan")],
                    [InlineKeyboardButton("⬅️ Назад к лампе", callback_data="refresh")],
                ]))
    name = html.escape(cfg.get("model") or cfg.get("name") or cfg["ip"])
    title = f"📺 <b>{name}</b>\n<i>Пульт Samsung</i>"

    def B(label, key):
        return InlineKeyboardButton(label, callback_data="tvk:" + key)

    kb = InlineKeyboardMarkup([
        # надёжное вкл/выкл
        [InlineKeyboardButton("🟢 Включить", callback_data="tvpw:on"),
         InlineKeyboardButton("⚫ Выключить", callback_data="tvpw:off")],
        # smart hub / источник / toggle
        [B("🏠 Smart Hub", "KEY_HOME"), B("⤵️ Источник", "KEY_SOURCE"),
         B("⏻", "KEY_POWER")],
        # крест навигации + громкость (слева) + каналы (справа)
        [B("🔊 +", "KEY_VOLUP"), B("⬆️", "KEY_UP"), B("CH +", "KEY_CHUP")],
        [B("⬅️", "KEY_LEFT"), B("OK", "KEY_ENTER"), B("➡️", "KEY_RIGHT")],
        [B("🔉 −", "KEY_VOLDOWN"), B("⬇️", "KEY_DOWN"), B("CH −", "KEY_CHDOWN")],
        [B("🔇 Звук", "KEY_MUTE"), B("↩️ Назад", "KEY_RETURN"),
         B("✕ Выход", "KEY_EXIT")],
        # сервис
        [B("☰ Меню", "KEY_MENU"), B("ℹ️ Инфо", "KEY_INFO"), B("📕 Гид", "KEY_GUIDE")],
        # цветные кнопки
        [B("🔴", "KEY_RED"), B("🟢", "KEY_GREEN"),
         B("🟡", "KEY_YELLOW"), B("🔵", "KEY_BLUE")],
        # медиа (для Tizen 2016+ перемотка — KEY_REWIND_/KEY_FF_)
        [B("⏪", "KEY_REWIND_"), B("⏯", "KEY_PLAY"),
         B("⏸", "KEY_PAUSE"), B("⏩", "KEY_FF_")],
        # приложения + браузер
        [InlineKeyboardButton("▶️ YouTube", callback_data="tva:111299001912"),
         InlineKeyboardButton("🅽 Netflix", callback_data="tva:11101200001"),
         InlineKeyboardButton("🌐 Браузер", callback_data="tvbr")],
        # цифры (скрыты) и навигация
        [InlineKeyboardButton("🔢 Цифры", callback_data="tv:nums"),
         InlineKeyboardButton("📋 Каналы", callback_data="tvk:KEY_CH_LIST")],
        [InlineKeyboardButton("⏱ Таймер", callback_data="nav:tmrtv"),
         InlineKeyboardButton("🔍 Найти заново", callback_data="tv:scan")],
        [InlineKeyboardButton("💡 Лампа", callback_data="refresh")],
    ])
    rem = timers.remaining("tv")
    if rem:
        title += f"\n⏱ Выключение через {rem} мин"
    return title, kb


def timer_menu(kind: str) -> tuple[str, InlineKeyboardMarkup]:
    """Экран sleep-таймера для лампы или телевизора."""
    rem = timers.remaining(kind)
    label = "лампы" if kind == "lamp" else "телевизора"
    now = f"⏱ через {rem} мин" if rem else "не задан"
    title = f"⏱ <b>Таймер выключения {label}</b>\nСейчас: {now}"
    pre = f"tmr:{kind}:"
    back = "refresh" if kind == "lamp" else "nav:tv"
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("15 мин", callback_data=pre + "15"),
         InlineKeyboardButton("30 мин", callback_data=pre + "30"),
         InlineKeyboardButton("45 мин", callback_data=pre + "45")],
        [InlineKeyboardButton("1 час", callback_data=pre + "60"),
         InlineKeyboardButton("2 часа", callback_data=pre + "120"),
         InlineKeyboardButton("3 часа", callback_data=pre + "180")],
        [InlineKeyboardButton("⛔ Отменить таймер", callback_data=pre + "0")],
        [InlineKeyboardButton("⬅️ Назад", callback_data=back)],
    ])
    return title, kb


def tv_nums() -> tuple[str, InlineKeyboardMarkup]:
    """Цифровая клавиатура ТВ (отдельный экран)."""
    def B(label, key):
        return InlineKeyboardButton(label, callback_data="tvk:" + key)
    kb = InlineKeyboardMarkup([
        [B("1", "KEY_1"), B("2", "KEY_2"), B("3", "KEY_3")],
        [B("4", "KEY_4"), B("5", "KEY_5"), B("6", "KEY_6")],
        [B("7", "KEY_7"), B("8", "KEY_8"), B("9", "KEY_9")],
        [B("⏮ Пред.", "KEY_PRECH"), B("0", "KEY_0"), B("📋 Каналы", "KEY_CH_LIST")],
        [InlineKeyboardButton("⬅️ К пульту", callback_data="nav:tv")],
    ])
    return "🔢 <b>Цифровая клавиатура</b>", kb


def _grid(buttons, cols=2):
    return [buttons[i:i + cols] for i in range(0, len(buttons), cols)]


def submenu(kind: str) -> tuple[str, InlineKeyboardMarkup]:
    extra = []
    if kind == "color":
        title = "🎨 <b>Выбери цвет</b>"
        btns = [InlineKeyboardButton(f"{emoji} {n}", callback_data=f"col:{n}")
                for n, (emoji, _) in COLORS.items()]
    elif kind == "fx":
        seg = (STATE.get("seg") or [{}])[0]
        spct = round(int(seg.get("sx", 128)) / 255 * 100)
        ipct = round(int(seg.get("ix", 128)) / 255 * 100)
        title = (f"✨ <b>Эффект:</b> {html.escape(_fx_name(seg.get('fx', 0)))}\n"
                 f"Скорость {_bar(spct, 6)} {spct}%\n"
                 f"Интенсив. {_bar(ipct, 6)} {ipct}%")
        btns = [InlineKeyboardButton(n, callback_data=f"fx:{n}") for n in EFFECTS]
        # под эффектами — тонкая настройка скорости и интенсивности (остаёмся здесь)
        extra = [
            [InlineKeyboardButton("🐢 Медленнее", callback_data="sxf:dn"),
             InlineKeyboardButton("Быстрее 🐇", callback_data="sxf:up")],
            [InlineKeyboardButton("➖ Слабее", callback_data="ixf:dn"),
             InlineKeyboardButton("Насыщеннее ➕", callback_data="ixf:up")],
        ]
    else:  # audio
        title = "🎵 <b>Звукореактивные эффекты</b>\n<i>нужен аудио-билд + микрофон</i>"
        btns = [InlineKeyboardButton(n, callback_data=f"afx:{n}") for n in AUDIO]
    rows = _grid(btns, 2) + extra
    rows.append([InlineKeyboardButton("⬅️ Назад", callback_data="refresh")])
    return title, InlineKeyboardMarkup(rows)


# ----------------------- Доступ -----------------------
def allowed(update: Update) -> bool:
    u = update.effective_user
    return bool(u and is_allowed(u.id))


async def _prompt_password(msg, uid: int):
    """Попросить пароль у неавторизованного пользователя."""
    if uid in _blocked:
        await msg.reply_text("⛔ Доступ заблокирован: все попытки израсходованы.")
        return
    left = _attempts_left(uid)
    await msg.reply_text(
        "🔒 Бот защищён паролем.\n"
        f"Введи пароль доступа (осталось попыток: {left}):"
    )


async def _safe_edit(q, text, kb):
    """Отредактировать сообщение, игнорируя «message is not modified»."""
    try:
        await q.edit_message_text(text, reply_markup=kb, parse_mode=ParseMode.HTML)
    except BadRequest as e:
        if "not modified" not in str(e).lower():
            raise


def _render():
    """Собрать панель из кэша STATE (или «недоступна», если оффлайн)."""
    return dashboard(STATE if ONLINE else None)


async def _show_dashboard(q):
    """Перечитать состояние с лампы и показать панель (кнопка «Обновить»)."""
    if not META["loaded"]:
        await wled_meta()
    await wled_sync()
    text, kb = _render()
    await _safe_edit(q, text, kb)


# ----------------------- Команды -----------------------
async def _send_dashboard(msg):
    if not META["loaded"]:
        await wled_meta()
    await wled_sync()
    text, kb = _render()
    await msg.reply_text(text, reply_markup=kb, parse_mode=ParseMode.HTML)


async def _web_hint(msg):
    """Отдельным сообщением — ссылка на единый сайт панели (лампа, ТВ, ИИ, ПК)."""
    if not INTELLECT_WEB_URL:
        return
    await msg.reply_text(
        _panel_text() + "\n\nОткрой ссылку в <b>Safari</b> → «Поделиться» → "
        "«На экран „Домой\"» — будет как приложение. Подробнее: /panel",
        parse_mode=ParseMode.HTML, disable_web_page_preview=True)


_BANNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "cover.png")


async def _send_banner(msg):
    """Приветственный баннер (один раз на /start)."""
    if not os.path.exists(_BANNER):
        return
    try:
        with open(_BANNER, "rb") as f:
            await msg.reply_photo(
                f, caption="<b>INTELLECT</b> — умный свет и телевизор прямо из Telegram ✨",
                parse_mode=ParseMode.HTML)
    except Exception as e:
        log.warning(f"banner: {e}")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id)
        return
    await _send_banner(update.message)
    await _send_dashboard(update.message)
    await _web_hint(update.message)


async def cmd_help(update, context):
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    await update.message.reply_text(
        "🤖 <b>Что я умею</b>\n\n"
        "💡 <b>Лампа</b>: панель по /start — питание, яркость, цвет, эффекты "
        "(со скоростью и интенсивностью), таймер выключения.\n"
        "📺 <b>Телевизор</b>: кнопка «Телевизор» — пульт, поиск ТВ в сети, "
        "приложения, таймер.\n"
        "📱 <b>Приложение</b>: /start пришлёт ссылку на веб-пульт для телефона.\n\n"
        "🎤 <b>Команды текстом</b> (просто напиши боту):\n"
        "• «включи свет», «выключи лампу», «яркость 30», «сделай красный»\n"
        "• «включи телевизор», «погромче», «потише», «без звука»\n"
        "• «открой нетфликс», «включи на ютубе &lt;запрос&gt;»\n"
        "🧠 <b>Свободная речь</b> (если включён GPT-ключ): «сделай уютно», "
        "«что-то скучно, оживи комнату», «приглуши свет и телик потише».\n\n"
        "⌨️ Быстрые команды: /on /off /toggle /find /fxlist /cancel\n"
        "🔍 /find — найти лампу в сети (например, после подключения к Wi-Fi)\n"
        "🛑 /cancel — отменить перезагрузку/выключение ПК",
        parse_mode=ParseMode.HTML)


async def cmd_on(update, context):
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    ok = await wled_post({"on": True})
    await update.message.reply_text("Включено 💡" if ok else "Лампа недоступна ❌")


async def cmd_off(update, context):
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    ok = await wled_post({"on": False})
    await update.message.reply_text("Выключено ⚪" if ok else "Лампа недоступна ❌")


async def cmd_toggle(update, context):
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    ok = await wled_post({"on": "t"})
    await update.message.reply_text("Переключено 🔁" if ok else "Лампа недоступна ❌")


async def cmd_cancel(update, context):
    """/cancel — отменить запланированную перезагрузку/выключение ПК
    или неподтверждённое опасное действие."""
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    uid = update.effective_user.id
    _pending_confirm.pop(uid, None)
    loop = asyncio.get_running_loop()
    if INTELLECT is not None:
        out = await loop.run_in_executor(None, lambda: INTELLECT.cancel_pending(uid, power=True))
        await update.message.reply_text(out.get("reply") or "Отменено ✖️")
        return
    # без ядра INTELLECT — просто прерываем выключение Windows
    from intellect.computer.control import ComputerControl
    res = await loop.run_in_executor(None, lambda: ComputerControl().cancel_shutdown())
    await update.message.reply_text(res.get("message") or "Отменено ✖️")


async def cmd_find(update, context):
    """Найти лампу в сети и переключиться на неё (без перезапуска бота).
    Удобно сразу после того, как лампу подключили к Wi-Fi."""
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    global WLED_IP, BASE
    await update.message.reply_text("🔍 Ищу лампу в сети…")
    try:
        import find_lamp
        hits = await asyncio.get_running_loop().run_in_executor(None, find_lamp.discover)
    except Exception as e:
        log.warning(f"/find: {e}")
        hits = []
    if hits:
        WLED_IP = hits[0]["ip"]
        BASE = f"http://{WLED_IP}"
        voice.init(WLED_IP)
        timers.init(WLED_IP)
        try:
            webapp_mod = __import__("webapp")
            webapp_mod._IP = WLED_IP
        except Exception:
            pass
        # Обновить лампу и у ядра INTELLECT (иначе мозг слал бы на старый IP)
        if INTELLECT is not None:
            try:
                INTELLECT.wled.ip = WLED_IP
            except Exception:
                pass
        _persist_wled_ip(WLED_IP)
        META["loaded"] = False
        await wled_meta()
        await wled_sync()
        log.info(f"🔍 /find: лампа найдена {WLED_IP} ({hits[0]['name']})")
        await update.message.reply_text(f"✅ Нашёл лампу: {WLED_IP} ({hits[0]['name']})")
        await _send_dashboard(update.message)
    else:
        log.info("🔍 /find: лампа не найдена")
        await update.message.reply_text(
            "❌ Лампа не найдена.\nПроверь: лампа включена и подключена к Wi-Fi «INTELLECT» "
            "(после сброса — через её точку «WLED-AP», пароль wled1234).")


async def cmd_fxlist(update, context):
    """Реальный список эффектов с лампы (свериться с ID для аудио)."""
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    await wled_meta()
    eff = META["effects"]
    if not eff:
        await update.message.reply_text("Не удалось получить список эффектов ❌")
        return
    lines = [f"{i}: {name}" for i, name in enumerate(eff)]
    chunk = ""
    for line in lines:
        if len(chunk) + len(line) + 1 > 3900:
            await update.message.reply_text(chunk)
            chunk = ""
        chunk += line + "\n"
    if chunk:
        await update.message.reply_text(chunk)


# ----------------------- Кнопки -----------------------
# ===================== INTELLECT 2.0 (ядро) =====================
INTELLECT = None                 # экземпляр IntellectApp (или None → базовый режим)
INTELLECT_WEB_URL = None         # URL панели в домашней сети (единый сайт, :8090)
INTELLECT_WEB = None             # объект IntellectWeb (API сайта)
# 2.4.0: INTELLECT работает ТОЛЬКО дома — без туннеля и без сайта в интернете.


def _panel_info() -> dict:
    """Где сейчас живёт панель — для /panel и сайта (/api/panel)."""
    pw = os.getenv("ACCESS_PASSWORD", "5750")
    return {"lan_url": INTELLECT_WEB_URL, "password_required": bool(pw), "password": pw}


def _panel_text() -> str:
    import panel_link
    i = _panel_info()
    return panel_link.panel_message(lan_url=i["lan_url"], password=i["password"])


async def cmd_panel(update, context):
    """/panel — ссылка на сайт панели и пароль."""
    if not allowed(update):
        await _prompt_password(update.message, update.effective_user.id); return
    await update.message.reply_text(_panel_text(), parse_mode=ParseMode.HTML,
                                    disable_web_page_preview=True)


# Файлы 2.3.x, которые больше не нужны (туннель/GitHub). Архив распаковывают ПОВЕРХ
# старой папки, поэтому сами они не исчезают — убираем при запуске.
OBSOLETE_FILES = ("cloudflared.exe", "cloudflared", "tunnel.py", "GITHUB_RESEARCH.md",
                  os.path.join("site", "config.js"), os.path.join("site", "api.json"),
                  os.path.join("site", "api.json.example"), os.path.join("tests", "test_tunnel.py"))


def _cleanup_obsolete(root: str | None = None) -> list[str]:
    root = root or os.path.dirname(os.path.abspath(__file__))
    removed = []
    for rel in OBSOLETE_FILES:
        f = os.path.join(root, rel)
        try:
            if os.path.isfile(f):
                os.remove(f)
                removed.append(rel)
        except OSError as e:
            log.warning(f"не удалился старый файл {rel}: {e}")
    if removed:
        log.info("Удалены ненужные файлы прошлой версии (туннель/GitHub): " + ", ".join(removed))
    return removed


_MAIN_LOOP = [None]   # event loop бота
_pending_confirm: dict[int, str] = {}   # uid → фраза, ждущая подтверждения


def _build_intellect():
    """Поднять ядро INTELLECT (AI/память/голос/автоматизации). Не критично:
    если не вышло — бот работает в базовом режиме на старых правилах."""
    global INTELLECT
    try:
        from intellect.app import IntellectApp
        INTELLECT = IntellectApp(log=log)
        INTELLECT.start_background()
        ai = "вкл" if INTELLECT.provider.available() else "выкл (нет ключа)"
        log.info(f"🧠 INTELLECT 2.0 ядро активно. AI: {ai}, голос: "
                 f"{'да' if INTELLECT.voice.can_listen else 'нет'}")
    except Exception as e:
        INTELLECT = None
        log.warning(f"INTELLECT-ядро не поднялось ({type(e).__name__}: {e}); базовый режим")


async def _intellect_reply(reply_func, uid, name, text, confirm=False):
    """Прогнать текст через ядро и ответить. reply_func(text, reply_markup=None)."""
    loop = asyncio.get_running_loop()
    out = await loop.run_in_executor(
        None, lambda: INTELLECT.handle_text(uid, text, name=name, confirm=confirm))
    if not (out.get("reply") or "").strip():
        out["reply"] = "Готово."
    if out.get("pending_confirmation") and not confirm:
        _pending_confirm[uid] = text
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Подтвердить", callback_data="cfm:yes"),
            InlineKeyboardButton("❌ Отмена", callback_data="cfm:no")]])
        await reply_func(out["reply"], reply_markup=kb)
    else:
        await reply_func(out["reply"])
    if out.get("did_actions"):
        try:
            await wled_sync()
        except Exception:
            pass
    return out


async def on_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Голосовое сообщение → распознать (Whisper) → обработать ядром."""
    msg = update.message
    uid = update.effective_user.id
    if not is_allowed(uid):
        await _prompt_password(msg, uid); return
    if INTELLECT is None or not INTELLECT.voice.can_listen:
        await msg.reply_text("🎤 Голос недоступен: нужен ключ OpenAI в .env (OPENAI_API_KEY).")
        return
    import os as _os, tempfile, uuid as _uuid
    await context.bot.send_chat_action(msg.chat.id, "typing")
    src = msg.voice or msg.audio
    tgfile = await src.get_file()
    # уникальное имя: два подряд голосовых от одного юзера не затирают друг друга
    path = _os.path.join(tempfile.gettempdir(), f"voice_{uid}_{_uuid.uuid4().hex[:8]}.oga")
    await tgfile.download_to_drive(path)
    loop = asyncio.get_running_loop()
    out = await loop.run_in_executor(
        None, lambda: INTELLECT.handle_voice(uid, path, name=update.effective_user.full_name))
    try:
        _os.remove(path)
    except Exception:
        pass
    transcript = out.get("transcript") or ""
    reply = (f"🗣 «{transcript}»\n\n" if transcript else "") + out["reply"]
    if out.get("pending_confirmation"):
        _pending_confirm[uid] = transcript
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Подтвердить", callback_data="cfm:yes"),
            InlineKeyboardButton("❌ Отмена", callback_data="cfm:no")]])
        await msg.reply_text(reply, reply_markup=kb)
    else:
        await msg.reply_text(reply)
        if INTELLECT.voice.can_speak:
            mp3 = await loop.run_in_executor(None, lambda: INTELLECT.voice.speak(out["reply"]))
            if mp3:
                try:
                    with open(mp3, "rb") as vf:
                        await msg.reply_voice(vf)
                    _os.remove(mp3)
                except Exception:
                    pass
    if out.get("did_actions"):
        try:
            await wled_sync()
        except Exception:
            pass


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Любой текст от неавторизованного — это попытка ввести пароль."""
    msg = update.message
    uid = update.effective_user.id
    if is_allowed(uid):
        text = (msg.text or "").strip()
        name = update.effective_user.full_name
        # INTELLECT 2.0: умный роутинг (AI + память + инструменты)
        if INTELLECT is not None:
            log.info(f"💬 {name}: «{text}»")
            await context.bot.send_chat_action(msg.chat.id, "typing")
            await _intellect_reply(msg.reply_text, uid, name, text)
            return
        # базовый режим: старые правила
        loop = asyncio.get_running_loop()
        ok, reply = await loop.run_in_executor(None, voice.handle, text)
        log.info(f"💬 {name}: «{text}» -> {'OK' if ok else 'не вышло'}: {reply}")
        await msg.reply_text(reply)
        if ok:
            await wled_sync()
        return
    if uid in _blocked:
        await msg.reply_text("⛔ Доступ заблокирован: все попытки израсходованы.")
        return
    entered = (msg.text or "").strip()
    if entered == ACCESS_PASSWORD:
        _authorized.add(uid)
        _attempts.pop(uid, None)
        _save_access()
        await msg.reply_text("✅ Пароль верный — доступ открыт!")
        await _send_dashboard(msg)
        await _web_hint(msg)
    else:
        _attempts[uid] = _attempts.get(uid, 0) + 1
        left = _attempts_left(uid)
        if left <= 0:
            _blocked.add(uid)
            _save_access()
            await msg.reply_text("⛔ Неверный пароль. Попытки кончились — доступ заблокирован.")
        else:
            await msg.reply_text(f"❌ Неверный пароль. Осталось попыток: {left}")


# ----------------------- Телевизор (хендлеры) -----------------------
async def _tv_scan(q):
    """Найти телевизоры в сети и показать списком."""
    await _safe_edit(q, "📡 Ищу телевизоры в сети… (3 сек)",
                     InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="nav:tv")]]))
    loop = asyncio.get_running_loop()
    tvs = await loop.run_in_executor(None, tvremote.discover, 3.0)
    if not tvs:
        await _safe_edit(q, "📺 Телевизоры не найдены.\nПроверь, что ТВ включён и в той же WiFi.",
                         InlineKeyboardMarkup([
                             [InlineKeyboardButton("🔁 Повторить", callback_data="tv:scan")],
                             [InlineKeyboardButton("⬅️ Назад к лампе", callback_data="refresh")]]))
        return
    rows = [[InlineKeyboardButton("📺 " + (t.get("model") or t.get("name") or "Samsung") + " — " + t["ip"],
                                  callback_data="tvip:" + t["ip"])] for t in tvs[:8]]
    rows.append([InlineKeyboardButton("⬅️ Назад к лампе", callback_data="refresh")])
    await _safe_edit(q, "📺 <b>Найдены телевизоры</b> — выбери свой:", InlineKeyboardMarkup(rows))


async def _tv_pick(q, ip):
    """Выбран телевизор: определить протокол и показать пульт."""
    loop = asyncio.get_running_loop()
    info = await loop.run_in_executor(None, tvremote.detect, ip)
    tvremote.config.update(ip=ip, method=info.get("method") or "", mac=info.get("mac", ""),
                           name=info.get("name", ""), model=info.get("model", ""))
    tvremote.save_config()
    await _safe_edit(q, *tv_menu())


async def _tv_app(q, app_id):
    """Запустить приложение (YouTube/Netflix) на ТВ."""
    cfg = tvremote.config
    if not cfg.get("ip"):
        await q.answer("Сначала найди телевизор", show_alert=True)
        return
    loop = asyncio.get_running_loop()
    ok = False
    try:
        await loop.run_in_executor(
            None, lambda: tvremote.run_app(cfg["ip"], app_id, cfg["method"] or None))
        ok = True
    except Exception:
        ok = False
    if ok:
        await q.answer("✓ Запускаю приложение")
    else:
        await q.answer("⚠️ Не вышло (нужен WebSocket-ТВ)", show_alert=True)


async def _tv_power(q, turn_on: bool):
    """Надёжное вкл/выкл телевизора (WoL+POWERON / POWEROFF)."""
    if not tvremote.config.get("ip"):
        await q.answer("Сначала найди телевизор", show_alert=True)
        return
    loop = asyncio.get_running_loop()
    ok = await loop.run_in_executor(None, tvremote.power, turn_on)
    if ok:
        await q.answer("✓ Включаю телевизор" if turn_on else "✓ Выключаю телевизор")
    else:
        await q.answer("⚠️ Нет связи с телевизором", show_alert=True)


async def _tv_browser(q):
    """Открыть YouTube в браузере телевизора."""
    if not tvremote.config.get("ip"):
        await q.answer("Сначала найди телевизор", show_alert=True)
        return
    loop = asyncio.get_running_loop()
    ok = await loop.run_in_executor(None, lambda: tvremote.open_browser("https://m.youtube.com"))
    await q.answer("🌐 Открываю YouTube в браузере" if ok else "⚠️ Не вышло (нужен WebSocket-ТВ)",
                   show_alert=not ok)


async def _tv_key(q, key):
    """Послать клавишу телевизору (с тостом-результатом)."""
    cfg = tvremote.config
    if not cfg.get("ip"):
        await q.answer("Сначала найди телевизор", show_alert=True)
        return
    loop = asyncio.get_running_loop()
    if key == "KEY_POWER" and cfg.get("mac"):
        await loop.run_in_executor(None, tvremote.wake_on_lan, cfg["mac"])
    ok = False
    try:
        method = await loop.run_in_executor(
            None, lambda: tvremote.send_key(cfg["ip"], key, cfg["method"] or None))
        if method and method != cfg["method"]:
            cfg["method"] = method
            tvremote.save_config()
        ok = True
    except Exception:
        ok = False
    # ответ строго один раз (вне try, чтобы не ответить дважды)
    if ok:
        await q.answer("✓ " + key.replace("KEY_", ""))
    else:
        await q.answer("⚠️ Нет связи с телевизором", show_alert=True)


async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not allowed(update):
        await q.answer("🔒 Введи пароль в чате — команда /start", show_alert=True)
        return

    global ONLINE
    data = q.data

    # ---- Подтверждение опасного действия (INTELLECT) ----
    if data.startswith("cfm:"):
        await q.answer()
        uid = q.from_user.id
        _pending_confirm.pop(uid, None)
        # убираем кнопки: иначе можно нажать «Отмена» уже ПОСЛЕ «Подтвердить»
        try:
            await q.edit_message_reply_markup(reply_markup=None)
        except Exception:
            pass
        if data == "cfm:yes" and INTELLECT is not None:
            # выполняем РОВНО то действие, что ждало подтверждения (без перезапроса GPT)
            loop = asyncio.get_running_loop()
            out = await loop.run_in_executor(None, lambda: INTELLECT.confirm_pending(uid))
            await q.message.reply_text(out.get("reply") or "Готово.")
            if out.get("did_actions"):
                try:
                    await wled_sync()
                except Exception:
                    pass
        else:
            reply = "Отменено ✖️"
            if INTELLECT is not None:
                loop = asyncio.get_running_loop()
                reply = (await loop.run_in_executor(
                    None, lambda: INTELLECT.cancel_pending(uid))).get("reply") or reply
            await q.message.reply_text(reply)
        return

    # ---- Телевизор: клавиша / приложение (отвечаем тостом с результатом) ----
    if data.startswith("tvk:"):
        await _tv_key(q, data[4:])
        return
    if data.startswith("tva:"):
        await _tv_app(q, data[4:])
        return
    if data.startswith("tvpw:"):
        await _tv_power(q, data == "tvpw:on")
        return
    if data == "tvbr":
        await _tv_browser(q)
        return

    await q.answer()  # быстрый ответ, чтобы убрать «часики»

    # ---- Телевизор: меню / цифры / поиск / выбор ----
    if data == "nav:tv":
        await _safe_edit(q, *tv_menu())
        return
    if data == "tv:nums":
        await _safe_edit(q, *tv_nums())
        return
    if data == "tv:scan":
        await _tv_scan(q)
        return
    if data.startswith("tvip:"):
        await _tv_pick(q, data[5:])
        return

    # Таймеры авто-выключения (лампа/ТВ)
    if data == "nav:tmrlamp":
        await _safe_edit(q, *timer_menu("lamp"))
        return
    if data == "nav:tmrtv":
        await _safe_edit(q, *timer_menu("tv"))
        return
    if data.startswith("tmr:"):
        _, kind, mins = data.split(":")
        timers.set_timer(kind, mins)   # 0 = отменить
        await _safe_edit(q, *timer_menu(kind))
        return

    # Скорость/интенсивность из меню эффектов — применяем и ОСТАЁМСЯ в меню
    if data[:4] in ("sxf:", "ixf:"):
        param = "sx" if data.startswith("sxf:") else "ix"
        cur = int(_seg().get(param, 128))
        new = max(0, min(255, cur + (BRI_STEP if data.endswith("up") else -BRI_STEP)))
        _seg()[param] = new
        ONLINE = True
        ok = await wled_post({"on": True, "seg": [{param: new}]})
        if not ok:
            ONLINE = False
        await _safe_edit(q, *submenu("fx"))
        return

    # Навигация в подменю лампы
    if data.startswith("nav:"):
        title, kb = submenu(data[4:])
        await _safe_edit(q, title, kb)
        return

    # Обновить / назад — реально перечитать с лампы
    if data == "refresh":
        await _show_dashboard(q)
        return

    # Действия. Кэш STATE меняем сразу (предсказательно), команду лампе и
    # обновление панели в Telegram запускаем ПАРАЛЛЕЛЬНО — так отклик быстрее.
    if data == "toggle":
        new_on = not STATE.get("on", False)
        payload = {"on": new_on}
        STATE["on"] = new_on
    elif data in ("bri:up", "bri:dn"):
        cur = int(STATE.get("bri", 128))
        new = max(1, min(255, cur + (BRI_STEP if data == "bri:up" else -BRI_STEP)))
        payload = {"on": True, "bri": new}
        STATE["on"], STATE["bri"] = True, new
    elif data.startswith("bri:"):
        new = int(data[4:])
        payload = {"on": True, "bri": new}
        STATE["on"], STATE["bri"] = True, new
    elif data in ("sx:up", "sx:dn"):
        cur = int(_seg().get("sx", 128))
        new = max(0, min(255, cur + (BRI_STEP if data == "sx:up" else -BRI_STEP)))
        payload = {"seg": [{"sx": new}]}
        _seg()["sx"] = new
    elif data.startswith("sx:"):
        new = int(data[3:])
        payload = {"seg": [{"sx": new}]}
        _seg()["sx"] = new
    elif data.startswith("col:"):
        r, g, b = COLORS[data[4:]][1]
        payload = {"on": True, "seg": [{"col": [[r, g, b]]}]}
        STATE["on"] = True
        _seg()["col"] = [[r, g, b]]   # просто заменяем (без индексации пустого списка)
    elif data.startswith("fx:") or data.startswith("afx:"):
        name = data.split(":", 1)[1]
        idx = AUDIO[name] if data.startswith("afx:") else EFFECTS[name]
        payload = {"on": True, "seg": [{"fx": idx}]}
        STATE["on"] = True
        _seg()["fx"] = idx
    else:
        return

    ONLINE = True  # оптимистично; если команда не дойдёт — поправим ниже
    text, kb = _render()
    # return_exceptions: ошибка правки сообщения не должна срывать обработку
    res = await asyncio.gather(_safe_edit(q, text, kb), wled_post(payload),
                               return_exceptions=True)
    if res[1] is not True:   # команда лампе не прошла
        ONLINE = False
        try:
            await _safe_edit(q, *_render())
        except Exception:
            pass


# ----------------------- Пропущенное, пока бот был выключен -----------------------
STALE = stale_updates.StaleGate()
# Уведомление уходит, когда разобрана вся очередь простоя (или перед ответом на
# свежее сообщение этого чата). Таймер — только если размер очереди неизвестен:
# столько секунд тишины в потоке старых апдейтов чата.
_STALE_NOTICE_DELAY = 2.0


async def _send_stale_notice(bot, chat_id: int):
    """Одно уведомление на чат: сколько пропущено и что можно повторить."""
    text = STALE.pop_notice(chat_id)
    if not text:
        return
    kb = (InlineKeyboardMarkup([[InlineKeyboardButton("📋 Открыть панель", callback_data="refresh")]])
          if is_allowed(chat_id) else None)
    try:
        await bot.send_message(chat_id, text, reply_markup=kb)
        log.info(f"⏸ Чат {chat_id}: {text.splitlines()[0]}")
    except Exception as e:
        log.warning(f"Уведомление о пропущенном не отправилось: {e}")


async def _flush_stale_notices(bot):
    """Очередь простоя разобрана — по одному уведомлению в каждый чат с пропущенным."""
    for chat_id in STALE.pending_chats():
        await _send_stale_notice(bot, chat_id)


async def _send_stale_notice_later(bot, chat_id: int):
    """Запасной путь, если конец очереди не виден (getWebhookInfo не ответил)."""
    while STALE.has_pending(chat_id):
        await asyncio.sleep(_STALE_NOTICE_DELAY)
        if STALE.ready(chat_id, _STALE_NOTICE_DELAY):
            await _send_stale_notice(bot, chat_id)


async def _stale_gate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Группа -1 — раньше всех хендлеров. Накопленное за время простоя не
    обрабатываем (ApplicationHandlerStop), а сообщаем о нём один раз на чат."""
    chat = update.effective_chat
    if not STALE.is_stale(update):
        if chat is not None and STALE.has_pending(chat.id):
            await _send_stale_notice(context.bot, chat.id)   # уведомление — раньше ответа на свежее
        if STALE.backlog_done:
            await _flush_stale_notices(context.bot)
        return
    q = update.callback_query
    answered = False
    if q is not None:
        try:
            # нажатие во время запуска ещё можно «ответить» — пусть просто нажмёт снова
            await q.answer("⏸ Я был выключен — нажми кнопку ещё раз.", show_alert=True)
            answered = True
        except Exception:
            pass   # нажатие слишком старое — сообщим в чате вместе с остальным
        log.info(f"⏭ Пропускаю нажатие кнопки «{q.data}» из очереди простоя")
    else:
        m = update.effective_message
        when = f"{m.date.astimezone():%H:%M}" if m is not None and m.date else "?"
        text = ((m.text or m.caption or "") if m is not None else "")[:60]
        log.info(f"⏭ Пропускаю старое сообщение ({when}): «{text}»")
    if not answered and STALE.record(update) and chat is not None and STALE.backlog is None:
        context.application.create_task(_send_stale_notice_later(context.bot, chat.id))
    if STALE.backlog_done:
        # последний апдейт очереди простоя — одно уведомление на чат, с полным счётом
        await _flush_stale_notices(context.bot)
    raise ApplicationHandlerStop



# ----------------------- Жизненный цикл -----------------------
async def _post_init(app):
    _MAIN_LOOP[0] = asyncio.get_running_loop()
    if os.getenv("TUNNEL", "0").strip() not in ("0", "", "no", "off"):
        log.info("TUNNEL в .env больше не используется: INTELLECT работает только в домашней сети.")
    _cleanup_obsolete()
    # Прогреть кэш: имя/эффекты и текущее состояние (не критично, если лампа спит).
    await wled_meta()
    await wled_sync()
    if not ONLINE:
        # окончательный вывод — здесь, а не сразу при старте: лампа по Wi-Fi
        # часто отвечает не с первой секунды (была ложная тревога «не найдена»)
        log.warning(f"Лампа WLED по {WLED_IP} не отвечает. Проверь, что она включена и "
                    "подключена к Wi-Fi «INTELLECT». Если сменился IP — отправь боту /find.")
    # Подсказки команд в меню Telegram
    try:
        from telegram import BotCommand
        await app.bot.set_my_commands([
            BotCommand("start", "Панель управления"),
            BotCommand("help", "Что я умею"),
            BotCommand("on", "Включить лампу"),
            BotCommand("off", "Выключить лампу"),
            BotCommand("toggle", "Переключить лампу"),
            BotCommand("find", "Найти лампу в сети"),
            BotCommand("fxlist", "Список эффектов с лампы"),
            BotCommand("cancel", "Отменить перезагрузку/выключение ПК"),
            BotCommand("panel", "Сайт панели и пароль"),
        ])
    except Exception as e:
        log.warning(f"set_my_commands: {e}")
    # Сколько апдейтов ждало в Telegram до запуска: их отдадут первыми (см. _stale_gate).
    try:
        info = await app.bot.get_webhook_info()
        STALE.set_backlog(info.pending_update_count)
        if info.pending_update_count:
            log.info(f"📬 Пока бот был выключен, накопилось апдейтов: {info.pending_update_count}")
    except Exception as e:
        log.warning(f"getWebhookInfo: {e}")
    STALE.arm()   # дальше сразу опрос: с этого момента отсчёт окна очереди простоя


async def _post_shutdown(app):
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _lamp_reachable(ip: str, timeout: float = 2.0, attempts: int = 1) -> bool:
    """Синхронная проверка, что по этому IP отвечает лампа WLED.
    attempts>1 — повторы с растущим таймаутом (2 → 3 → 4 с): лампа по Wi-Fi
    на первый запрос после простоя нередко молчит пару секунд."""
    import find_lamp
    hit, why = find_lamp.check(ip, attempts=attempts, timeout=timeout)
    if hit is None and attempts > 1:
        log.info(f"Лампа {ip}: нет ответа (попыток: {attempts}; {why}).")
    return hit is not None


def _persist_wled_ip(ip: str) -> None:
    """Обновить строку WLED_IP в .env, чтобы в следующий раз найти сразу."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        lines, found = [], False
        if os.path.exists(path):
            with open(path, encoding="utf-8-sig") as f:
                for line in f:
                    if line.strip().startswith("WLED_IP="):
                        lines.append(f"WLED_IP={ip}\n"); found = True
                    else:
                        lines.append(line)
        if not found:
            lines.append(f"WLED_IP={ip}\n")
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    except Exception as e:
        log.warning(f"не смог записать WLED_IP в .env: {e}")


# ----------------------- main -----------------------
_INSTANCE_LOCK = None   # держим сокет-замок до конца работы процесса


def main():
    global WLED_IP, BASE, _INSTANCE_LOCK
    import sys
    import startup_checks as sc
    # 1) Настройки: шаблонный/пустой токен → понятная ошибка и код 2
    #    (START.bat откроет .env, а не будет перезапускать бота каждые 5 сек).
    problem = sc.config_problem(BOT_TOKEN, os.getenv("ALLOWED_USERS"))
    _diag = {"Проверка .env": problem or "ок"}
    diaglog.write_diag(_diag)              # снимок сразу — даже если дальше выход
    if problem:
        log.error(f"⚙️ {problem}")
        sys.exit(sc.EXIT_BAD_CONFIG)
    # 2) Только одна копия: две копии с одним токеном Telegram не пускает.
    _INSTANCE_LOCK = sc.acquire_single_instance_lock()
    if _INSTANCE_LOCK is None:
        _diag["Запуск"] = "ОТКАЗ: уже запущена другая копия на этом ПК"
        diaglog.write_diag(_diag)
        log.error("⛔ Бот INTELLECT уже запущен в другом окне. Закрой лишнее окно "
                  "(две копии одновременно Telegram не пускает).")
        sys.exit(sc.EXIT_ALREADY_RUNNING)
    _load_access()
    tvremote.load_config()  # общий конфиг телевизора (с веб-приложением)

    log.info("==================== INTELLECT ====================")
    log.info(f"Старт: {datetime.now():%Y-%m-%d %H:%M:%S} | версия {diaglog.version()}")
    log.info(f"Лампа (из .env): {WLED_IP} | ТВ: {tvremote.config.get('ip') or 'не задан'} | "
             f"AI: {'вкл' if os.getenv('OPENAI_API_KEY') else 'выкл (правила)'}")
    log.info(f"Доступ разрешён ID: {os.getenv('ALLOWED_USERS') or 'всем'}")
    log.info("==================================================")

    # Авто-поиск лампы: если фиксированный IP недоступен (сменился Wi-Fi/роутер —
    # IP или подсеть могли поменяться), ищем WLED по сети и берём найденный.
    # Сначала 3 попытки (до ~10 с): лампа по Wi-Fi нередко отвечает не на первый
    # запрос. Вывод «лампы нет» — только в _post_init, ещё через полминуты
    # (14.11: «не найдена» в 13:53:47, а в 13:54:09 она уже отвечала).
    if not _lamp_reachable(WLED_IP, attempts=3):
        log.info(f"Лампа по {WLED_IP} пока не отвечает — ищу в сети (вдруг сменился IP)…")
        try:
            import find_lamp
            hits = find_lamp.discover()
            if any(h["ip"] == WLED_IP for h in hits):   # проснулась, IP прежний
                log.info(f"🟢 Лампа ответила: {WLED_IP}")
            elif hits:
                WLED_IP = hits[0]["ip"]
                BASE = f"http://{WLED_IP}"
                # ядро INTELLECT читает настройки из окружения — иначе ИИ/голос/
                # автоматизации слали бы команды на старый IP до перезапуска
                os.environ["WLED_IP"] = WLED_IP
                log.info(f"✅ Лампа найдена: {WLED_IP} ({hits[0]['name']}). Обновляю .env.")
                _persist_wled_ip(WLED_IP)
            else:
                log.info(f"Лампа по {WLED_IP} пока не отвечает. Бот запускается дальше "
                         "и проверит её ещё раз после подключения к Telegram.")
        except Exception as e:
            log.warning(f"Автопоиск лампы не удался: {e}")

    timers.init(WLED_IP)    # таймеры авто-выключения лампы/ТВ
    voice.init(WLED_IP)     # текстовые/голосовые команды (базовый режим)
    _build_intellect()      # ядро INTELLECT 2.0 (AI/память/голос/автоматизации)
    if INTELLECT is not None and INTELLECT.wled.ip != WLED_IP:
        INTELLECT.wled.ip = WLED_IP   # тот же IP лампы, что нашёл автопоиск

    # Единый сайт панели (site/) + API на :8090 — только домашняя сеть (2.4.0)
    global INTELLECT_WEB_URL, INTELLECT_WEB
    if INTELLECT is not None:
        try:
            from intellect.web import start_web
            intel_port = int(os.getenv("INTELLECT_WEB_PORT", "8090"))
            INTELLECT_WEB_URL, INTELLECT_WEB = start_web(INTELLECT, intel_port)
            INTELLECT_WEB.api.panel_provider = _panel_info
            log.info(f"🖥 Панель INTELLECT (дома): {INTELLECT_WEB_URL}")
        except Exception as e:
            log.warning(f"Панель INTELLECT не запустилась: {e}")

    # Старый веб-пульт :8080 — заменён единым сайтом; включается только WEB_PORT=8080.
    web_port = int(os.getenv("WEB_PORT", "0") or 0)
    if web_port:
        try:
            import webapp as _webapp_mod
            from webapp import serve, lan_ip
            serve(WLED_IP, web_port)
            # голос старого пульта — через единый AI-мозг (если ядро поднято)
            if INTELLECT is not None:
                _ids = INTELLECT.settings.allowed_users
                _wu = _ids[0] if _ids else 0

                def _brain_voice(t, _u=_wu):
                    o = INTELLECT.handle_text(_u, t)
                    return bool(o.get("did_actions") or o.get("reply")), (o.get("reply") or "Готово.")
                _webapp_mod.BRAIN_HANDLER = _brain_voice
            ip = lan_ip()
            global WEB_URL
            WEB_URL = f"http://{ip}:{web_port}"
            log.info("=" * 48)
            log.info(f"📱 Приложение для телефона: {WEB_URL}")
            log.info("   Открой этот адрес в Safari на айфоне →")
            log.info("   «Поделиться» → «На экран Домой» = иконка-приложение.")
            log.info("=" * 48)
        except Exception as e:
            log.warning(f"Веб-приложение не запустилось: {e}")
    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )
    # старое (пришло, пока бот был выключен) — отсекаем раньше всех хендлеров
    app.add_handler(TypeHandler(Update, _stale_gate), group=-1)
    app.add_handler(CommandHandler(["start", "menu"], start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("on", cmd_on))
    app.add_handler(CommandHandler("off", cmd_off))
    app.add_handler(CommandHandler("toggle", cmd_toggle))
    app.add_handler(CommandHandler("fxlist", cmd_fxlist))
    app.add_handler(CommandHandler("find", cmd_find))
    app.add_handler(CommandHandler("cancel", cmd_cancel))
    app.add_handler(CommandHandler("panel", cmd_panel))
    app.add_handler(CallbackQueryHandler(on_button))
    # только НОВЫЕ сообщения: правка старого (edited_message) раньше роняла on_text
    # (update.message там None → AttributeError)
    app.add_handler(MessageHandler((filters.VOICE | filters.AUDIO) & filters.UpdateType.MESSAGE, on_voice))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND & filters.UpdateType.MESSAGE, on_text))
    log.info("Бот запущен. Ctrl+C для остановки.")
    log.info(f"📄 Журналы — в папке logs\\ рядом с ботом ({LOG_FILE}); её можно прислать для разбора.")
    _diag.update({
        "Лампа": f"{WLED_IP} ({'отвечает' if _lamp_reachable(WLED_IP) else 'НЕ ОТВЕЧАЕТ'})",
        "Ядро INTELLECT": ("вкл, ИИ " + ("вкл" if INTELLECT.provider.available() else "ВЫКЛ (нет ключа)"))
                          if INTELLECT is not None else "ВЫКЛ",
        "Ядро: IP лампы": getattr(getattr(INTELLECT, "wled", None), "ip", "—"),
        "Панель INTELLECT": INTELLECT_WEB_URL or "—",
        "Приложение для телефона": globals().get("WEB_URL") or "— (заменено единым сайтом)",
        "Доступ к панели": "только домашняя сеть (без интернета)",
        "Запуск": "до подключения к Telegram дошли",
    })
    diaglog.write_diag(_diag)
    from telegram.error import InvalidToken, Conflict
    import time as _time
    # уходит только ТОЛЬКО ЧТО запущенная копия; давно работающая — остаётся
    watch = sc.ConflictWatch(started=_time.monotonic())

    async def _on_error(update, context):
        err = context.error
        if isinstance(err, Conflict):
            # PTB не бросает Conflict из run_polling, а повторяет вечно —
            # ловим серию 409 и останавливаемся сами (иначе две копии дерутся).
            log.warning("Telegram: Conflict — этим токеном пользуется ещё одна копия бота.")
            if watch.hit(_time.monotonic()):
                context.application.stop_running()
            return
        log.error(f"Ошибка: {err!r}", exc_info=err)

    app.add_error_handler(_on_error)
    try:
        app.run_polling()
    except InvalidToken:
        _diag["Запуск"] = "ОТКАЗ: Telegram отверг токен (неверный или отозван)"
        diaglog.write_diag(_diag)
        log.error("⚙️ Telegram отверг WLED_BOT_TOKEN из .env (токен неверный или отозван). "
                  "Возьми актуальный токен у @BotFather и впиши в .env.")
        sys.exit(sc.EXIT_BAD_CONFIG)
    if watch.tripped:
        _diag["Запуск"] = "ОСТАНОВЛЕН: этим токеном пользуется другая копия (Conflict 409)"
        diaglog.write_diag(_diag)
        log.error("⛔ Этим ботом уже пользуется ДРУГАЯ копия (старое окно INTELLECT или "
                  "другой ПК). Закрой её и запусти START.bat снова.")
        sys.exit(sc.EXIT_ALREADY_RUNNING)


if __name__ == "__main__":
    main()
