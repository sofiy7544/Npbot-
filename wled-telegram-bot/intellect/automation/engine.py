"""
engine.py — движок автоматизаций.

Хранит автоматизации в БД (переживают перезапуск). Типы триггеров:
  cron   — повторяющееся расписание (trigger_spec = cron-строка)
  once   — один раз (trigger_spec = ISO-время)
  event  — по событию (trigger_spec = имя события), запуск через fire_event()

Действия — список {"tool": имя, "args": {...}}, исполняются через executor
(обычно ToolRegistry мозга). Каждый запуск пишется в automation_runs.
Анти-дубли: cron не срабатывает дважды в одну минуту (защита от частых тиков).
"""
from __future__ import annotations

import json
import time
import threading
from datetime import datetime

from .cron import cron_matches, next_run_after


class AutomationEngine:
    def __init__(self, db, executor, *, log=None):
        """executor(action: dict) -> (ok: bool, message: str)."""
        self.db = db
        self.executor = executor
        self.log = log
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._last_min: dict[int, str] = {}   # id -> 'YYYY-MM-DD HH:MM' последнего запуска

    # ----------------------- CRUD -----------------------
    def add(self, user_id: int, name: str, trigger_type: str, trigger_spec: str,
            actions: list[dict], conditions: dict | None = None,
            enabled: bool = True) -> int:
        now = time.time()
        next_run = None
        if trigger_type == "cron":
            nr = next_run_after(trigger_spec, datetime.now())
            next_run = nr.timestamp() if nr else None
        elif trigger_type == "once":
            next_run = _parse_iso(trigger_spec)
        return self.db.insert("automations", {
            "user_id": user_id, "name": name, "trigger_type": trigger_type,
            "trigger_spec": trigger_spec,
            "actions": json.dumps(actions, ensure_ascii=False),
            "conditions": json.dumps(conditions, ensure_ascii=False) if conditions else None,
            "enabled": 1 if enabled else 0, "next_run": next_run, "created_at": now})

    def list(self, user_id: int | None = None) -> list:
        if user_id is None:
            return self.db.query("SELECT * FROM automations ORDER BY id")
        return self.db.query("SELECT * FROM automations WHERE user_id=? ORDER BY id", (user_id,))

    def set_enabled(self, auto_id: int, enabled: bool) -> None:
        self.db.execute("UPDATE automations SET enabled=? WHERE id=?",
                        (1 if enabled else 0, auto_id))

    def delete(self, auto_id: int) -> None:
        self.db.execute("DELETE FROM automations WHERE id=?", (auto_id,))

    # ----------------------- выполнение -----------------------
    def run(self, auto: dict | object) -> dict:
        auto = dict(auto)
        started = time.time()
        actions = json.loads(auto["actions"]) if auto.get("actions") else []
        ok_all, messages = True, []
        for action in actions:
            try:
                ok, msg = self.executor(action)
            except Exception as e:
                ok, msg = False, f"{type(e).__name__}: {e}"
            ok_all = ok_all and ok
            messages.append(msg or "")
        status = "ok" if ok_all else "error"
        self.db.insert("automation_runs", {
            "automation_id": auto["id"], "started_at": started,
            "finished_at": time.time(), "status": status,
            "detail": json.dumps(messages, ensure_ascii=False)})
        self.db.execute("UPDATE automations SET last_run=? WHERE id=?",
                        (started, auto["id"]))
        if self.log:
            self.log.info(f"⚙️ Автоматизация «{auto['name']}»: {status}")
        return {"status": status, "messages": messages}

    def tick(self, now: datetime | None = None) -> int:
        """Проверить и запустить созревшие cron/once. Возвращает число запусков."""
        now = now or datetime.now()
        minute_key = now.strftime("%Y-%m-%d %H:%M")
        fired = 0
        for auto in self.db.query("SELECT * FROM automations WHERE enabled=1"):
            a = dict(auto)
            ttype = a["trigger_type"]
            if ttype == "cron":
                if cron_matches(a["trigger_spec"], now) and self._last_min.get(a["id"]) != minute_key:
                    self._last_min[a["id"]] = minute_key
                    self.run(a); fired += 1
                    nr = next_run_after(a["trigger_spec"], now)
                    self.db.execute("UPDATE automations SET next_run=? WHERE id=?",
                                    (nr.timestamp() if nr else None, a["id"]))
            elif ttype == "once":
                if a["next_run"] and now.timestamp() >= a["next_run"]:
                    self.run(a); fired += 1
                    self.set_enabled(a["id"], False)   # одноразовая — отключаем
        return fired

    def fire_event(self, event_name: str, user_id: int | None = None) -> int:
        """Запустить все автоматизации, привязанные к событию."""
        fired = 0
        rows = self.db.query(
            "SELECT * FROM automations WHERE enabled=1 AND trigger_type='event' "
            "AND trigger_spec=?", (event_name,))
        for a in rows:
            if user_id is None or a["user_id"] == user_id:
                self.run(dict(a)); fired += 1
        return fired

    # ----------------------- фоновый цикл -----------------------
    def start(self, interval: float = 20.0) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()

        def _loop():
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception as e:
                    if self.log:
                        self.log.warning(f"Ошибка планировщика: {e}")
                self._stop.wait(interval)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def _parse_iso(s: str) -> float | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "")).timestamp()
    except Exception:
        return None
