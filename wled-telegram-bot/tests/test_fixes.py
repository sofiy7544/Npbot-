#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты исправлений 2.4.0 (по итогам проверки кода): ИИ без связи, сцены, cron,
задачи, блокировка панели старым паролем, таймер ТВ, лишний второй запрос к ИИ."""
import sys, tempfile
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.core.interfaces import ToolCall
from intellect.ai import ModelRouter, ToolRegistry, Brain, FakeProvider

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


class DownProvider(FakeProvider):
    def chat(self, *a, **k):
        raise ConnectionError("нет сети")


def test_ai_down():
    b = Brain(DownProvider(), ModelRouter('gpt-4o-mini', 'gpt-4o'))
    r = b.understand("включи свет")
    check("ИИ не ответил → не «Готово.», а честный фолбэк", r.reply != "Готово." and r.source == "fallback")


def test_no_extra_ai_call_for_actions():
    calls = []
    def scripted(msgs):
        calls.append(1)
        return {"text": "", "tool_calls": [ToolCall("cancel", {})]}
    reg = ToolRegistry()
    reg.add("cancel", "отмена", {"type": "object", "properties": {}},
            lambda a: {"message": "🛑 Перезагрузка отменена.", "ok": True, "nothing": False})
    r = Brain(FakeProvider(scripted), ModelRouter('gpt-4o-mini', 'gpt-4o'), reg).understand("отмени перезагрузку")
    check("действие без данных → один запрос к ИИ", len(calls) == 1)
    check("точный ответ инструмента не переписан", "отменена" in r.reply)


def test_scene_offline():
    from intellect.devices.tools import _apply_scene
    class Lamp:
        def apply(self, c): return False
    res = _apply_scene(Lamp(), "кино")
    check("лампа не отвечает → сцена ok=False", res.get("ok") is False and "недоступна" in res["message"])


def test_cron_bad_spec():
    from intellect.automation.cron import cron_matches
    now = datetime(2026, 11, 14, 12, 0)
    check("«*/0 * * * *» не роняет, просто не совпадает", cron_matches("*/0 * * * *", now) is False)
    check("«abc * * * *» не роняет", cron_matches("abc * * * *", now) is False)
    check("нормальное выражение работает", cron_matches("0 12 * * *", now) is True)


def _db():
    from intellect.db.database import Database
    return Database(str(Path(tempfile.mkdtemp()) / "t.db"))


def test_task_done_missing():
    from intellect.memory import tools as mt
    db = _db()
    res = mt._task_done(db, 1, {"id": 999})
    check("несуществующая задача → «нет», а не «выполнена»", "нет" in res["message"])
    tid = db.insert("tasks", {"user_id": 1, "title": "x", "status": "open", "created_at": 0})
    check("своя задача → выполнена", "выполнена" in mt._task_done(db, 1, {"id": tid})["message"])
    check("чужая задача → «нет»", "нет" in mt._task_done(db, 2, {"id": tid})["message"])


def test_automation_bad_cron_rejected():
    from intellect.automation.engine import AutomationEngine
    eng = AutomationEngine(_db(), executor=lambda *a, **k: None)
    try:
        eng.add(1, "x", "cron", "*/0 * * * *", [{"action": "lamp_off"}]); bad = False
    except ValueError:
        bad = True
    check("кривой cron при добавлении отклонён", bad)


def test_stale_password_no_lockout():
    from intellect.web.server import _RateLimiter
    rl = _RateLimiter()
    for _ in range(50):                      # телефон с СТАРЫМ паролем опрашивает лампу
        rl.note_auth_fail("192.168.1.50", "старый")
    check("один и тот же старый пароль не блокирует на 15 минут", not rl.is_locked("192.168.1.50"))
    for i in range(10):                      # подбор РАЗНЫХ паролей — блок
        rl.note_auth_fail("192.168.1.60", f"p{i}")
    check("10 разных неверных паролей → блок", rl.is_locked("192.168.1.60"))


def test_tv_timer_uses_poweroff():
    import timers, tvremote
    sent = []
    old_cfg, old_send = dict(tvremote.config), tvremote.send_key
    tvremote.config.update({"ip": "127.0.0.1", "method": "ws-token"})
    tvremote.send_key = lambda ip, key, method=None: sent.append(key)
    try:
        timers._tv_off()
    finally:
        tvremote.send_key = old_send
        tvremote.config.clear(); tvremote.config.update(old_cfg)
    check("таймер ТВ шлёт KEY_POWEROFF, не переключатель KEY_POWER", sent == ["KEY_POWEROFF"])


if __name__ == "__main__":
    print("=== Исправления 2.4.0 ===")
    for t in (test_ai_down, test_no_extra_ai_call_for_actions, test_scene_offline, test_cron_bad_spec,
              test_task_done_missing, test_automation_bad_cron_rejected, test_stale_password_no_lockout,
              test_tv_timer_uses_poweroff):
        print(f"\n[{t.__name__}]")
        try:
            t()
        except Exception as e:
            check(f"{t.__name__}: исключение {type(e).__name__}: {e}", False)
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
