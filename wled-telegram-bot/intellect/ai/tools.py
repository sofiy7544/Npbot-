"""
tools.py — реестр инструментов для AI Brain (function calling).

Инструмент = имя + описание + JSON-схема параметров + обработчик. Brain отдаёт
схемы модели; когда модель просит вызвать инструмент — Brain находит его здесь
и исполняет реальным обработчиком. Опасные инструменты помечаются и требуют
подтверждения (проверяется на уровне Brain/вызывающего).

Инструменты регистрируются по мере готовности модулей (устройства — этап 6,
память — этап 4), поэтому реестр пустой по умолчанию и наполняется извне.
Никаких заглушек: если инструмент зарегистрирован — он реально работает.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..core.interfaces import ToolCall


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict           # JSON Schema (object)
    handler: Callable[[dict], Any]
    dangerous: bool = False

    def schema(self) -> dict:
        """Схема в формате OpenAI tools."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters or {"type": "object", "properties": {}},
            },
        }


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def add(self, name: str, description: str, parameters: dict,
            handler: Callable[[dict], Any], dangerous: bool = False) -> None:
        self.register(Tool(name, description, parameters, handler, dangerous))

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def schemas(self) -> list[dict]:
        return [t.schema() for t in self._tools.values()]

    def dispatch(self, call: ToolCall) -> dict:
        """Выполнить инструмент. Возвращает {'ok':bool, 'result'|'error', 'name'}."""
        tool = self._tools.get(call.name)
        if not tool:
            return {"ok": False, "name": call.name, "error": "неизвестный инструмент"}
        try:
            res = tool.handler(call.arguments or {})
            return {"ok": True, "name": call.name, "result": res}
        except Exception as e:
            return {"ok": False, "name": call.name, "error": f"{type(e).__name__}: {e}"}
