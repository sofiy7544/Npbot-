#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diaglog.py — журналы INTELLECT в папке logs\\ (её удобно прислать для разбора).

  logs\\bot.log    — журнал бота (ротация: 1 МБ × 3 файла)
  logs\\start.log  — что делал START.bat: Python, установка, .env, автозапуск,
                    каждый запуск/остановка бота с кодом (пишет сам START.bat)
  logs\\pip.log    — подробности установки библиотек (пишет pip)
  logs\\crash.log  — падения Python, в т.ч. ДО запуска журнала (например, не
                    поставилась библиотека) и в фоновых потоках
  logs\\diag.txt   — снимок при каждом старте: версии, настройки (без секретов),
                    лампа, автозапуск, память/диск

Токен бота и ключ OpenAI во ВСЕХ журналах заменяются на ***: журналы можно
спокойно пересылать. Модуль использует только стандартную библиотеку, чтобы
его можно было подключить раньше сторонних (httpx, telegram).
"""
from __future__ import annotations

import logging
import os
import platform
import re
import sys
import threading
import time
import traceback

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "logs")

# Токен BotFather, в том числе внутри URL вида .../bot<токен>/getUpdates
_TOKEN_RE = re.compile(r"(?<![0-9])(\d{5,}):[A-Za-z0-9_-]{30,}")
_OPENAI_RE = re.compile(r"sk-[A-Za-z0-9_-]{16,}")
# Токен телевизора Samsung: «New token 12345678», «…&token=12345678», {'token': '12345678'}
_TV_TOKEN_RE = re.compile(r"(?i)(\btoken\b(?: to file)?[\"']?\s*[:=]?\s*[\"']?)\d{6,}")
_SECRET_ENV = ("WLED_BOT_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")


def redact(text: str) -> str:
    """Спрятать токен бота и API-ключи в тексте."""
    if not text:
        return text
    text = _TOKEN_RE.sub(lambda m: f"{m.group(1)[:4]}…:***", text)
    text = _OPENAI_RE.sub("sk-***", text)
    text = _TV_TOKEN_RE.sub(r"\1***", text)
    for k in _SECRET_ENV:                      # точные значения — на случай нестандартного вида
        v = os.environ.get(k, "")
        if len(v) >= 8 and v in text:
            text = text.replace(v, "***")
    return text


class RedactingFormatter(logging.Formatter):
    """Форматтер журнала, который прячет секреты и в сообщении, и в traceback."""
    def format(self, record):
        return redact(super().format(record))


def ensure_dir() -> str:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except OSError:
        pass
    return LOG_DIR


def _cap(path: str, limit: int) -> None:
    """Не давать файлу расти бесконечно: большой → *.old (одна старая копия)."""
    try:
        if os.path.getsize(path) > limit:
            old = path + ".old"
            if os.path.exists(old):
                os.remove(old)
            os.replace(path, old)
    except OSError:
        pass


def _write_crash(path: str, title: str, et, ev, tb) -> None:
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} | {title} =====\n")
            f.write(redact("".join(traceback.format_exception(et, ev, tb))))
    except Exception:
        pass


_crash_file = None   # открыт до конца процесса (нужен faulthandler)


def install_crash_logging() -> str | None:
    """Писать любые необработанные ошибки в logs\\crash.log."""
    global _crash_file
    try:
        path = os.path.join(ensure_dir(), "crash.log")
        _cap(path, 500_000)
        script = os.path.basename(sys.argv[0] or "?")
        prev = sys.excepthook

        def _hook(et, ev, tb):
            if not issubclass(et, KeyboardInterrupt):     # Ctrl+C — не падение
                _write_crash(path, script, et, ev, tb)
            prev(et, ev, tb)
        sys.excepthook = _hook

        prev_t = threading.excepthook

        def _thook(args):
            _write_crash(path, f"{script} / поток {getattr(args.thread, 'name', '?')}",
                         args.exc_type, args.exc_value, args.exc_traceback)
            prev_t(args)
        threading.excepthook = _thook

        import faulthandler                              # «жёсткие» падения интерпретатора
        _crash_file = open(path, "a", encoding="utf-8")
        faulthandler.enable(file=_crash_file)
        return path
    except Exception:
        return None


def _mask(key: str, val: str | None) -> str:
    if val is None or val == "":
        return "(не задано)"
    if key == "WLED_BOT_TOKEN":
        ok = bool(re.match(r"^\d{5,}:[A-Za-z0-9_-]{30,}$", val))
        return f"задан ({val.split(':')[0][:4]}…, формат {'ок' if ok else 'НЕВЕРНЫЙ'})"
    if key.endswith("_API_KEY"):
        return f"задан ({val[:3]}…, длина {len(val)})"
    if key == "ACCESS_PASSWORD":
        return "задан"
    return val


_ENV_KEYS = ("WLED_BOT_TOKEN", "ALLOWED_USERS", "WLED_IP", "OPENAI_API_KEY", "AI_MODEL",
             "WEB_PORT", "INTELLECT_WEB_PORT", "SAMSUNG_TV_IP", "ACCESS_PASSWORD")
_PACKAGES = ("python-telegram-bot", "httpx", "openai", "numpy", "psutil", "samsungtvws")


def _load_env_for_redaction() -> None:
    """Подхватить значения из .env в окружение — чтобы redact() знал точные
    секреты, даже когда отчёт собирается отдельным процессом (REPORT.bat)."""
    path = os.path.join(ROOT, ".env")
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


def make_report(out_name: str = "intellect-report.zip") -> tuple[str | None, list[str]]:
    """Собрать журналы + отчёт о ПК в один zip для разбора.

    • Читает файлы обычным open('rb') — на Windows так можно прочитать и те,
      что запущенный бот держит открытыми (bot.log, crash.log). Стандартный
      Compress-Archive их пропускал, но писал «готово».
    • Каждый файл ещё раз проходит через redact(): токен и ключи не попадут
      в отчёт даже из старых журналов ранних версий.
    • .env и база с перепиской в отчёт НЕ входят.
    """
    import glob
    import zipfile
    _load_env_for_redaction()
    rels = []
    for pattern in ("logs/*", "wled-bot.log*", "setup/pc-reports/*"):
        for p in sorted(glob.glob(os.path.join(ROOT, pattern))):
            if os.path.isfile(p):
                rels.append(os.path.relpath(p, ROOT))
    if not rels:
        return None, []
    out = os.path.join(ROOT, out_name)
    packed = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in rels:
            try:
                with open(os.path.join(ROOT, rel), "rb") as f:
                    data = f.read()
            except OSError:
                continue
            text = redact(data.decode("utf-8", errors="replace"))
            z.writestr(rel.replace(os.sep, "/"), text.encode("utf-8"))
            packed.append(rel)
    return out, packed


def version() -> str:
    """Номер сборки из файла VERSION (его ставит каждый архив)."""
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.readline().strip() or "?"
    except OSError:
        return "? (нет файла VERSION)"


def write_diag(extra: dict | None = None) -> str | None:
    """Снимок окружения в logs\\diag.txt (перезаписывается при каждом старте)."""
    L = []
    add = L.append
    add(f"INTELLECT — диагностика запуска, {time.strftime('%Y-%m-%d %H:%M:%S')}")
    add(f"Версия: {version()}")
    add(f"Папка: {ROOT}")
    add(f"Python: {sys.version.split()[0]}  ({sys.executable})")
    add(f"ОС: {platform.platform()}")
    add("Библиотеки:")
    try:
        from importlib import metadata as md
        for p in _PACKAGES:
            try:
                v = md.version(p)
            except Exception:
                v = "НЕ УСТАНОВЛЕНА"
            add(f"  {p}: {v}")
    except Exception as e:
        add(f"  (не удалось проверить: {e!r})")
    add("Настройки .env (секреты скрыты):")
    if not os.path.exists(os.path.join(ROOT, ".env")):
        add("  ФАЙЛА .env НЕТ")
    for k in _ENV_KEYS:
        add(f"  {k} = {_mask(k, os.environ.get(k))}")
    if os.name == "nt":
        st = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows",
                          "Start Menu", "Programs", "Startup", "INTELLECT.lnk")
        add(f"Автозапуск (ярлык INTELLECT.lnk в Автозагрузке): {'есть' if os.path.exists(st) else 'НЕТ'}")
    try:
        import psutil
        vm = psutil.virtual_memory()
        du = psutil.disk_usage(ROOT)
        add(f"Память: свободно {vm.available // 2**20} МБ из {vm.total // 2**20} МБ")
        add(f"Диск: свободно {du.free // 2**30} ГБ")
    except Exception:
        pass
    for k, v in (extra or {}).items():
        add(f"{k}: {v}")
    try:
        path = os.path.join(ensure_dir(), "diag.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(redact("\n".join(L)) + "\n")
        return path
    except Exception:
        return None


if __name__ == "__main__":
    # REPORT.bat:  py diaglog.py --report  → intellect-report.zip рядом с ботом
    if "--report" in sys.argv:
        path, files = make_report()
        if not path:
            print("[!] Nothing to pack yet - run START.bat at least once.")
            sys.exit(1)
        for rel in files:
            print(f"    + {rel}")
        print(f"[OK] Ready:  {os.path.basename(path)}  ({len(files)} files)")
        sys.exit(0)
