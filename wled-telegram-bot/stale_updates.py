#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stale_updates.py — не отвечать на то, что накопилось, пока бот был выключен.

Telegram хранит непрочитанные апдейты до 24 часов и при запуске отдаёт их все
разом. Раньше бот отвечал на каждый: 13 старых /start = 13 баннеров + 13 панелей
+ 13 ссылок, плюс ответ ИИ на каждое «Ку»/«Ау» — «Ого ты заспамил».

Правила:
  • Сообщение (и правка сообщения) старше «момента запуска минус GRACE_SEC» —
    устаревшее: не обрабатываем. Сообщение, отправленное во время 5-секундного
    перезапуска START.bat или пока бот грузится, моложе — обрабатывается как обычно.
    Порог фиксирован (BOOT_TS берётся при импорте), поэтому даже если часы ПК
    спешат, это задевает лишь первые минуты после запуска, а не всё время работы.
  • Нажатие кнопки (callback_query) в Telegram НЕ имеет времени нажатия, а
    callback_query.message.date — это время, когда бот прислал панель (по нему
    судить нельзя: сломались бы все кнопки на вчерашней панели). Поэтому старым
    считаем нажатие, которое уже лежало в очереди при запуске (первые
    pending_update_count апдейтов из getWebhookInfo): к моменту запуска оно
    старше времени загрузки бота, а кнопки делают реальные действия (ТВ, лампа).
    Кнопки старых панелей, нажатые ПОСЛЕ запуска, работают как обычно.
  • На все пропущенные апдейты чата — ОДНО уведомление «повтори, если нужно».

Модуль — только стандартная библиотека (подключается до telegram/httpx).
"""
from __future__ import annotations

import time
from datetime import datetime

# Момент запуска процесса: wled_bot импортирует модуль в самом начале.
BOOT_TS = time.time()

# Запас на перезапуск: пауза START.bat (5 с) + старт Python, а при ручном
# запуске START.bat — ещё автозапуск/поиск лампы (~40 с по logs\start.log).
GRACE_SEC = 120.0


def plural(n: int, one: str, few: str, many: str) -> str:
    """Русское число: 1 сообщение, 2 сообщения, 5 сообщений, 21 сообщение."""
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _ts(dt) -> float | None:
    if dt is None:
        return None
    if isinstance(dt, (int, float)):
        return float(dt)
    try:
        return dt.timestamp()          # PTB отдаёт aware-datetime (UTC)
    except Exception:
        return None


def _hm(ts: float, ref: float) -> str:
    d = datetime.fromtimestamp(ts)     # местное время ПК — как у пользователя
    same_day = d.date() == datetime.fromtimestamp(ref).date()
    return d.strftime("%H:%M" if same_day else "%d.%m %H:%M")


def notice_text(msgs: int, taps: int, first: float | None, last: float | None,
                now: float | None = None) -> str:
    """Текст единственного уведомления о пропущенном."""
    now = time.time() if now is None else now
    parts = []
    if msgs:
        parts.append(f"{msgs} {plural(msgs, 'сообщение', 'сообщения', 'сообщений')}")
    if taps:
        parts.append(f"{taps} {plural(taps, 'нажатие кнопки', 'нажатия кнопок', 'нажатий кнопок')}")
    span = ""
    if first is not None and last is not None:
        a, b = _hm(first, now), _hm(last, now)
        span = f" (в {a})" if a == b else f" (с {a} до {b})"
    return (f"⏸ Я был выключен и пропустил {' и '.join(parts)}{span}.\n"
            "Отвечать на старое не стал, чтобы не заспамить, — повтори, если что-то ещё нужно.")


class StaleGate:
    """Решает, устарел ли апдейт, и копит пропущенное по чатам."""

    def __init__(self, boot_ts: float | None = None, grace: float = GRACE_SEC):
        self.cutoff = (BOOT_TS if boot_ts is None else boot_ts) - grace
        # Сколько первых апдейтов лежало в очереди Telegram до запуска (getWebhookInfo).
        # None — неизвестно (запрос не удался): тогда судим только по дате.
        self.backlog: int | None = None
        self._chats: dict[int, dict] = {}

    def set_backlog(self, pending_update_count) -> None:
        try:
            self.backlog = max(0, int(pending_update_count or 0))
        except (TypeError, ValueError):
            self.backlog = None

    def is_stale(self, update) -> bool:
        """Вызывать РОВНО ОДИН раз на каждый апдейт (по порядку, как их отдаёт PTB).

        Старым может быть ТОЛЬКО то, что уже лежало в очереди при запуске:
        всё, что пришло после, обрабатывается всегда — даже если часы ПК
        спешат (иначе бот первые минуты игнорировал бы свежие сообщения).
        """
        known = self.backlog is not None
        in_backlog = known and self.backlog > 0
        if in_backlog:
            self.backlog -= 1
        if getattr(update, "callback_query", None) is not None:
            return in_backlog
        if known and not in_backlog:
            return False
        edited = getattr(update, "edited_message", None)
        msg = getattr(update, "message", None) or edited
        if msg is None:
            return False
        ts = _ts((getattr(msg, "edit_date", None) if edited is not None else None)
                 or getattr(msg, "date", None))
        return ts is not None and ts < self.cutoff

    def record(self, update) -> bool:
        """Учесть пропущенный апдейт. True — первый в этом чате (пора планировать уведомление)."""
        chat = getattr(update, "effective_chat", None)
        if chat is None:
            return False
        st = self._chats.get(chat.id)
        is_first = st is None
        if is_first:
            st = self._chats[chat.id] = {"msgs": 0, "taps": 0, "first": None, "last": None}
        if getattr(update, "callback_query", None) is not None:
            st["taps"] += 1
        else:
            st["msgs"] += 1
            msg = update.message or update.edited_message
            ts = _ts(getattr(msg, "date", None)) if msg is not None else None
            if ts is not None:
                st["first"] = ts if st["first"] is None else min(st["first"], ts)
                st["last"] = ts if st["last"] is None else max(st["last"], ts)
        return is_first

    def has_pending(self, chat_id: int) -> bool:
        return chat_id in self._chats

    def pop_notice(self, chat_id: int, now: float | None = None) -> str | None:
        """Забрать текст уведомления для чата (один раз) или None."""
        st = self._chats.pop(chat_id, None)
        if not st or not (st["msgs"] or st["taps"]):
            return None
        return notice_text(st["msgs"], st["taps"], st["first"], st["last"], now)
