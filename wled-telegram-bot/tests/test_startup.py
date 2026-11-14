#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты запуска: проверка .env, одна копия бота, коды выхода для START.bat."""
import os, sys, tempfile, subprocess, time, shutil
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

import startup_checks as sc

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")

REAL_LIKE = "1122334455:AAFakeTokenForTestsOnly_abcdefghijkl"   # формат как у BotFather, ВЫДУМАННЫЙ


def test_config_problem():
    check("нормальный токен + ID → ок", sc.config_problem(REAL_LIKE, "6194446543") is None)
    check("несколько ID через запятую → ок", sc.config_problem(REAL_LIKE, "1, 22,333") is None)
    check("пустой ALLOWED_USERS → ок (вход по паролю)", sc.config_problem(REAL_LIKE, "") is None)
    check("пустой токен → ошибка", sc.config_problem("", "1") is not None)
    check("ВСТАВЬ_ТОКЕН → ошибка", sc.config_problem("ВСТАВЬ_ТОКЕН_ОТ_BOTFATHER", "1") is not None)
    tpl = "123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    p = sc.config_problem(tpl, "1")
    check("шаблонный токен из .env.example → ошибка про ШАБЛОН", p is not None and "ШАБЛОН" in p)
    check("обрезанный токен → ошибка", sc.config_problem("1122334455:AAFakeToken", "1") is not None)
    check("токен с пробелом внутри → ошибка", sc.config_problem("1122334455:AAFakeTokenFor TestsOnly_abcdefghijk", "1") is not None)
    p = sc.config_problem(REAL_LIKE, "123456789")
    check("шаблонный ALLOWED_USERS → ошибка", p is not None and "ALLOWED_USERS" in p)
    check("ALLOWED_USERS с буквами → ошибка", sc.config_problem(REAL_LIKE, "@me") is not None)


def test_example_env_is_rejected():
    """Ровно тот .env.example, что лежит в архиве, должен давать ошибку настройки."""
    vals = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); vals[k.strip()] = v.strip()
    check(".env.example не проходит проверку (нельзя запустить с шаблоном)",
          sc.config_problem(vals.get("WLED_BOT_TOKEN"), vals.get("ALLOWED_USERS")) is not None)


def test_single_instance_lock():
    port = _free_port()
    a = sc.acquire_single_instance_lock(port)
    check("первая копия получает замок", a is not None)
    b = sc.acquire_single_instance_lock(port)
    check("вторая копия замок НЕ получает", b is None)
    a.close()
    c = sc.acquire_single_instance_lock(port)
    check("после выхода первой копии замок снова свободен", c is not None)
    c.close()


def test_clean_pip_leftovers():
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "~umpy"))
    os.makedirs(os.path.join(d, "numpy"))
    removed = sc.clean_pip_leftovers([d])
    check("остаток ~umpy удалён", not os.path.exists(os.path.join(d, "~umpy")) and len(removed) == 1)
    check("нормальный пакет numpy не тронут", os.path.isdir(os.path.join(d, "numpy")))
    shutil.rmtree(d, ignore_errors=True)


def _run_bot(env_text, extra_env=None, timeout=40, pre=None):
    """Запустить настоящий wled_bot.py в копии проекта, вернуть (код, вывод)."""
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(
        ".env", "__pycache__", "*.db", "*.log", "pc-reports", ".git"))
    (work / ".env").write_text(env_text, encoding="utf-8")
    env = {k: v for k, v in os.environ.items()
           if k not in ("WLED_BOT_TOKEN", "ALLOWED_USERS", "OPENAI_API_KEY", "WLED_IP", "WEB_PORT")}
    env.update({"WEB_PORT": "0", "INTELLECT_WEB_PORT": "0", "PYTHONIOENCODING": "utf-8"})
    env.update(extra_env or {})
    cmd = [sys.executable, "-c", pre, str(work / "wled_bot.py")] if pre else [sys.executable, str(work / "wled_bot.py")]
    try:
        r = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace")
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        # бот не завершился сам (например, вечно дерётся за токен) — это провал, а не краш теста
        out = e.stdout or ""
        if isinstance(out, bytes):
            out = out.decode("utf-8", "replace")
        return None, out + "\n[TIMEOUT: бот не завершился сам]"
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)


ENV_OK = f"WLED_BOT_TOKEN={REAL_LIKE}\nALLOWED_USERS=42\nWLED_IP=127.0.0.1\nOPENAI_API_KEY=\n"

# Подмена Telegram: get_me бросает InvalidToken (как при неверном/отозванном токене)
PRE_INVALID = (
    "import sys, runpy, telegram\n"
    "from telegram.error import InvalidToken\n"
    "async def _bad(self, *a, **k): raise InvalidToken('Unauthorized')\n"
    "telegram.Bot.get_me = _bad\n"
    "import telegram.ext; telegram.ext.ExtBot.get_me = _bad\n"
    "sys.argv = [sys.argv[1]]\n"
    "runpy.run_path(sys.argv[0], run_name='__main__')\n"
)
# Подмена: бот «работает» (держит замок) несколько секунд, потом выходит
PRE_HOLD = (
    "import sys, runpy, time, telegram.ext\n"
    "def _hold(self, *a, **k): time.sleep(8)\n"
    "telegram.ext.Application.run_polling = _hold\n"
    "sys.argv = [sys.argv[1]]\n"
    "runpy.run_path(sys.argv[0], run_name='__main__')\n"
)


def test_bot_exit_codes():
    code, out = _run_bot("WLED_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nALLOWED_USERS=123456789\n")
    check("шаблонный .env → бот выходит с кодом 2", code == 2)
    check("в логе понятное сообщение про шаблон", "ШАБЛОН" in out)

    code, out = _run_bot(ENV_OK, pre=PRE_INVALID)
    check("Telegram отверг токен → код 2 (не бесконечный перезапуск)", code == 2)
    check("в логе сказано про @BotFather", "BotFather" in out)

    # две копии одновременно: первая держит замок, вторая должна выйти с кодом 3
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(
        ".env", "__pycache__", "*.db", "*.log", "pc-reports", ".git"))
    (work / ".env").write_text(ENV_OK, encoding="utf-8")
    env = dict(os.environ, WEB_PORT="0", INTELLECT_WEB_PORT="0", PYTHONIOENCODING="utf-8")
    first = subprocess.Popen([sys.executable, "-c", PRE_HOLD, str(work / "wled_bot.py")],
                             cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace")
    try:
        # ждём, пока первая копия займёт замок
        deadline = time.time() + 25
        while time.time() < deadline and sc.acquire_single_instance_lock() is not None:
            time.sleep(0.3)
        second = subprocess.run([sys.executable, str(work / "wled_bot.py")], cwd=work, env=env,
                                capture_output=True, text=True, timeout=40,
                                encoding="utf-8", errors="replace")
        check("вторая копия бота → код 3", second.returncode == 3)
        check("в логе «уже запущен»", "уже запущен" in (second.stdout + second.stderr))
    finally:
        first.kill(); first.wait()
        shutil.rmtree(work.parent, ignore_errors=True)


def test_env_with_bom_and_cp1251():
    """Блокнот может сохранить .env с BOM — токен всё равно читается."""
    code, out = _run_bot("﻿" + "WLED_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nALLOWED_USERS=1\n")
    check(".env с BOM: ключ в первой строке прочитан (шаблон распознан, код 2)", code == 2 and "ШАБЛОН" in out)
    work_env = "# Комментарий по-русски\nWLED_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n".encode("cp1251")
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".env", "__pycache__", "*.db", "*.log", ".git"))
    (work / ".env").write_bytes(work_env)
    env = {k: v for k, v in os.environ.items() if k not in ("WLED_BOT_TOKEN", "ALLOWED_USERS")}
    env.update(WEB_PORT="0", INTELLECT_WEB_PORT="0", PYTHONIOENCODING="utf-8")
    r = subprocess.run([sys.executable, str(work / "wled_bot.py")], cwd=work, env=env,
                       capture_output=True, text=True, timeout=40, encoding="utf-8", errors="replace")
    check(".env в ANSI/cp1251: бот не падает с UnicodeDecodeError", "UnicodeDecodeError" not in (r.stdout + r.stderr) and r.returncode == 2)
    shutil.rmtree(work.parent, ignore_errors=True)


def test_conflict_watch():
    w = sc.ConflictWatch(threshold=4, window=90)
    check("1 Conflict — не повод останавливаться", w.hit(0) is False)
    check("2-й и 3-й — ещё нет", w.hit(5) is False and w.hit(10) is False)
    check("4-й подряд в окне 90 с — стоп", w.hit(15) is True)
    check("стоп срабатывает один раз", w.hit(16) is False and w.tripped)
    w2 = sc.ConflictWatch(threshold=4, window=90)
    for t in (0, 100, 200, 300):
        w2.hit(t)
    check("редкие одиночные Conflict (раз в 100 с) — не стоп", not w2.tripped)
    # давно работающая копия (запущена 10 минут назад) не сдаётся новичку
    old = sc.ConflictWatch(started=0, grace=120)
    stops = [old.hit(t) for t in (600, 603, 606, 609, 612, 615)]
    check("давно работающая копия НЕ останавливается из-за новичка", not any(stops) and not old.tripped)
    new = sc.ConflictWatch(started=600, grace=120)
    stops = [new.hit(t) for t in (601, 604, 607, 610)]
    check("только что запущенная копия — останавливается", stops[-1] is True)


# Подмена сети Telegram: getMe ок, getUpdates → 409 (MODE=conflict) или 1×409 потом пусто (single)
PRE_FAKE_TG = (
    "import sys, os, json, asyncio, runpy\n"
    "import telegram.request._httpxrequest as hx\n"
    "MODE = os.environ['FAKE_TG']; n = {'gu': 0}\n"
    "async def fake(self, url, method, request_data=None, read_timeout=None, write_timeout=None, connect_timeout=None, pool_timeout=None):\n"
    "    m = url.rsplit('/', 1)[-1]\n"
    "    if m == 'getMe':\n"
    "        return 200, json.dumps({'ok': True, 'result': {'id': 1, 'is_bot': True, 'first_name': 'x', 'username': 'x_bot'}}).encode()\n"
    "    if m == 'getUpdates':\n"
    "        n['gu'] += 1\n"
    "        if MODE == 'conflict' or (MODE == 'single' and n['gu'] == 1):\n"
    "            return 409, json.dumps({'ok': False, 'error_code': 409, 'description': 'Conflict: terminated by other getUpdates request'}).encode()\n"
    "        await asyncio.sleep(1)\n"
    "        return 200, json.dumps({'ok': True, 'result': []}).encode()\n"
    "    return 200, json.dumps({'ok': True, 'result': True}).encode()\n"
    "hx.HTTPXRequest.do_request = fake\n"
    "sys.argv = [sys.argv[1]]\n"
    "runpy.run_path(sys.argv[0], run_name='__main__')\n"
)


def test_second_copy_via_telegram_conflict():
    """Старая копия (без замка) держит токен → Telegram шлёт 409 → новая копия
    должна сама остановиться с кодом 3, а не драться вечно."""
    code, out = _run_bot(ENV_OK, extra_env={"FAKE_TG": "conflict"}, pre=PRE_FAKE_TG, timeout=150)
    check("постоянный Conflict → бот выходит с кодом 3", code == 3)
    check("в логе: «ДРУГАЯ копия … закрой её»", "ДРУГАЯ копия" in out)

    # одиночный 409 сразу после перезапуска — нормален, бот должен работать дальше
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(
        ".env", "__pycache__", "*.db", "*.log", "pc-reports", ".git"))
    (work / ".env").write_text(ENV_OK, encoding="utf-8")
    env = dict(os.environ, WEB_PORT="0", INTELLECT_WEB_PORT="0", PYTHONIOENCODING="utf-8", FAKE_TG="single")
    pr = subprocess.Popen([sys.executable, "-c", PRE_FAKE_TG, str(work / "wled_bot.py")], cwd=work, env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    try:
        time.sleep(25)
        alive = pr.poll() is None
    finally:
        pr.kill(); out2 = pr.communicate()[0]
        shutil.rmtree(work.parent, ignore_errors=True)
    check("одиночный Conflict → бот продолжает работать", alive)
    check("…и не пишет «ДРУГАЯ копия»", "ДРУГАЯ копия" not in out2)


PRE_LAMP_MOVED = (
    "import sys, os\n"
    "sys.path.insert(0, os.path.dirname(sys.argv[1]))\n"
    "import find_lamp\n"
    "find_lamp.discover = lambda *a, **k: [{'ip': '192.168.1.110', 'name': 'Lamp'}]\n"
    "import wled_bot\n"
    "wled_bot._lamp_reachable = lambda ip, *a, **k: ip == '192.168.1.110'\n"
    "import telegram.ext\n"
    "def _run(self, *a, **k):\n"
    "    print('CORE_IP=' + str(wled_bot.INTELLECT.wled.ip if wled_bot.INTELLECT else None), flush=True)\n"
    "telegram.ext.Application.run_polling = _run\n"
    "wled_bot.main()\n"
)


def test_lamp_new_ip_reaches_ai_core():
    """В .env старый IP (.106), лампа переехала на .110: автопоиск находит её,
    и ядро ИИ (свободные фразы/голос/автоматизации) тоже шлёт на .110."""
    env = f"WLED_BOT_TOKEN={REAL_LIKE}\nALLOWED_USERS=42\nWLED_IP=192.168.1.106\nOPENAI_API_KEY=sk-test-fake\n"
    code, out = _run_bot(env, pre=PRE_LAMP_MOVED, timeout=90)
    check("автопоиск нашёл лампу на .110", "192.168.1.110" in out and "Лампа найдена" in out)
    check("ядро ИИ использует новый IP .110 (а не старый .106)", "CORE_IP=192.168.1.110" in out)


if __name__ == "__main__":
    print("=== Запуск: проверки .env, одна копия, коды выхода ===")
    for t in (test_config_problem, test_example_env_is_rejected, test_single_instance_lock,
              test_clean_pip_leftovers, test_bot_exit_codes, test_env_with_bom_and_cp1251,
              test_conflict_watch, test_second_copy_via_telegram_conflict,
              test_lamp_new_ip_reaches_ai_core):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
