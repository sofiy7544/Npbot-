#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 7 (Automation): cron, once, события, анти-дубли, журнал."""
import os, sys, tempfile
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.db.database import Database
from intellect.automation import AutomationEngine, cron_matches

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def _engine(executor):
    db = Database(os.path.join(tempfile.mkdtemp(), "a.db"))
    return AutomationEngine(db, executor), db


def test_cron_matcher():
    check("23:00 каждый день", cron_matches("0 23 * * *", datetime(2026, 11, 14, 23, 0)))
    check("не 22:59", not cron_matches("0 23 * * *", datetime(2026, 11, 14, 22, 59)))
    check("*/15 минут", cron_matches("*/15 * * * *", datetime(2026, 11, 14, 10, 30)))
    check("будни 8:30 (пятница)", cron_matches("30 8 * * 1-5", datetime(2026, 11, 13, 8, 30)))
    check("выходной не попадает", not cron_matches("30 8 * * 1-5", datetime(2026, 11, 14, 8, 30)))


def test_cron_fires_once_per_minute():
    calls = []
    eng, db = _engine(lambda a: (calls.append(a) or (True, "ok")))
    eng.add(1, "вечер", "cron", "0 23 * * *",
            [{"tool": "lamp_power", "args": {"on": False}}])
    moment = datetime(2026, 11, 14, 23, 0)
    eng.tick(moment); eng.tick(moment)   # два тика в ту же минуту
    check("cron сработал один раз за минуту", len(calls) == 1)
    runs = db.query("SELECT * FROM automation_runs")
    check("запуск записан в журнал", len(runs) == 1 and runs[0]["status"] == "ok")


def test_once_runs_and_disables():
    calls = []
    eng, db = _engine(lambda a: (calls.append(a) or (True, "ok")))
    eng.add(1, "напоминание", "once", "2020-01-01T00:00:00",
            [{"tool": "notify", "args": {}}])
    eng.tick(datetime(2026, 1, 1))
    eng.tick(datetime(2026, 1, 1))
    check("одноразовая сработала один раз", len(calls) == 1)
    row = db.query_one("SELECT enabled FROM automations LIMIT 1")
    check("одноразовая отключилась", row["enabled"] == 0)


def test_event_trigger():
    calls = []
    eng, db = _engine(lambda a: (calls.append(a) or (True, "ok")))
    eng.add(1, "сценарий кино", "event", "movie",
            [{"tool": "tv_power", "args": {"on": True}},
             {"tool": "lamp_brightness", "args": {"percent": 20}}])
    n = eng.fire_event("movie")
    check("событие запустило сценарий", n == 1 and len(calls) == 2)


def test_scenario_multi_actions_logged():
    eng, db = _engine(lambda a: (True, f"сделал {a['tool']}"))
    aid = eng.add(1, "утро", "event", "morning",
                  [{"tool": "lamp_power", "args": {"on": True}},
                   {"tool": "lamp_brightness", "args": {"percent": 90}}])
    eng.fire_event("morning")
    run = db.query_one("SELECT detail FROM automation_runs ORDER BY id DESC LIMIT 1")
    check("в журнале обе команды", "lamp_power" in run["detail"] and "lamp_brightness" in run["detail"])


if __name__ == "__main__":
    print("=== ЭТАП 7: тесты Automation ===")
    for t in (test_cron_matcher, test_cron_fires_once_per_minute,
              test_once_runs_and_disables, test_event_trigger,
              test_scenario_multi_actions_logged):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
