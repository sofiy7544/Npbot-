"""
stt.py — распознавание речи (Speech-To-Text).

Облачный Whisper через AIProvider (на целевом Atom локальный Whisper слишком
медленный — выбран облачный, см. ARCHITECTURE.md). Telegram отдаёт голосовые в
формате OGG/Opus — Whisper принимает его напрямую.
"""
from __future__ import annotations

from ..core.interfaces import AIProvider


class SpeechToText:
    def __init__(self, provider: AIProvider, model: str = "whisper-1"):
        self.provider = provider
        self.model = model

    def available(self) -> bool:
        return self.provider.available()

    def transcribe(self, audio_path: str) -> str:
        """Вернуть текст из аудиофайла (пусто, если не распозналось/нет ключа)."""
        if not self.available():
            return ""
        try:
            return self.provider.transcribe(audio_path, model=self.model)
        except Exception:
            return ""
