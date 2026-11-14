"""
providers.py — адаптеры AI-провайдеров (реализуют core.AIProvider).

OpenAIProvider — облачные модели (chat/embeddings/whisper). Единственный, что
реально нужен на целевом железе. FakeProvider — детерминированная заглушка для
тестов и как часть фолбэка (без ключа).

Система НЕ привязана к одному поставщику: чтобы добавить, например, Anthropic,
достаточно написать ещё один класс по тому же интерфейсу и зарегистрировать его.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from ..core.interfaces import AIProvider, ChatMessage, ToolCall


class OpenAIProvider(AIProvider):
    name = "openai"

    def __init__(self, api_key: str):
        self._key = api_key or ""
        self._client = None

    def _c(self):
        if self._client is None:
            from openai import OpenAI          # ленивый импорт
            # не ждать по 10 минут на слабом Wi-Fi (по умолчанию SDK: 600 с × 3 попытки)
            self._client = OpenAI(api_key=self._key, timeout=30, max_retries=1)
        return self._client

    def available(self) -> bool:
        return bool(self._key)

    def chat(self, messages: list[ChatMessage], *, model: str,
             tools: list[dict] | None = None, temperature: float = 0.4) -> dict:
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        resp = self._c().chat.completions.create(**payload)
        msg = resp.choices[0].message
        calls: list[ToolCall] = []
        for tc in (getattr(msg, "tool_calls", None) or []):
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            calls.append(ToolCall(name=tc.function.name, arguments=args))
        return {"text": (msg.content or "").strip(), "tool_calls": calls}

    def embed(self, texts: list[str], *, model: str) -> list[list[float]]:
        resp = self._c().embeddings.create(model=model, input=texts)
        return [d.embedding for d in resp.data]

    def transcribe(self, audio_path: str, *, model: str) -> str:
        with open(audio_path, "rb") as f:
            resp = self._c().audio.transcriptions.create(model=model, file=f)
        return (getattr(resp, "text", "") or "").strip()


class FakeProvider(AIProvider):
    """Детерминированная заглушка. Для тестов и как запасной вариант без сети.
    Можно задать сценарий ответов через `scripted`."""
    name = "fake"

    def __init__(self, scripted: Callable[[list[ChatMessage]], dict] | None = None,
                 available: bool = True):
        self._scripted = scripted
        self._available = available

    def available(self) -> bool:
        return self._available

    def chat(self, messages, *, model, tools=None, temperature=0.4) -> dict:
        if self._scripted:
            return self._scripted(messages)
        last = messages[-1].content if messages else ""
        return {"text": f"[fake:{model}] {last}", "tool_calls": []}

    def embed(self, texts, *, model) -> list[list[float]]:
        # стабильный псевдо-вектор по хешу слов (для оффлайн-тестов памяти)
        import hashlib
        out = []
        for t in texts:
            h = hashlib.sha256(t.lower().encode()).digest()
            out.append([b / 255.0 for b in h[:16]])
        return out

    def transcribe(self, audio_path, *, model) -> str:
        return "тестовая расшифровка"


def make_provider(api_key: str) -> AIProvider:
    """Основной провайдер по наличию ключа; иначе — заглушка (available=False)."""
    if api_key:
        return OpenAIProvider(api_key)
    return FakeProvider(available=False)
