"""Voice Engine — распознавание (Whisper) и синтез речи (облако)."""
from .stt import SpeechToText
from .tts import TextToSpeech
from .engine import VoiceEngine

__all__ = ["SpeechToText", "TextToSpeech", "VoiceEngine"]
