#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 5 (Voice): STT/TTS/движок (на моках, без сети)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.voice import SpeechToText, TextToSpeech, VoiceEngine
from intellect.ai import FakeProvider

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def test_stt_with_provider():
    stt = SpeechToText(FakeProvider())
    check("STT доступен с провайдером", stt.available())
    check("STT возвращает текст", stt.transcribe("/tmp/x.ogg") == "тестовая расшифровка")


def test_stt_without_key():
    stt = SpeechToText(FakeProvider(available=False))
    check("STT без ключа недоступен", not stt.available())
    check("STT без ключа -> пусто", stt.transcribe("/tmp/x.ogg") == "")


def test_tts_without_key_graceful():
    tts = TextToSpeech(api_key="")
    check("TTS без ключа недоступен", not tts.available())
    check("TTS без ключа -> None", tts.synthesize("привет") is None)


def test_engine_flags():
    eng = VoiceEngine(FakeProvider(), api_key="")   # STT есть (fake), TTS нет (нет ключа)
    check("движок слышит (fake STT)", eng.can_listen)
    check("движок не говорит без ключа", not eng.can_speak)
    check("listen работает", eng.listen("/tmp/x.ogg") == "тестовая расшифровка")
    check("speak без ключа -> None", eng.speak("привет") is None)


if __name__ == "__main__":
    print("=== ЭТАП 5: тесты Voice ===")
    for t in (test_stt_with_provider, test_stt_without_key,
              test_tts_without_key_graceful, test_engine_flags):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
