#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тесты ЭТАПА 2 (фундамент): конфиг, БД/миграции, безопасность.
Запуск:  python tests/test_foundation.py   (из папки проекта)
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_ok = 0
_fail = 0


def check(name, cond):
    global _ok, _fail
    if cond:
        _ok += 1
        print(f"  ✅ {name}")
    else:
        _fail += 1
        print(f"  ❌ {name}")


def test_config_secret_masking():
    from intellect.config import Secret, load_settings
    s = Secret("sk-proj-SUPERSECRET-123456")
    check("Secret.get возвращает значение", s.get() == "sk-proj-SUPERSECRET-123456")
    check("Secret в repr замаскирован", "SUPERSECRET" not in repr(s))
    check("Secret.masked без утечки", "SUPERSECRET" not in s.masked())
    os.environ["WLED_BOT_TOKEN"] = "123456789:AAtokenvaluethatissecret123456"
    os.environ["OPENAI_API_KEY"] = "sk-proj-abcdef1234567890"
    st = load_settings()
    check("describe() не светит токен",
          "AAtokenvaluethatissecret" not in st.describe())
    check("describe() не светит ключ", "abcdef1234567890" not in st.describe())
    check("ai_enabled=True при наличии ключа", st.ai_enabled is True)


def test_database_migrations():
    from intellect.db.database import Database
    tmp = tempfile.mkdtemp()
    db = Database(os.path.join(tmp, "t.db"))
    check("schema_version == 1", db.schema_version == 1)
    tables = {r["name"] for r in db.query(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {"users", "conversations", "messages", "memories", "devices",
                "device_states", "automations", "automation_runs", "tasks",
                "notifications", "settings", "audit_logs"}
    missing = expected - tables
    check(f"все таблицы созданы (нет: {missing or '—'})", not missing)

    # повторная инициализация не ломает и не дублирует миграции
    db2 = Database(os.path.join(tmp, "t.db"))
    check("повторный старт идемпотентен", db2.schema_version == 1)


def test_crud_and_settings():
    from intellect.db.database import Database
    tmp = tempfile.mkdtemp()
    db = Database(os.path.join(tmp, "t.db"))
    import time
    uid = db.insert("users", {"id": 42, "name": "Sergey", "role": "admin",
                              "created_at": time.time()})
    row = db.query_one("SELECT * FROM users WHERE id=42")
    check("insert/query users", row is not None and row["name"] == "Sergey")

    db.set_setting("theme", {"dark": True})
    check("settings round-trip", db.get_setting("theme") == {"dark": True})
    check("settings default", db.get_setting("missing", 7) == 7)


def test_audit_redaction():
    from intellect.db.database import Database
    from intellect.security import audit, redact
    tmp = tempfile.mkdtemp()
    db = Database(os.path.join(tmp, "t.db"))
    leak = "key=sk-proj-abcdef123456 and token 123456789:AAverysecrettokenvalue123"
    clean = redact(leak)
    check("redact убирает sk-ключ", "sk-proj-abcdef" not in clean)
    check("redact убирает Telegram-токен", "AAverysecrettokenvalue" not in clean)

    audit(db, "devices.on", user_id=42, target="wled",
          detail={"note": leak}, ok=True)
    rec = db.query_one("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1")
    check("аудит записан", rec is not None and rec["action"] == "devices.on")
    check("в аудите нет секрета", "sk-proj-abcdef" not in (rec["detail"] or ""))


if __name__ == "__main__":
    print("=== ЭТАП 2: тесты фундамента ===")
    for t in (test_config_secret_masking, test_database_migrations,
              test_crud_and_settings, test_audit_redaction):
        print(f"\n[{t.__name__}]")
        t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
