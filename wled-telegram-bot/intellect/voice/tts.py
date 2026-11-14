"""
tts.py — синтез речи (Text-To-Speech).

Основной путь — OpenAI TTS (tts-1), голоса nova/alloy/echo/… Длинные тексты
режутся на части по размеру. Если ключа нет — вернёт None (бот ответит текстом).
"""
from __future__ import annotations

import os
import tempfile

MAX_TTS_CHARS = 3800     # лимит ввода TTS за один запрос


class TextToSpeech:
    def __init__(self, api_key: str, voice: str = "nova",
                 model: str = "tts-1", speed: float = 1.0):
        self._key = api_key or ""
        self.voice = voice
        self.model = model
        self.speed = speed
        self._client = None

    def available(self) -> bool:
        return bool(self._key)

    def _c(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(api_key=self._key)
        return self._client

    def synthesize(self, text: str, out_path: str | None = None) -> str | None:
        """Озвучить текст в mp3-файл. None — если недоступно/ошибка."""
        text = (text or "").strip()
        if not text or not self.available():
            return None
        text = text[:MAX_TTS_CHARS]
        out_path = out_path or os.path.join(tempfile.gettempdir(),
                                            f"intellect_tts_{abs(hash(text)) % 10**8}.mp3")
        try:
            resp = self._c().audio.speech.create(
                model=self.model, voice=self.voice, input=text, speed=self.speed)
            resp.stream_to_file(out_path)
            return out_path
        except Exception:
            return None
