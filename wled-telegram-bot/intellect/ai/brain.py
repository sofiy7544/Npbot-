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
    "инструмент. "
    "Для настроений света используй lamp_scene: «спать/спокойно/ночник/вечер/чтение/"
    "работа/кино/дискотека/вечеринка/романтика/релакс». "
    "Если просят спокойный свет, сон или «убери мигание» — всегда вызывай lamp_scene "
    "со спокойной сценой (она гасит эффект), а не оставляй мигающий эффект. "
    "Если действие потенциально опасно, сначала объясни, что собираешься сделать. "
    "Если тебя просят о том, чего ты не умеешь (скачать файл из интернета, открыть "
    "сайт и т.п.) — честно скажи, что не можешь, не выдумывай. "
    "Не выдумывай факты о состоянии устройств/ПК — бери их из инструментов "
    "(lamp_status, tv_status, computer_status). "
    "Что сейчас идёт на экране телевизора (канал, фильм, сериал), ты НЕ видишь — "
    "так и скажи честно. tv_power вызывай ТОЛЬКО если прямо просят включить или "
    "выключить телевизор; для вопросов и проверок — tv_status."
)


@dataclass
class BrainResult:
    reply: str
    tool_results: list[dict] = field(default_factory=list)
    model: str | None = None
    source: str = "ai"                 # ai | fallback
    pending_confirmation: list[str] = field(default_factory=list)
    pending_calls: list = field(default_factory=list)   # ToolCall, ждущие подтверждения

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
        if model is None:               # все модели упали (сеть/ключ) — не врём «Готово.»
            return self._fallback(text)

        calls: list[ToolCall] = resp.get("tool_calls") or []
        if not calls:
            reply = (resp.get("text") or "").strip() or "Готово."
            return BrainResult(reply=reply, model=model, source="ai")

        results, pending, pending_calls = [], [], []
        substituted: set[str] = set()
        for call in calls:
            tool = self.registry.get(call.name)
            if tool and not tool.wanted(text, history):
                # Модель сама потянулась к действию, о котором не просили (tv_power
                # на «что идёт по телеку») — не выполняем, отвечаем через instead.
                alt = tool.instead
                if (alt and self.registry.get(alt) and alt not in substituted
                        and not any(c.name == alt for c in calls)):
                    substituted.add(alt)
                    results.append(self.registry.dispatch(ToolCall(alt, {})))
                elif not alt:
                    results.append({"ok": False, "name": call.name,
                                    "error": "не выполнил — об этом не просили"})
                continue
            if tool and tool.dangerous and not self._confirmed(call.name):
                pending.append(call.name)
                pending_calls.append(call)     # запоминаем САМ вызов, не фразу
                results.append({"ok": False, "name": call.name,
                                "error": "нужно подтверждение"})
                continue
            results.append(self.registry.dispatch(call))

        reply = self._compose_reply(resp.get("text") or "", results, pending)
        # Второй проход: если инструмент вернул ДАННЫЕ (статус/поиск, а не просто
        # подтверждение) — дать модели осмыслить их и ответить по-человечески.
        if not pending:
            info = any(isinstance(r.get("result"), dict)
                       and (set(r["result"].keys()) - {"message", "ok", "nothing", "state"})
                       for r in results if r.get("ok"))
            if info:
                follow = self._summarize_results(text, results)
                if follow:
                    reply = follow
        return BrainResult(reply=reply, tool_results=results, model=model,
                           source="ai", pending_confirmation=pending,
                           pending_calls=pending_calls)

    def _summarize_results(self, text: str, results: list[dict]) -> str:
        """Короткий естественный ответ по результатам инструментов (fast-модель)."""
        import json
        payload = [{"tool": r.get("name"), "result": r.get("result")}
                   for r in results if r.get("ok")]
        msgs = [
            ChatMessage("system", "Ты ассистент умного дома. Ниже результаты "
                        "инструментов в JSON. Дай пользователю короткий понятный "
                        "ответ по-русски на основе этих данных. Не выдумывай."),
            ChatMessage("user", f"Запрос: {text}\nДанные: "
                        f"{json.dumps(payload, ensure_ascii=False, default=str)[:3000]}"),
        ]
        try:
            r = self.provider.chat(msgs, model=self.router.fast, tools=None, temperature=0.3)
            return (r.get("text") or "").strip()
        except Exception:
            return ""

    def run_calls(self, calls: list) -> BrainResult:
        """Выполнить конкретные подтверждённые вызовы (без обращения к модели)."""
        results = [self.registry.dispatch(c) for c in calls]
        reply = self._compose_reply("", results, [])
        return BrainResult(reply=reply, tool_results=results, source="ai")

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
