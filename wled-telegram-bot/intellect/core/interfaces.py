"""
interfaces.py — контракты модулей INTELLECT.

Чёткие интерфейсы позволяют: подменять провайдеров AI, добавлять новые
устройства и тестировать модули по отдельности (на моках). Реализации живут
в соответствующих пакетах (ai/, devices/, memory/) и появляются по этапам.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ───────────────────────────── AI ─────────────────────────────
@dataclass
class ChatMessage:
    role: str                     # system | user | assistant | tool
    content: str


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


class AIProvider(ABC):
    """Единый контракт облачного/локального провайдера AI."""

    name: str = "base"

    @abstractmethod
    def chat(self, messages: list[ChatMessage], *, model: str,
             tools: list[dict] | None = None, temperature: float = 0.4) -> dict:
        """Вернуть {'text': str, 'tool_calls': list[ToolCall]}."""

    @abstractmethod
    def embed(self, texts: list[str], *, model: str) -> list[list[float]]:
        """Эмбеддинги для семантической памяти."""

    @abstractmethod
    def transcribe(self, audio_path: str, *, model: str) -> str:
        """Речь → текст (Whisper)."""

    @abstractmethod
    def available(self) -> bool:
        """Готов ли провайдер (есть ключ/доступ)."""


# ─────────────────────────── Устройства ───────────────────────────
@dataclass
class DeviceState:
    online: bool
    data: dict[str, Any] = field(default_factory=dict)


class Device(ABC):
    """Контракт управляемого устройства (лампа, ТВ, ПК…)."""

    type: str = "device"

    @abstractmethod
    def id(self) -> str:
        """Стабильный идентификатор (например, IP)."""

    @abstractmethod
    def get_state(self) -> DeviceState:
        ...

    @abstractmethod
    def apply(self, command: dict[str, Any]) -> bool:
        """Применить команду; True при успехе."""

    def available(self) -> bool:
        try:
            return self.get_state().online
        except Exception:
            return False


# ───────────────────────────── Память ─────────────────────────────
@dataclass
class MemoryItem:
    id: int
    user_id: int
    kind: str
    content: str
    importance: int = 1
    score: float | None = None    # релевантность при семантическом поиске


class MemoryStore(ABC):
    @abstractmethod
    def remember(self, user_id: int, content: str, *, kind: str = "fact",
                 importance: int = 1, expires_at: float | None = None) -> int:
        ...

    @abstractmethod
    def search(self, user_id: int, query: str, *, limit: int = 5) -> list[MemoryItem]:
        ...

    @abstractmethod
    def recent(self, user_id: int, *, limit: int = 20) -> list[MemoryItem]:
        ...

    @abstractmethod
    def forget(self, user_id: int, memory_id: int) -> bool:
        ...
