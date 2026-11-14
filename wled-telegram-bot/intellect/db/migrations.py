"""
migrations.py — версионированная схема БД INTELLECT.

Каждая миграция — (версия, SQL). Применяются по порядку; применённые версии
отмечаются в таблице schema_migrations. Добавлять новое — только НОВОЙ
миграцией с бОльшим номером (старые не менять), чтобы данные переживали апдейты.
"""
from __future__ import annotations

# Схема по ТЗ: users, conversations, messages, memories, devices,
# device_states, automations, automation_runs, tasks, notifications,
# settings, audit_logs.
MIGRATIONS: list[tuple[int, str]] = [
    (1, """
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY,          -- Telegram user_id
        name          TEXT,
        role          TEXT NOT NULL DEFAULT 'user', -- user | admin
        created_at    REAL NOT NULL,
        last_seen     REAL
    );

    CREATE TABLE IF NOT EXISTS conversations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        title         TEXT,
        created_at    REAL NOT NULL,
        updated_at    REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        user_id         INTEGER NOT NULL,
        role            TEXT NOT NULL,   -- user | assistant | system | tool
        content         TEXT NOT NULL,
        meta            TEXT,            -- JSON (модель, токены, инструмент…)
        created_at      REAL NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'fact',  -- fact|preference|event|note
        content       TEXT NOT NULL,
        embedding     BLOB,                          -- float32-вектор (семантика)
        importance    INTEGER NOT NULL DEFAULT 1,
        expires_at    REAL,                          -- NULL = бессрочно
        created_at    REAL NOT NULL,
        updated_at    REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, kind);

    CREATE TABLE IF NOT EXISTS devices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        type          TEXT NOT NULL,    -- wled | samsung_tv | computer | ha
        name          TEXT NOT NULL,
        address       TEXT,             -- IP/идентификатор
        config        TEXT,             -- JSON
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_at    REAL NOT NULL,
        UNIQUE(type, address)
    );

    CREATE TABLE IF NOT EXISTS device_states (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id     INTEGER NOT NULL,
        online        INTEGER NOT NULL DEFAULT 0,
        state         TEXT,             -- JSON (снимок состояния)
        checked_at    REAL NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_devstate_dev ON device_states(device_id, checked_at);

    CREATE TABLE IF NOT EXISTS automations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        name          TEXT NOT NULL,
        trigger_type  TEXT NOT NULL,    -- cron | once | event
        trigger_spec  TEXT NOT NULL,    -- cron-строка / ISO-время / имя события
        actions       TEXT NOT NULL,    -- JSON-список действий
        conditions    TEXT,             -- JSON (опционально)
        enabled       INTEGER NOT NULL DEFAULT 1,
        last_run      REAL,
        next_run      REAL,
        created_at    REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_autom_user ON automations(user_id, enabled);

    CREATE TABLE IF NOT EXISTS automation_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        automation_id INTEGER NOT NULL,
        started_at    REAL NOT NULL,
        finished_at   REAL,
        status        TEXT NOT NULL,    -- ok | error | skipped
        detail        TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_autorun ON automation_runs(automation_id, started_at);

    CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        title         TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'open',  -- open | done | cancelled
        due_at        REAL,
        created_at    REAL NOT NULL,
        done_at       REAL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, status);

    CREATE TABLE IF NOT EXISTS notifications (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        text          TEXT NOT NULL,
        level         TEXT NOT NULL DEFAULT 'info',  -- info | warn | error
        sent          INTEGER NOT NULL DEFAULT 0,
        created_at    REAL NOT NULL,
        sent_at       REAL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key           TEXT PRIMARY KEY,
        value         TEXT,
        updated_at    REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER,
        action        TEXT NOT NULL,
        target        TEXT,
        detail        TEXT,             -- JSON (без секретов!)
        ok            INTEGER NOT NULL DEFAULT 1,
        created_at    REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
    """),
]
