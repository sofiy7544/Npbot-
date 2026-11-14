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


if __name__ == "__main__":
    print("=== ЭТАП 8: тесты Computer Control ===")
    for t in (test_info_collect, test_launch_whitelist, test_kill_whitelist,
              test_dangerous_tools_need_confirmation):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
