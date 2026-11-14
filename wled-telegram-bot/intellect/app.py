"""
app.py — оркестратор INTELLECT: собирает все модули в единый продукт.

Один класс IntellectApp, которым пользуются и Telegram-интерфейс, и веб-панель.
Здесь провайдер AI, мозг, память, устройства, автоматизации, голос и управление
ПК связаны вместе; инструменты зарегистрированы в мозге.
"""
from __future__ import annotations

import threading

from .config import Settings, settings as default_settings
from .db import get_db
from .core.interfaces import ChatMessage
from .ai import Brain, ModelRouter, ToolRegistry, make_provider
from .memory import SQLiteMemory, ConversationMemory
from .memory.tools import register_memory_tools
from .devices import WledDevice, SamsungTVDevice, DeviceRegistry, register_device_tools
from .computer import ComputerControl
from .computer.tools import register_computer_tools
from .automation import AutomationEngine
from .voice import VoiceEngine
from .security import audit


class IntellectApp:
    def __init__(self, settings: Settings | None = None, db=None, *, log=None):
        self.settings = settings or default_settings
        self.db = db or get_db(self.settings.db_path)
        self.log = log
        self._ctx = threading.local()          # контекст текущего запроса (user, confirm)
        self._pending: dict[int, list] = {}    # user_id → вызовы, ждущие подтверждения

        key = self.settings.openai_api_key.get()
        self.provider = make_provider(key)
        self.router = ModelRouter(self.settings.ai_model_fast, self.settings.ai_model_strong)
        self.registry = ToolRegistry()

        # Память
        self.memory = SQLiteMemory(self.db, self.provider, self.settings.ai_model_embed)
        self.conversation = ConversationMemory(self.db)

        # Устройства
        self.wled = WledDevice(self.settings.wled_ip)
        self.tv = SamsungTVDevice(self.settings.samsung_tv_ip or None)
        self.devices = DeviceRegistry(self.db)
        self.devices.add("lamp", self.wled)
        self.devices.add("tv", self.tv)

        # Управление ПК (белые списки задаются в настройках/БД; по умолчанию пусто)
        self.computer = ComputerControl(
            allowed_apps=self.db.get_setting("allowed_apps", {}) or {},
            killable=set(self.db.get_setting("killable", []) or []))

        # Регистрация инструментов мозга
        register_device_tools(self.registry, wled=self.wled, tv=self.tv)
        register_computer_tools(self.registry, self.computer)
        register_memory_tools(self.registry, self.memory, self.db, self._current_user)

        # Мозг (подтверждение опасных берём из контекста запроса)
        self.brain = Brain(self.provider, self.router, self.registry,
                           confirm=self._confirm_current, log=log)

        # Голос
        self.voice = VoiceEngine(self.provider, key,
                                 stt_model=self.settings.ai_model_stt)

        # Автоматизации (исполняют инструменты мозга)
        self.automation = AutomationEngine(self.db, self._run_action, log=log)

    # ----------------------- контекст запроса -----------------------
    def _current_user(self) -> int:
        return getattr(self._ctx, "user_id", 0)

    def _confirm_current(self, action: str) -> bool:
        return getattr(self._ctx, "confirm", False)

    # ----------------------- обработка сообщений -----------------------
    def handle_text(self, user_id: int, text: str, *, name: str | None = None,
                    confirm: bool = False) -> dict:
        """Главная точка: текст пользователя → ответ ассистента (+ выполненные действия)."""
        self._ctx.user_id = user_id
        self._ctx.confirm = confirm
        self.conversation.log(user_id, "user", text, name=name)
        history = self.conversation.history(user_id, limit=8)
        # history уже включает только что добавленную реплику пользователя — уберём дубль
        hist = history[:-1] if history and history[-1].content == text else history
        result = self.brain.understand(text, history=hist)
        self.conversation.log(user_id, "assistant", result.reply,
                              meta={"model": result.model, "source": result.source})
        if result.did_actions:
            audit(self.db, "brain.actions", user_id=user_id,
                  detail={"text": text, "tools": [r.get("name") for r in result.tool_results]})
        # запоминаем ИМЕННО вызовы, ждущие подтверждения (не фразу)
        if result.pending_calls:
            self._pending[user_id] = result.pending_calls
        return {
            "reply": result.reply,
            "pending_confirmation": result.pending_confirmation,
            "did_actions": result.did_actions,
            "source": result.source,
        }

    def confirm_pending(self, user_id: int) -> dict:
        """Выполнить ровно то опасное действие, что ждало подтверждения."""
        self._ctx.user_id = user_id
        calls = self._pending.pop(user_id, None)
        if not calls:
            return {"reply": "Нечего подтверждать 🤔", "did_actions": False}
        result = self.brain.run_calls(calls)
        audit(self.db, "brain.confirmed", user_id=user_id,
              detail={"tools": [getattr(c, "name", "?") for c in calls]})
        return {"reply": result.reply, "did_actions": result.did_actions}

    def cancel_pending(self, user_id: int) -> None:
        self._pending.pop(user_id, None)

    def handle_voice(self, user_id: int, audio_path: str, *, name: str | None = None) -> dict:
        """Голосовое → распознать → обработать как текст."""
        text = self.voice.listen(audio_path)
        if not text:
            return {"reply": "Не расслышал 🙈", "transcript": "", "source": "stt"}
        out = self.handle_text(user_id, text, name=name)
        out["transcript"] = text
        return out

    # ----------------------- для автоматизаций -----------------------
    def _run_action(self, action: dict) -> tuple[bool, str]:
        """Выполнить одно действие сценария: {'tool': имя, 'args': {...}}."""
        from .core.interfaces import ToolCall
        # контекст пользователя для инструментов памяти/задач (планировщик — свой поток)
        if not getattr(self._ctx, "user_id", 0):
            ids = self.settings.allowed_users
            self._ctx.user_id = action.get("user_id") or (ids[0] if ids else 1)
        res = self.registry.dispatch(ToolCall(action.get("tool", ""), action.get("args", {})))
        msg = ""
        if isinstance(res.get("result"), dict):
            msg = res["result"].get("message", "")
        return res.get("ok", False), msg or res.get("error", "")

    # ----------------------- статус для панели/мониторинга -----------------------
    def status(self) -> dict:
        autos = self.db.query_one("SELECT COUNT(*) AS c FROM automations WHERE enabled=1")
        tasks = self.db.query_one("SELECT COUNT(*) AS c FROM tasks WHERE status='open'")
        return {
            "ai": {
                "available": self.provider.available(),
                "model_fast": self.settings.ai_model_fast,
                "model_strong": self.settings.ai_model_strong,
                "provider": self.provider.name,
            },
            "voice": {"listen": self.voice.can_listen, "speak": self.voice.can_speak},
            "devices": self.devices.status(),
            "automations_active": autos["c"] if autos else 0,
            "tasks_open": tasks["c"] if tasks else 0,
            "db": self.settings.db_path,
        }

    def start_background(self) -> None:
        """Запустить фоновый планировщик автоматизаций."""
        self.automation.start()

    def stop(self) -> None:
        self.automation.stop()
