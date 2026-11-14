#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 8 (Computer): диагностика + безопасность управления."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.computer import collect, quick_summary, ComputerControl, SafetyError
from intellect.computer.tools import register_computer_tools
from intellect.ai import ToolRegistry, Brain, ModelRouter, FakeProvider
from intellect.core.interfaces import ToolCall

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def test_info_collect():
    d = collect()
    check("есть host", bool(d.get("host")))
    check("есть disks", isinstance(d.get("disks"), dict) and len(d["disks"]) >= 1)
    check("quick_summary строка", isinstance(quick_summary(), str) and len(quick_summary()) > 0)


def test_launch_whitelist():
    ctl = ComputerControl(allowed_apps={"notepad": "notepad.exe"})
    try:
        ctl.launch("cmd")       # не в белом списке
        check("незарешённый запуск заблокирован", False)
    except SafetyError:
        check("незарешённый запуск заблокирован", True)


def test_kill_whitelist():
    ctl = ComputerControl(killable={"somegame"})
    try:
        ctl.kill("explorer")    # не разрешён
        check("незарешённый kill заблокирован", False)
    except SafetyError:
        check("незарешённый kill заблокирован", True)


def test_dangerous_tools_need_confirmation():
    ctl = ComputerControl()
    reg = ToolRegistry()
    register_computer_tools(reg, ctl)
    t = reg.get("computer_shutdown")
    check("shutdown помечен опасным", t is not None and t.dangerous)
    check("status не опасный", reg.get("computer_status").dangerous is False)

    # мозг просит выключить ПК — без подтверждения НЕ исполняется
    fired = {"n": 0}
    reg2 = ToolRegistry()
    reg2.add("computer_shutdown", "выкл", {"type": "object", "properties": {}},
             lambda a: fired.__setitem__("n", fired["n"] + 1) or {"message": "выключаю"},
             dangerous=True)
    prov = FakeProvider(scripted=lambda m: {"text": "",
        "tool_calls": [ToolCall("computer_shutdown", {})]})
    brain = Brain(prov, ModelRouter("f", "s"), reg2, confirm=lambda n: False)
    r = brain.understand("выключи компьютер")
    check("выключение без подтверждения не выполнено", fired["n"] == 0)
    check("запрошено подтверждение", "computer_shutdown" in r.pending_confirmation)


class FakeWindowsShutdown:
    """Имитация shutdown.exe по правилам Windows:
    /s|/r при уже запланированном → 1190; /a когда нечего отменять → 1116."""
    def __init__(self):
        self.calls, self.scheduled, self.fail_code = [], None, 0

    def run(self, args, check=False, **kw):
        self.calls.append(list(args))
        flag = args[1]
        rc = 0
        if self.fail_code and flag in ("/s", "/r"):
            rc = self.fail_code
        elif flag in ("/s", "/r"):
            if self.scheduled:
                rc = 1190
            else:
                self.scheduled = ("restart" if flag == "/r" else "shutdown", int(args[3]))
        elif flag == "/a":
            if self.scheduled:
                self.scheduled = None
            else:
                rc = 1116
        return type("R", (), {"returncode": rc})()


def _as_windows(fake):
    """Подменить в control.py subprocess и os.name='nt' (тест НЕ выключает машину)."""
    import types
    import intellect.computer.control as ctlmod
    orig_sp, orig_os = ctlmod.subprocess, ctlmod.os
    ctlmod.subprocess = types.SimpleNamespace(run=fake.run)
    ctlmod.os = types.SimpleNamespace(name="nt", path=orig_os.path, environ=orig_os.environ)
    def restore():
        ctlmod.subprocess, ctlmod.os = orig_sp, orig_os
    return restore


def test_power_delay_and_cancel():
    """Задержка 0 → минимум 20 с; смена таймера реально меняет его в Windows; отмена честная."""
    win = FakeWindowsShutdown()
    restore = _as_windows(win)
    try:
        ctl = ComputerControl()
        r = ctl.restart(0)
        check("задержка 0 поднята до минимума 20 с", r["ok"] and "20 с" in r["message"])
        check("Windows получил /r /t 20", win.scheduled == ("restart", 20))
        check("перезагрузка помечена как запланированная", ctl.power_pending() == "restart")
        r = ctl.shutdown(600)
        r = ctl.shutdown(1800)
        check("смена таймера 600 → 1800: в Windows реально 1800 (а не старые 600)",
              win.scheduled == ("shutdown", 1800) and "1800 с" in r["message"])
        r = ctl.restart("abc")
        check("мусор вместо числа → 30 с", win.scheduled == ("restart", 30) and "30 с" in r["message"])
        r = ctl.cancel_shutdown()
        check("отмена: Windows больше ничего не ждёт", win.scheduled is None)
        check("сообщение «Перезагрузка отменена»", "Перезагрузка отменена" in r["message"])
        check("после отмены ничего не запланировано", ctl.power_pending() is None)
        r = ctl.cancel_shutdown()
        check("повторная отмена → «отменять нечего» (код 1116)", r.get("nothing") and "нечего" in r["message"])
        r = ctl.shutdown(99999)
        check("огромная задержка обрезана до 3600 с", win.scheduled == ("shutdown", 3600))
        check("в сообщении есть подсказка /cancel", "/cancel" in r["message"])
        check("род: «Выключение отменено»", "Выключение отменено" in ctl.cancel_shutdown()["message"])
        win.fail_code = 5
        r = ctl.shutdown(60)
        check("Windows отказал → бот НЕ врёт «через 60 с»", not r["ok"] and "Не получилось" in r["message"])
        check("…и не считает выключение запланированным", ctl.power_pending() is None)
    finally:
        restore()


def _app_with_script(next_calls):
    import os, tempfile
    os.environ["OPENAI_API_KEY"] = "sk-test-fake"
    os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "c.db")
    os.environ["ALLOWED_USERS"] = "42"
    from intellect.config import load_settings
    from intellect.db.database import Database
    from intellect.app import IntellectApp
    st = load_settings()
    app = IntellectApp(st, db=Database(st.db_path))
    fp = FakeProvider(scripted=lambda m: {"text": "", "tool_calls": [next_calls[0]]})
    app.provider = fp
    app.brain = Brain(fp, app.router, app.registry, confirm=app._confirm_current)
    return app


def test_cancel_after_confirm_aborts_restart():
    """Сценарий со скриншота: «Перегрузи» → Подтвердить → передумал."""
    win = FakeWindowsShutdown()
    restore = _as_windows(win)
    try:
        nxt = [ToolCall("computer_restart", {"delay_sec": 0})]
        app = _app_with_script(nxt)
        out = app.handle_text(42, "перегрузи")
        check("сначала просит подтверждение", "computer_restart" in out["pending_confirmation"])
        check("до подтверждения Windows ничего не получил", win.scheduled is None)
        out = app.confirm_pending(42)
        check("после подтверждения перезагрузка запланирована", win.scheduled == ("restart", 20))
        check("задержка не 0 (есть шанс отменить)", "через 0 с" not in out["reply"])
        out = app.cancel_pending(42, power=True)
        check("/cancel реально прерывает перезагрузку", win.scheduled is None)
        check("ответ честный: перезагрузка отменена", "Перезагрузка отменена" in out["reply"])
        out = app.cancel_pending(42, power=True)
        check("повторный /cancel → «отменять нечего»", "нечего" in out["reply"])
        app.handle_text(42, "перегрузи")
        out = app.cancel_pending(42)
        check("кнопка «Отмена» ДО подтверждения → «ничего не выполнял»", "ничего не выполнял" in out["reply"])
        check("…и Windows ничего не получил", win.scheduled is None)
    finally:
        restore()


def test_cancel_survives_bot_restart():
    """Выключение через час подтверждено → бот перезапустился → /cancel всё равно отменяет."""
    win = FakeWindowsShutdown()
    restore = _as_windows(win)
    try:
        nxt = [ToolCall("computer_shutdown", {"delay_sec": 3600})]
        app1 = _app_with_script(nxt)
        app1.handle_text(42, "выключи комп через час")
        app1.confirm_pending(42)
        check("выключение через час запланировано", win.scheduled == ("shutdown", 3600))
        app2 = _app_with_script(nxt)          # «перезапуск бота»: память пустая
        check("новая копия бота ничего не помнит", app2.computer.power_pending() is None)
        out = app2.cancel_pending(42, power=True)
        check("/cancel после перезапуска бота всё равно отменил в Windows", win.scheduled is None)
        check("ответ: отменено", "отмен" in out["reply"].lower() and "нечего" not in out["reply"])
    finally:
        restore()


def test_button_cancel_keeps_confirmed_timer():
    """Таймер сна подтверждён; на НОВЫЙ вопрос нажали «Отмена» → таймер остаётся."""
    win = FakeWindowsShutdown()
    restore = _as_windows(win)
    try:
        nxt = [ToolCall("computer_shutdown", {"delay_sec": 3600})]
        app = _app_with_script(nxt)
        app.handle_text(42, "выключи комп через час")
        app.confirm_pending(42)
        nxt[0] = ToolCall("computer_restart", {"delay_sec": 30})
        out = app.handle_text(42, "перегрузи")
        check("новый вопрос про перезагрузку", "computer_restart" in out["pending_confirmation"])
        out = app.cancel_pending(42)          # кнопка ❌ под НОВЫМ вопросом
        check("таймер сна на час остался в Windows", win.scheduled == ("shutdown", 3600))
        check("ответ подсказывает /cancel для таймера", "/cancel" in out["reply"] and "в силе" in out["reply"])
        out = app.cancel_pending(42)          # старая кнопка без активного вопроса
        check("старая кнопка «Отмена» тоже не трогает таймер", win.scheduled == ("shutdown", 3600))
        check("…и честно говорит, что вопрос неактуален", "неактуален" in out["reply"])
    finally:
        restore()


if __name__ == "__main__":
    print("=== ЭТАП 8: тесты Computer Control ===")
    for t in (test_info_collect, test_launch_whitelist, test_kill_whitelist,
              test_dangerous_tools_need_confirmation, test_power_delay_and_cancel,
              test_cancel_after_confirm_aborts_restart, test_cancel_survives_bot_restart,
              test_button_cancel_keeps_confirmed_timer):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
