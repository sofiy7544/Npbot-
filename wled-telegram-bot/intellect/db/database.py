"""
database.py — единый доступ к SQLite для INTELLECT.

- одно соединение на процесс, защищённое Lock (безопасно для async + потоков);
- WAL-режим и foreign_keys ON;
- автоприменение миграций при старте;
- простые помощники execute / query / query_one / insert.

Намеренно без тяжёлого ORM — на слабом ПК (Atom, 4 ГБ) это лишнее.
"""
from __future__ import annotations

import json
import time
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

from .migrations import MIGRATIONS


class Database:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.RLock()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA foreign_keys=ON;")
            self._conn.execute("PRAGMA busy_timeout=5000;")
        self._migrate()

    # ---------------- миграции ----------------
    def _migrate(self) -> None:
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
            done = {r[0] for r in self._conn.execute(
                "SELECT version FROM schema_migrations")}
            for version, sql in sorted(MIGRATIONS):
                if version in done:
                    continue
                self._conn.executescript(sql)
                self._conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)",
                    (version, time.time()))
                self._conn.commit()

    @property
    def schema_version(self) -> int:
        row = self.query_one("SELECT MAX(version) AS v FROM schema_migrations")
        return int(row["v"]) if row and row["v"] is not None else 0

    # ---------------- базовые операции ----------------
    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        """Выполнить запрос на запись, вернуть lastrowid."""
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return cur.lastrowid

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, [tuple(x) for x in seq])
            self._conn.commit()

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(params)).fetchall())

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def insert(self, table: str, data: dict[str, Any]) -> int:
        cols = ", ".join(data.keys())
        marks = ", ".join("?" for _ in data)
        return self.execute(
            f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))

    # ---------------- key/value настройки ----------------
    def set_setting(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, json.dumps(value, ensure_ascii=False), time.time()))

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self.query_one("SELECT value FROM settings WHERE key=?", (key,))
        if not row or row["value"] is None:
            return default
        try:
            return json.loads(row["value"])
        except Exception:
            return row["value"]

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass


_db: Database | None = None
_db_lock = threading.Lock()


def get_db(path: str | None = None) -> Database:
    """Единый экземпляр БД на процесс (ленивая инициализация)."""
    global _db
    with _db_lock:
        if _db is None:
            if path is None:
                from ..config import settings
                path = settings.db_path
            _db = Database(path)
        return _db
