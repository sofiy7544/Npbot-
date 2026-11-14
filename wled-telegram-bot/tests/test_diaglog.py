#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты журналов logs\\: скрытие секретов, crash.log, diag.txt, bot.log."""
import os, sys, io, logging, tempfile, shutil, subprocess, threading
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

def _free_port():
    import socket as _s
    with _s.socket() as t:
        t.bind(("127.0.0.1", 0))
        return t.getsockname()[1]
# свой порт-«замок» на каждый прогон: параллельные прогоны/копии бота не мешают друг другу
os.environ["INTELLECT_LOCK_PORT"] = str(_free_port())

import diaglog

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")

TOKEN = "1122334455:AAFakeTokenForTestsOnly_abcdefghijkl"      # формат BotFather, ВЫДУМАННЫЙ
OAI = "sk-proj-FAKEkeyForTestsOnly0123456789abcdefghijklmnopqrstuvwxyzABCD"


def test_redact():
    r = diaglog.redact(f"token={TOKEN} key={OAI}")
    check("токен скрыт", TOKEN not in r and "AAFakeToken" not in r)
    check("ключ OpenAI скрыт", "FAKEkeyFor" not in r and "sk-***" in r)
    url = f"POST https://api.telegram.org/bot{TOKEN}/getUpdates"
    check("токен внутри URL …/bot<токен>/… тоже скрыт", "AAFakeToken" not in diaglog.redact(url))
    plain = "Лампа 192.168.1.110, ID 6194446543, порт 8090"
    check("обычные числа/IP/ID не трогаются", diaglog.redact(plain) == plain)
    os.environ["WLED_BOT_TOKEN"] = "weird-format-secret-value-123"
    check("точное значение из .env скрыто даже в нестандартном виде",
          "weird-format-secret" not in diaglog.redact("x weird-format-secret-value-123 y"))
    os.environ.pop("WLED_BOT_TOKEN")


def test_formatter_hides_in_traceback():
    buf = io.StringIO()
    h = logging.StreamHandler(buf); h.setFormatter(diaglog.RedactingFormatter("%(message)s"))
    lg = logging.getLogger("t-redact"); lg.handlers = [h]; lg.propagate = False
    try:
        raise RuntimeError(f"connect failed https://api.telegram.org/bot{TOKEN}/getMe")
    except RuntimeError:
        lg.exception(f"ошибка, ключ {OAI}")
    out = buf.getvalue()
    check("в сообщении журнала секретов нет", "FAKEkeyFor" not in out)
    check("в traceback журнала токена нет", "AAFakeToken" not in out and "RuntimeError" in out)


def _copy_project():
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(
        ".env", "__pycache__", "*.db", "*.log", "logs", "pc-reports", ".git"))
    return work


def _env(**extra):
    env = {k: v for k, v in os.environ.items()
           if k not in ("WLED_BOT_TOKEN", "ALLOWED_USERS", "OPENAI_API_KEY", "WLED_IP")}
    env.update(WEB_PORT="0", INTELLECT_WEB_PORT="0", PYTHONIOENCODING="utf-8")
    env.update(extra)
    return env


def test_crash_before_libraries_is_logged():
    """Библиотека не установилась → бот падает на импорте → это есть в logs\\crash.log."""
    work = _copy_project()
    try:
        (work / ".env").write_text(f"WLED_BOT_TOKEN={TOKEN}\nALLOWED_USERS=42\n", encoding="utf-8")
        (work / "httpx.py").write_text("raise ImportError('No module named httpx (имитация)')\n", encoding="utf-8")
        r = subprocess.run([sys.executable, str(work / "wled_bot.py")], cwd=work, env=_env(),
                           capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        crash = work / "logs" / "crash.log"
        text = crash.read_text(encoding="utf-8") if crash.exists() else ""
        check("бот упал (код ≠ 0)", r.returncode != 0)
        check("logs\\crash.log создан", crash.exists())
        check("в crash.log есть ImportError и имя скрипта", "ImportError" in text and "wled_bot.py" in text)
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)


def test_thread_crash_is_logged():
    work = Path(tempfile.mkdtemp())
    code = ("import sys, threading; sys.path.insert(0, %r)\n"
            "import diaglog; diaglog.LOG_DIR = %r; diaglog.install_crash_logging()\n"
            "t = threading.Thread(target=lambda: 1/0, name='automation'); t.start(); t.join()\n") % (
            str(ROOT), str(work / "logs"))
    subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=30)
    p = work / "logs" / "crash.log"
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    check("падение в фоновом потоке попало в crash.log", "ZeroDivisionError" in text and "automation" in text)
    shutil.rmtree(work, ignore_errors=True)


def test_diag_on_bad_config():
    """Шаблонный .env → выход с кодом 2, но diag.txt уже записан и объясняет причину."""
    work = _copy_project()
    try:
        (work / ".env").write_text("WLED_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n"
                                   "ALLOWED_USERS=123456789\n", encoding="utf-8")
        r = subprocess.run([sys.executable, str(work / "wled_bot.py")], cwd=work, env=_env(),
                           capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        d = work / "logs" / "diag.txt"
        text = d.read_text(encoding="utf-8") if d.exists() else ""
        check("код выхода 2", r.returncode == 2)
        check("diag.txt создан", d.exists())
        check("в diag.txt причина: шаблонный токен", "ШАБЛОН" in text)
        check("в diag.txt версии библиотек", "python-telegram-bot:" in text and "httpx:" in text)
        b = work / "logs" / "bot.log"
        check("журнал бота теперь в logs\\bot.log", b.exists() and "ШАБЛОН" in b.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)


PRE_RUN = (
    "import sys, os\n"
    "sys.path.insert(0, os.path.dirname(sys.argv[1]))\n"
    "import find_lamp\n"
    "find_lamp.discover = lambda *a, **k: [{'ip': '192.168.1.110', 'name': 'Lamp'}]\n"
    "import wled_bot, logging\n"
    "wled_bot._lamp_reachable = lambda ip, *a, **k: ip == '192.168.1.110'\n"
    "import telegram.ext\n"
    "def _run(self, *a, **k):\n"
    "    logging.getLogger('wled-bot').error('сеть: https://api.telegram.org/bot%s/getUpdates упало' % os.environ['WLED_BOT_TOKEN'])\n"
    "telegram.ext.Application.run_polling = _run\n"
    "wled_bot.main()\n"
)


def test_full_start_logs_without_secrets():
    """Нормальный старт: diag.txt полный, и НИ в одном файле logs\\ нет токена и ключа."""
    work = _copy_project()
    try:
        (work / ".env").write_text(f"WLED_BOT_TOKEN={TOKEN}\nALLOWED_USERS=42\nWLED_IP=192.168.1.106\n"
                                   f"OPENAI_API_KEY={OAI}\n", encoding="utf-8")
        r = subprocess.run([sys.executable, "-c", PRE_RUN, str(work / "wled_bot.py")], cwd=work, env=_env(),
                           capture_output=True, text=True, timeout=90, encoding="utf-8", errors="replace")
        d = (work / "logs" / "diag.txt").read_text(encoding="utf-8")
        check("diag: старт дошёл до Telegram", "до подключения к Telegram дошли" in d)
        check("diag: лампа .110 отвечает, ядро на .110", "192.168.1.110 (отвечает)" in d and "Ядро: IP лампы: 192.168.1.110" in d)
        check("diag: ключ OpenAI показан только маской", "OPENAI_API_KEY = задан (sk-…" in d)
        leaked = []
        for f in (work / "logs").iterdir():
            t = f.read_text(encoding="utf-8", errors="replace")
            if "AAFakeToken" in t or "FAKEkeyFor" in t:
                leaked.append(f.name)
        check(f"ни в одном файле logs\\ нет токена/ключа (проверено: "
              f"{', '.join(sorted(p.name for p in (work / 'logs').iterdir()))})", not leaked)
        check("в консоли тоже без токена", "AAFakeToken" not in (r.stdout + r.stderr))
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)


def test_report_zip():
    """REPORT.bat → diaglog.py --report: журналы (даже открытые ботом) в zip, секреты скрыты,
    .env и база переписки не попадают."""
    import zipfile
    work = _copy_project()
    try:
        weird = "custom-secret-token-value-XYZ"
        (work / ".env").write_text(f"WLED_BOT_TOKEN={TOKEN}\nOPENAI_API_KEY={OAI}\nACCESS_PASSWORD=5750\n"
                                   f"ANTHROPIC_API_KEY={weird}\n", encoding="utf-8")
        (work / "logs").mkdir(exist_ok=True)
        (work / "logs" / "bot.log").write_text("ok line\n", encoding="utf-8")
        (work / "logs" / "crash.log").write_text("Traceback ... ImportError\n", encoding="utf-8")
        # старый журнал ранних версий в корне — с токеном в URL и «нестандартным» секретом
        (work / "wled-bot.log").write_text(f"HTTP Request: POST https://api.telegram.org/bot{TOKEN}/getUpdates\n"
                                           f"key {OAI} other {weird}\n", encoding="utf-8")
        (work / "intellect.db").write_bytes(b"SQLite format 3\x00 private chat")
        # bot.log держит открытым «работающий бот» (на Windows Compress-Archive такие пропускал)
        holder = open(work / "logs" / "bot.log", "a", encoding="utf-8")
        holder.write("line written by running bot\n"); holder.flush()
        env = _env(); env.pop("ANTHROPIC_API_KEY", None)
        r = subprocess.run([sys.executable, str(work / "diaglog.py"), "--report"], cwd=work, env=env,
                           capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        holder.close()
        zp = work / "intellect-report.zip"
        check("отчёт собран (код 0, есть zip)", r.returncode == 0 and zp.exists())
        names = zipfile.ZipFile(zp).namelist() if zp.exists() else []
        check("открытый ботом logs/bot.log внутри", "logs/bot.log" in names)
        check("crash.log и старый wled-bot.log внутри", "logs/crash.log" in names and "wled-bot.log" in names)
        check(".env и база переписки НЕ внутри", ".env" not in names and not any(n.endswith(".db") for n in names))
        blob = b"".join(zipfile.ZipFile(zp).read(n) for n in names).decode("utf-8", "replace") if names else ""
        check("в отчёте нет токена/ключа даже из старого журнала",
              "AAFakeToken" not in blob and "FAKEkeyFor" not in blob)
        check("нестандартный секрет из .env тоже скрыт", weird not in blob)
        check("строка работающего бота попала в отчёт", "line written by running bot" in blob)
        # пустая папка → честное «нечего паковать», код 1
        empty = Path(tempfile.mkdtemp())
        shutil.copy(work / "diaglog.py", empty / "diaglog.py")
        r2 = subprocess.run([sys.executable, str(empty / "diaglog.py"), "--report"], cwd=empty, env=env,
                            capture_output=True, text=True, timeout=30)
        check("нет журналов → код 1 и «Nothing to pack», без пустого zip",
              r2.returncode == 1 and "Nothing to pack" in r2.stdout and not (empty / "intellect-report.zip").exists())
        shutil.rmtree(empty, ignore_errors=True)
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)


if __name__ == "__main__":
    print("=== Журналы logs\\: секреты, crash.log, diag.txt ===")
    for t in (test_redact, test_formatter_hides_in_traceback, test_crash_before_libraries_is_logged,
              test_thread_crash_is_logged, test_diag_on_bad_config, test_full_start_logs_without_secrets,
              test_report_zip):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
