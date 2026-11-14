"""
tools.py — инструменты памяти и задач для AI Brain.

Позволяют ассистенту запоминать факты, искать по памяти и вести задачи — по
реальным данным из БД (никаких выдуманных «воспоминаний»). user_id берётся из
контекста запроса (get_user), чтобы память была разделена по пользователям.
"""
from __future__ import annotations

import time
from typing import Callable

from ..ai.tools import ToolRegistry


def register_memory_tools(reg: ToolRegistry, memory, db, get_user: Callable[[], int]) -> None:
    reg.add("memory_remember", "Запомнить факт/предпочтение пользователя надолго.",
            {"type": "object", "properties": {
                "content": {"type": "string"},
                "kind": {"type": "string", "enum": ["fact", "preference", "event", "note"]}},
             "required": ["content"]},
            lambda a: _remember(memory, get_user(), a))

    reg.add("memory_search", "Найти в памяти пользователя по смыслу/ключевым словам.",
            {"type": "object", "properties": {"query": {"type": "string"}},
             "required": ["query"]},
            lambda a: _search(memory, get_user(), a))

    reg.add("memory_recent", "Показать последние сохранённые записи памяти.",
            {"type": "object", "properties": {}},
            lambda a: _recent(memory, get_user()))

    # Задачи (таблица tasks)
    reg.add("task_add", "Добавить задачу/дело.",
            {"type": "object", "properties": {"title": {"type": "string"}},
             "required": ["title"]},
            lambda a: _task_add(db, get_user(), a))

    reg.add("task_list", "Показать открытые задачи.",
            {"type": "object", "properties": {}},
            lambda a: _task_list(db, get_user()))

    reg.add("task_done", "Отметить задачу выполненной по её номеру (id).",
            {"type": "object", "properties": {"id": {"type": "integer"}},
             "required": ["id"]},
            lambda a: _task_done(db, get_user(), a))


def _remember(memory, uid, a):
    mid = memory.remember(uid, a["content"], kind=a.get("kind", "fact"))
    return {"message": "🧠 Запомнил" if mid else "Нечего запоминать"}


def _search(memory, uid, a):
    items = memory.search(uid, a["query"], limit=5)
    if not items:
        return {"message": "Ничего не нашёл в памяти"}
    lines = "; ".join(i.content for i in items)
    return {"message": f"🧠 Нашёл: {lines}", "items": [i.content for i in items]}


def _recent(memory, uid):
    items = memory.recent(uid, limit=10)
    if not items:
        return {"message": "Память пока пуста"}
    return {"message": "🧠 Последнее: " + "; ".join(i.content for i in items)}


def _task_add(db, uid, a):
    db.insert("tasks", {"user_id": uid, "title": a["title"], "status": "open",
                        "created_at": time.time()})
    return {"message": f"✅ Задача добавлена: {a['title']}"}


def _task_list(db, uid):
    rows = db.query("SELECT id, title FROM tasks WHERE user_id=? AND status='open' ORDER BY id",
                    (uid,))
    if not rows:
        return {"message": "Открытых задач нет"}
    return {"message": "📋 Задачи: " + "; ".join(f"#{r['id']} {r['title']}" for r in rows)}


def _task_done(db, uid, a):
    import time as _t
    n = db.execute("UPDATE tasks SET status='done', done_at=? WHERE id=? AND user_id=?",
                   (_t.time(), int(a["id"]), uid))
    return {"message": f"✔️ Задача #{a['id']} выполнена"}
