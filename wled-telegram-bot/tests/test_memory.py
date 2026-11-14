#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 4 (Memory Engine): долговременная/семантическая память + диалог."""
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.db.database import Database
from intellect.memory import SQLiteMemory, ConversationMemory
from intellect.ai import FakeProvider

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def _db():
    return Database(os.path.join(tempfile.mkdtemp(), "m.db"))


def test_remember_recent_forget():
    mem = SQLiteMemory(_db(), provider=None)   # без эмбеддингов
    i1 = mem.remember(1, "вечером нужно выключать свет", kind="preference")
    mem.remember(1, "я живу в Одессе")
    mem.remember(2, "чужая запись")            # другой пользователь
    rec = mem.recent(1)
    check("recent видит только свои записи", len(rec) == 2)
    check("forget удаляет", mem.forget(1, i1) and len(mem.recent(1)) == 1)
    check("forget чужого не трогает", mem.forget(1, 999) is False)


def test_keyword_search_no_embeddings():
    mem = SQLiteMemory(_db(), provider=None)
    mem.remember(1, "вечером выключать телевизор")
    mem.remember(1, "купить молоко утром")
    res = mem.search(1, "когда выключать телевизор", limit=3)
    check("ключевой поиск находит нужное",
          res and "телевизор" in res[0].content)


def test_semantic_search_with_embeddings():
    prov = FakeProvider()                       # детерминированные эмбеддинги
    mem = SQLiteMemory(_db(), provider=prov)
    mem.remember(1, "лампа в спальне синего цвета")
    mem.remember(1, "телевизор самсунг на кухне")
    mem.remember(1, "пароль от вайфая записан в блокноте")
    # запрос точно совпадает с одной записью -> она должна быть первой (косинус=1)
    res = mem.search(1, "телевизор самсунг на кухне", limit=3)
    check("семантический поиск ранжирует точное совпадение первым",
          res and res[0].content == "телевизор самсунг на кухне")
    check("у результата есть score", res[0].score is not None)


def test_expiry():
    import time
    mem = SQLiteMemory(_db(), provider=None)
    mem.remember(1, "временная заметка", expires_at=time.time() - 1)  # уже истекла
    mem.remember(1, "постоянная заметка")
    rec = mem.recent(1)
    check("истёкшая запись не показывается", len(rec) == 1 and rec[0].content == "постоянная заметка")


def test_conversation_history():
    db = _db()
    conv = ConversationMemory(db)
    conv.log(1, "user", "привет", name="Sergey")
    conv.log(1, "assistant", "здравствуй")
    conv.log(1, "user", "включи свет")
    hist = conv.history(1, limit=10)
    check("история в хронологическом порядке",
          [m.content for m in hist] == ["привет", "здравствуй", "включи свет"])
    check("пользователь создан", db.query_one("SELECT name FROM users WHERE id=1")["name"] == "Sergey")


if __name__ == "__main__":
    print("=== ЭТАП 4: тесты Memory Engine ===")
    for t in (test_remember_recent_forget, test_keyword_search_no_embeddings,
              test_semantic_search_with_embeddings, test_expiry, test_conversation_history):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
