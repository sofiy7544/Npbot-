#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
startup_checks.py — проверки перед запуском бота.

Коды выхода (их понимает START.bat):
  2 — ошибка настройки (.env): токен не вписан / шаблонный / Telegram его отверг,
      или ALLOWED_USERS оставлен шаблонным. START.bat откроет .env и остановится,
      вместо бесконечного перезапуска каждые 5 секунд.
  3 — бот уже запущен в другом окне. Две копии с одним токеном Telegram не
      пускает (ошибка Conflict), поэтому вторая копия сразу выходит.
"""
from __future__ import annotations

import re
import socket

EXIT_BAD_CONFIG = 2
EXIT_ALREADY_RUNNING = 3

# Порт-«замок» на localhost: занять его может только один процесс.
# INTELLECT_LOCK_PORT — только для тестов (параллельные прогоны не мешают друг другу).
try:
    LOCK_PORT = int(__import__("os").environ.get("INTELLECT_LOCK_PORT", "47831"))
except ValueError:
    LOCK_PORT = 47831

# Токен BotFather: <цифры>:<35 символов base64url>
_TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")
_PLACEHOLDER_IDS = {"123456789"}


def config_problem(token: str | None, allowed_users: str | None) -> str | None:
    """Вернуть текст проблемы с .env или None, если всё в порядке."""
    t = (token or "").strip()
    if not t or "ВСТАВЬ" in t.upper():
        return "В .env не вписан WLED_BOT_TOKEN (токен бота от @BotFather)."
    if "xxxx" in t.lower() or t.startswith("123456789:"):
        return ("В .env остался ШАБЛОННЫЙ WLED_BOT_TOKEN из примера. "
                "Впиши настоящий токен от @BotFather.")
    if not _TOKEN_RE.match(t):
        return ("WLED_BOT_TOKEN в .env выглядит неправильно (ожидается вид "
                "1234567890:AAH...). Скопируй токен от @BotFather целиком, без пробелов.")
    ids = [x.strip() for x in (allowed_users or "").split(",") if x.strip()]
    if any(x in _PLACEHOLDER_IDS for x in ids):
        return ("В .env остался шаблонный ALLOWED_USERS=123456789. "
                "Впиши свой Telegram ID (узнать: @userinfobot).")
    bad = [x for x in ids if not x.lstrip("-").isdigit()]
    if bad:
        return f"ALLOWED_USERS в .env должен содержать только числа через запятую, а там: {', '.join(bad)}"
    return None


def acquire_single_instance_lock(port: int | None = None):
    """Занять «замок» единственного экземпляра.

    Возвращает сокет (держать ссылку до конца работы!) или None, если
    другая копия бота уже запущена. Замок освобождается автоматически,
    когда процесс завершается — даже при падении.
    """
    if port is None:
        port = LOCK_PORT
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):          # Windows: запрет перехвата порта
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        except OSError:
            pass
    try:
        s.bind(("127.0.0.1", port))
        s.listen(1)
    except OSError:
        s.close()
        return None
    return s


class ConflictWatch:
    """Распознать, что этим же токеном пользуется ДРУГАЯ копия бота.

    Telegram отвечает 409 Conflict, когда два процесса одновременно читают
    getUpdates. python-telegram-bot НЕ выбрасывает это наружу из run_polling,
    а бесконечно повторяет запрос — две копии дерутся вечно. Поэтому считаем
    Conflict в скользящем окне: одиночный 409 сразу после перезапуска (старый
    long-poll ещё не истёк) — нормален; серия подряд — значит, жива другая копия.

    Уходит ТОЛЬКО ЧТО запущенная копия (первые `grace` секунд работы): по
    правилам сервера Telegram первый 409 получает как раз давно работающая
    копия — без этого окна запуск бота на втором ПК навсегда глушил бы
    основной (код 3 START.bat не перезапускает).
    """
    def __init__(self, threshold: int = 4, window: float = 90.0,
                 grace: float = 120.0, started: float | None = None):
        self.threshold = threshold
        self.window = window
        self.grace = grace
        self.started = started
        self._hits: list[float] = []
        self.tripped = False

    def hit(self, now: float) -> bool:
        """Отметить один Conflict. True — пора останавливаться (впервые)."""
        if self.started is not None and now - self.started >= self.grace:
            return False          # давно работающая копия не сдаётся
        self._hits = [t for t in self._hits if now - t < self.window] + [now]
        if not self.tripped and len(self._hits) >= self.threshold:
            self.tripped = True
            return True
        return False


def clean_pip_leftovers(dirs: list[str] | None = None) -> list[str]:
    """Удалить папки «~xxx» в site-packages — остатки прерванной установки pip.

    pip сам пишет про них «can be deleted» (жёлтые WARNING). Возвращает список
    удалённых путей. Ошибки доступа молча пропускаются.
    """
    import glob
    import os
    import shutil
    import site
    if dirs is None:
        dirs = []
        try:
            dirs += site.getsitepackages()
        except Exception:
            pass
        try:
            dirs.append(site.getusersitepackages())
        except Exception:
            pass
    removed = []
    for d in dirs:
        for p in glob.glob(os.path.join(d, "~*")):
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
                if not os.path.exists(p):
                    removed.append(p)
    return removed


if __name__ == "__main__":
    import sys
    if "--clean-pip" in sys.argv:
        for p in clean_pip_leftovers():
            print(f"removed leftover: {p}")
