#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты оркестратора IntellectApp (сквозная интеграция модулей)."""
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["OPENAI_API_KEY"] = "sk-test-fake"
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "app.db")
os.environ["WLED_IP"] = "1.2.3.4"
os.environ["ALLOWED_USERS"] = "42"

from intellect.config import load_settings
from intellect.db.database import Database
from intellect.app import IntellectApp
from intellect.ai import Brain, FakeProvider
from intellect.core.interfaces import ToolCall

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


class FakeTransport:
    def __init__(self): self.state = {"on": False, "bri": 128, "seg": [{"col": [[255,255,255]], "fx": 0}]}; self.posts=[]
    def get_json(self, url):
        return self.state if url.endswith("state") else {"name": "Лампа"}
    def post_json(self, url, payload):
        self.posts.append(payload); return True


def _app(scripted=None):
    st = load_settings()
    app = IntellectApp(st, db=Database(st.db_path))
    app.wled._t = FakeTransport()
    if scripted is not None:
        fp = FakeProvider(scripted=scripted)
        app.provider = fp
        app.brain = Brain(fp, app.router, app.registry, confirm=app._confirm_current)
    return app


def test_text_controls_device():
    app = _app(scripted=lambda m: {"text": "", "tool_calls": [ToolCall("lamp_power", {"on": True})]})
    out = app.handle_text(42, "включи свет", name="Sergey")
    check("ответ получен", bool(out["reply"]))
    check("устройство реально получило команду", app.wled._t.posts and app.wled._t.posts[-1].get("on") is True)
    check("действие зафиксировано", out["did_actions"])
    # диалог записан в БД
    rows = app.db.query("SELECT role FROM messages WHERE user_id=42 ORDER BY id")
    check("в истории есть user и assistant",
          [r["role"] for r in rows] == ["user", "assistant"])


def test_memory_tool_via_brain():
    app = _app(scripted=lambda m: {"text": "", "tool_calls":
        [ToolCall("memory_remember", {"content": "вечером выключать свет", "kind": "preference"})]})
    app.handle_text(42, "запомни: вечером выключать свет")
    mem = app.memory.recent(42)
    check("память сохранена через инструмент",
          any("выключать свет" in m.content for m in mem))


def test_automation_uses_tools():
    app = _app()
    app.wled._t.posts.clear()
    aid = app.automation.add(42, "кино", "event", "movie",
        [{"tool": "lamp_brightness", "args": {"percent": 20}}])
    app.automation.fire_event("movie")
    check("сценарий выполнил инструмент лампы",
          any(p.get("bri") == round(20/100*255) for p in app.wled._t.posts))


def test_status_structure():
    app = _app()
    st = app.status()
    check("статус: есть ai", "available" in st["ai"])
    check("статус: есть устройства", "lamp" in st["devices"] and "tv" in st["devices"])
    check("статус: счётчики", "automations_active" in st and "tasks_open" in st)


def test_pending_ttl_expires():
    """Подтверждение опасного действия протухает через TTL."""
    from intellect.core.interfaces import ToolCall as _TC
    app = _app(scripted=lambda m: {"text": "", "tool_calls": [_TC("computer_kill", {"name": "chrome"})]})
    # computer_kill помечен dangerous → brain потребует подтверждение
    out = app.handle_text(42, "убей chrome")
    check("ожидает подтверждения", bool(out.get("pending_confirmation")))
    check("в _pending лежит запись", 42 in app._pending)
    # искусственно протухаем
    calls, _exp = app._pending[42]
    app._pending[42] = (calls, 0.0)   # expires_at в прошлом
    res = app.confirm_pending(42)
    check("протухшее подтверждение отклонено", res["did_actions"] is False)
    check("сообщение про устарело", "устарел" in res["reply"].lower())


if __name__ == "__main__":
    print("=== Оркестратор: сквозные тесты ===")
    for t in (test_text_controls_device, test_memory_tool_via_brain,
              test_automation_uses_tools, test_status_structure,
              test_pending_ttl_expires):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
