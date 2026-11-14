"""
engine.py — единый голосовой движок.

Связывает STT и TTS. Важно: голосовой запрос идёт в ТОТ ЖЕ AI Brain, что и
текст — интеллект не дублируется (см. ТЗ). Здесь только «уши и рот».
"""
from __future__ import annotations

from .stt import SpeechToText
from .tts import TextToSpeech


class VoiceEngine:
    def __init__(self, provider, api_key: str, *, stt_model="whisper-1",
                 tts_voice="nova", tts_model="tts-1", tts_speed=1.0):
        self.stt = SpeechToText(provider, model=stt_model)
        self.tts = TextToSpeech(api_key, voice=tts_voice, model=tts_model, speed=tts_speed)

    def listen(self, audio_path: str) -> str:
        """Голос → текст (для передачи в Brain)."""
        return self.stt.transcribe(audio_path)

    def speak(self, text: str, out_path: str | None = None) -> str | None:
        """Текст → mp3 (ответ голосом)."""
        return self.tts.synthesize(text, out_path)

    @property
    def can_listen(self) -> bool:
        return self.stt.available()

    @property
    def can_speak(self) -> bool:
        return self.tts.available()
