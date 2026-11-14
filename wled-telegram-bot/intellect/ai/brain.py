"""
brain.py — AI Brain: единый интеллектуальный центр.

Понимает естественный язык, решает — ответить текстом или вызвать инструмент,
маршрутизирует модель по сложности, пробует запасную модель при ошибке, ведёт
контекст диалога и требует подтверждения для опасных действий.

Не привязан к конкретному провайдеру (работает через core.AIProvider).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..core.interfaces import AIProvider, ChatMessage, ToolCall
from .router import ModelRouter
from .tools import ToolRegistry

DEFAULT_SYSTEM = (
    "Ты — INTELLECT, персональный ассистент. Отвечай кратко и по делу, по-русски. "
    "Если нужно управлять устройствами, памятью или задачами — вызывай подходящий "
    "инструмент. Если действие потенциально опасно, сначала объясни, что собираешься "
    "сделать. Не выдумывай факты о состоянии устройств — бери их из инструментов."
)


@dataclass
class BrainResult:
    reply: str
    tool_results: list[dict] = field(default_factory=list)
    model: str | None = None
    source: str = "ai"                 # ai | fallback
    pending_confirmation: list[str] = field(default_factory=list)

    @property
    def did_actions(self) -> bool:
        return any(r.get("ok") for r in self.tool_results)


class Brain:
    def __init__(self, provider: AIProvider, router: ModelRouter,
                 registry: ToolRegistry | None = None, *,
                 system_prompt: str = DEFAULT_SYSTEM,
                 confirm: Callable[[str], bool] | None = None,
                 log=None):
        self.provider = provider
        self.router = router
        self.registry = registry or ToolRegistry()
        self.system_prompt = system_prompt
        self._confirm = confirm
        self._log = log

    # ----------------------- публичное API -----------------------
    def understand(self, text: str, *, history: list[ChatMessage] | None = None,
                   allow_tools: bool = True) -> BrainResult:
        """Разобрать фразу: ответить и/или выполнить инструменты."""
        if not self.provider.available():
            return self._fallback(text)

        messages = [ChatMessage("system", self.system_prompt)]
        messages += (history or [])
        messages.append(ChatMessage("user", text))

        tools = self.registry.schemas() if (allow_tools and self.registry.names()) else None
        resp, model = self._chat_with_fallback(messages, text, tools)

        calls: list[ToolCall] = resp.get("tool_calls") or []
        if not calls:
            reply = (resp.get("text") or "").strip() or "Готово."
            return BrainResult(reply=reply, model=model, source="ai")

        results, pending = [], []
        for call in calls:
            tool = self.registry.get(call.name)
            if tool and tool.dangerous and not self._confirmed(call.name):
                pending.append(call.name)
                results.append({"ok": False, "name": call.name,
                                "error": "нужно подтверждение"})
                continue
            results.append(self.registry.dispatch(call))

        reply = self._compose_reply(resp.get("text") or "", results, pending)
        return BrainResult(reply=reply, tool_results=results, model=model,
                           source="ai", pending_confirmation=pending)

    def chat(self, text: str, *, history: list[ChatMessage] | None = None) -> str:
        """Простой разговор без инструментов."""
        return self.understand(text, history=history, allow_tools=False).reply

    # ----------------------- внутреннее -----------------------
    def _chat_with_fallback(self, messages, text, tools):
        last_err = None
        for model in self.router.fallback_chain(text):
            try:
                return self.provider.chat(messages, model=model, tools=tools), model
            except Exception as e:
                last_err = e
                if self._log:
                    self._log.warning(f"AI модель {model} не ответила ({type(e).__name__}), пробую запасную")
        # все модели упали — честный фолбэк
        if self._log:
            self._log.warning(f"AI недоступен: {last_err!r}")
        return {"text": "", "tool_calls": []}, None

    def _confirmed(self, name: str) -> bool:
        if self._confirm is None:
            return False
        try:
            return bool(self._confirm(name))
        except Exception:
            return False

    def _compose_reply(self, model_text: str, results: list[dict],
                       pending: list[str]) -> str:
        parts: list[str] = []
        if model_text:
            parts.append(model_text)
        for r in results:
            if not r.get("ok"):
                if r.get("error") != "нужно подтверждение":
                    parts.append(f"⚠️ {r['name']}: {r.get('error')}")
                continue
            res = r.get("result")
            if isinstance(res, dict) and res.get("message"):
                parts.append(str(res["message"]))
            elif isinstance(res, str):
                parts.append(res)
        if pending:
            parts.append("Подтверди действие, чтобы я выполнил: " + ", ".join(pending))
        return " ".join(p for p in parts if p).strip() or "Готово."

    def _fallback(self, text: str) -> BrainResult:
        return BrainResult(
            reply="ИИ сейчас недоступен (нет ключа или сети). "
                  "Базовые команды устройствами всё равно работают.",
            source="fallback")
