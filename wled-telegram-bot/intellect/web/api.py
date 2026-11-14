"""
api.py — серверная логика веб-панели (независимо от HTTP-транспорта).

Все методы возвращают (code, data). Пишут/читают через IntellectApp, поэтому
панель показывает РЕАЛЬНЫЕ данные (устройства, память, автоматизации, ПК), а не
заглушки. Авторизация — по паролю (ACCESS_PASSWORD), передаётся заголовком.
"""
from __future__ import annotations

import json
import time


class WebAPI:
    def __init__(self, app):
        self.app = app
        self.password = app.settings.access_password
        ids = app.settings.allowed_users
        self.user_id = ids[0] if ids else 1

    def authorized(self, token: str | None) -> bool:
        # если пароль не задан — панель открыта в локальной сети
        return (not self.password) or token == self.password

    # ----------------------- эндпоинты -----------------------
    def status(self) -> tuple[int, dict]:
        return 200, self.app.status()

    def devices(self) -> tuple[int, dict]:
        return 200, {"devices": self.app.devices.status()}

    def device_command(self, body: dict) -> tuple[int, dict]:
        key = body.get("device")
        dev = self.app.devices.get(key)
        if not dev:
            return 404, {"error": "устройство не найдено"}
        ok = dev.apply(body.get("command", {}))
        return 200, {"ok": ok}

    def chat(self, body: dict) -> tuple[int, dict]:
        text = (body.get("text") or "").strip()
        if not text:
            return 400, {"error": "пустой запрос"}
        out = self.app.handle_text(self.user_id, text,
                                   confirm=bool(body.get("confirm")))
        return 200, out

    def memory_list(self) -> tuple[int, dict]:
        items = self.app.memory.recent(self.user_id, limit=50)
        return 200, {"items": [{"id": i.id, "content": i.content, "kind": i.kind}
                               for i in items]}

    def memory_add(self, body: dict) -> tuple[int, dict]:
        content = (body.get("content") or "").strip()
        if not content:
            return 400, {"error": "пусто"}
        mid = self.app.memory.remember(self.user_id, content,
                                       kind=body.get("kind", "fact"))
        return 200, {"id": mid}

    def memory_delete(self, body: dict) -> tuple[int, dict]:
        ok = self.app.memory.forget(self.user_id, int(body.get("id", 0)))
        return 200, {"ok": ok}

    def automations(self) -> tuple[int, dict]:
        rows = self.app.automation.list(self.user_id)
        return 200, {"items": [{
            "id": r["id"], "name": r["name"], "trigger_type": r["trigger_type"],
            "trigger_spec": r["trigger_spec"], "enabled": bool(r["enabled"]),
            "last_run": r["last_run"]} for r in rows]}

    def automation_toggle(self, body: dict) -> tuple[int, dict]:
        self.app.automation.set_enabled(int(body["id"]), bool(body.get("enabled", True)))
        return 200, {"ok": True}

    def automation_delete(self, body: dict) -> tuple[int, dict]:
        self.app.automation.delete(int(body["id"]))
        return 200, {"ok": True}

    def tasks(self) -> tuple[int, dict]:
        rows = self.app.db.query(
            "SELECT id, title, status FROM tasks WHERE user_id=? AND status='open' ORDER BY id",
            (self.user_id,))
        return 200, {"items": [dict(r) for r in rows]}

    def task_add(self, body: dict) -> tuple[int, dict]:
        title = (body.get("title") or "").strip()
        if not title:
            return 400, {"error": "пусто"}
        self.app.db.insert("tasks", {"user_id": self.user_id, "title": title,
                                     "status": "open", "created_at": time.time()})
        return 200, {"ok": True}

    def task_done(self, body: dict) -> tuple[int, dict]:
        self.app.db.execute("UPDATE tasks SET status='done', done_at=? WHERE id=? AND user_id=?",
                            (time.time(), int(body["id"]), self.user_id))
        return 200, {"ok": True}

    def system(self) -> tuple[int, dict]:
        from ..computer import info
        return 200, info.collect(top_processes=8)
