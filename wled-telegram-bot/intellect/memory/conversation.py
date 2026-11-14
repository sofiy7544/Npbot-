"""
conversation.py — краткосрочная память: история текущего диалога.

Пишет сообщения в таблицы conversations/messages и отдаёт последние N реплик
как контекст для AI Brain. Это «кратко-/историческая» память по ТЗ.
"""
from __future__ import annotations

import json
import time

from ..core.interfaces import ChatMessage


class ConversationMemory:
    def __init__(self, db):
        self.db = db

    def _active_conversation(self, user_id: int) -> int:
        row = self.db.query_one(
            "SELECT id FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
            (user_id,))
        if row:
            return row["id"]
        now = time.time()
        return self.db.insert("conversations", {
            "user_id": user_id, "title": None, "created_at": now, "updated_at": now})

    def _ensure_user(self, user_id: int, name: str | None = None) -> None:
        if not self.db.query_one("SELECT 1 FROM users WHERE id=?", (user_id,)):
            self.db.insert("users", {"id": user_id, "name": name, "role": "user",
                                     "created_at": time.time(), "last_seen": time.time()})
        else:
            self.db.execute("UPDATE users SET last_seen=? WHERE id=?",
                            (time.time(), user_id))

    def log(self, user_id: int, role: str, content: str, *,
            name: str | None = None, meta: dict | None = None) -> int:
        self._ensure_user(user_id, name)
        conv = self._active_conversation(user_id)
        mid = self.db.insert("messages", {
            "conversation_id": conv, "user_id": user_id, "role": role,
            "content": content, "meta": json.dumps(meta, ensure_ascii=False) if meta else None,
            "created_at": time.time()})
        self.db.execute("UPDATE conversations SET updated_at=? WHERE id=?",
                        (time.time(), conv))
        return mid

    def history(self, user_id: int, *, limit: int = 10) -> list[ChatMessage]:
        """Последние реплики (в хронологическом порядке) для контекста Brain."""
        conv = self.db.query_one(
            "SELECT id FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
            (user_id,))
        if not conv:
            return []
        rows = self.db.query(
            "SELECT role, content FROM messages WHERE conversation_id=? "
            "ORDER BY created_at DESC LIMIT ?", (conv["id"], limit))
        rows = list(reversed(rows))
        return [ChatMessage(r["role"], r["content"]) for r in rows
                if r["role"] in ("user", "assistant")]

    def clear(self, user_id: int) -> None:
        """Начать новый диалог (старую историю не трогаем, просто новый поток)."""
        now = time.time()
        self.db.insert("conversations", {
            "user_id": user_id, "title": None, "created_at": now, "updated_at": now})
