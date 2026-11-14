"""
tools.py — инструменты управления ПК для AI Brain.

Безопасные (status) — без флага. Опасные (shutdown/restart/kill) помечены
dangerous=True → Brain не выполнит их без подтверждения пользователя.
"""
from __future__ import annotations

from ..ai.tools import ToolRegistry
from . import info
from .control import ComputerControl, SafetyError


def register_computer_tools(reg: ToolRegistry, ctl: ComputerControl) -> None:
    reg.add("computer_status", "Состояние ПК: CPU, память, диски, аптайм.",
            {"type": "object", "properties": {}},
            lambda a: {"message": info.quick_summary()})

    def _launch(a):
        try:
            return ctl.launch(str(a.get("name", "")))
        except SafetyError as e:
            return {"ok": False, "message": f"⛔ {e}"}
    reg.add("computer_launch", "Запустить разрешённое приложение по имени.",
            {"type": "object", "properties": {"name": {"type": "string"}},
             "required": ["name"]}, _launch)

    def _kill(a):
        try:
            return ctl.kill(str(a.get("name", "")))
        except SafetyError as e:
            return {"ok": False, "message": f"⛔ {e}"}
    reg.add("computer_kill", "Завершить разрешённый процесс по имени.",
            {"type": "object", "properties": {"name": {"type": "string"}},
             "required": ["name"]}, _kill, dangerous=True)

    reg.add("computer_shutdown", "Выключить компьютер (с задержкой).",
            {"type": "object", "properties": {"delay_sec": {"type": "integer"}}},
            lambda a: ctl.shutdown(int(a.get("delay_sec", 30))), dangerous=True)

    reg.add("computer_restart", "Перезагрузить компьютер.",
            {"type": "object", "properties": {"delay_sec": {"type": "integer"}}},
            lambda a: ctl.restart(int(a.get("delay_sec", 30))), dangerous=True)

    reg.add("computer_cancel_shutdown", "Отменить запланированное выключение.",
            {"type": "object", "properties": {}},
            lambda a: ctl.cancel_shutdown())
