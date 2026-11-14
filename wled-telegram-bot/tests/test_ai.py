#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ЭТАПА 3 (AI Brain): роутер, реестр инструментов, мозг."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intellect.core.interfaces import ChatMessage, ToolCall
from intellect.ai import ModelRouter, ToolRegistry, Tool, Brain, FakeProvider

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


def test_router():
    r = ModelRouter(fast="gpt-4o-mini", strong="gpt-4o")
    check("простая фраза → fast", r.choose("включи свет") == "gpt-4o-mini")
    check("сложная фраза → strong",
          r.choose("проанализируй и составь план на неделю подробно") == "gpt-4o")
    check("несколько действий → strong",
          r.classify("включи свет, выключи телевизор, поставь таймер, и ещё напомни") == "complex")
    check("fallback-цепочка из 2 моделей", len(r.fallback_chain("включи свет")) == 2)


def test_registry():
    reg = ToolRegistry()
    log = []
    reg.add("lamp_on", "включить лампу", {"type": "object", "properties": {}},
            lambda a: {"message": "лампа включена"})
    reg.add("set_bri", "яркость", {"type": "object",
            "properties": {"percent": {"type": "integer"}}},
            lambda a: {"message": f"яркость {a['percent']}%"})
    check("схемы для 2 инструментов", len(reg.schemas()) == 2)
    out = reg.dispatch(ToolCall("set_bri", {"percent": 40}))
    check("dispatch выполняет обработчик", out["ok"] and out["result"]["message"] == "яркость 40%")
    bad = reg.dispatch(ToolCall("nope", {}))
    check("dispatch неизвестного — ошибка", not bad["ok"])


def test_brain_text_reply():
    prov = FakeProvider(scripted=lambda msgs: {"text": "привет!", "tool_calls": []})
    brain = Brain(prov, ModelRouter("fast", "strong"))
    res = brain.understand("как дела")
    check("текстовый ответ без инструментов", res.reply == "привет!" and res.source == "ai")


def test_brain_tool_call():
    reg = ToolRegistry()
    executed = {}
    def _lamp_on(a):
        executed["on"] = True
        return {"message": "💡 включил лампу"}
    reg.add("lamp_on", "включить лампу", {"type": "object", "properties": {}}, _lamp_on)
    prov = FakeProvider(scripted=lambda msgs: {
        "text": "", "tool_calls": [ToolCall("lamp_on", {})]})
    brain = Brain(prov, ModelRouter("fast", "strong"), reg)
    res = brain.understand("включи свет")
    check("инструмент реально вызван", executed.get("on") is True)
    check("ответ собран из результата", "включил лампу" in res.reply)
    check("did_actions=True", res.did_actions)


def test_brain_dangerous_needs_confirm():
    reg = ToolRegistry()
    fired = {"n": 0}
    reg.add("shutdown", "выключить ПК", {"type": "object", "properties": {}},
            lambda a: fired.__setitem__("n", fired["n"] + 1) or {"message": "выключаю"},
            dangerous=True)
    prov = FakeProvider(scripted=lambda msgs: {
        "text": "", "tool_calls": [ToolCall("shutdown", {})]})

    # без подтверждения — НЕ выполняется
    b1 = Brain(prov, ModelRouter("f", "s"), reg, confirm=lambda n: False)
    r1 = b1.understand("выключи компьютер")
    check("опасное без подтверждения не выполнено", fired["n"] == 0)
    check("запрошено подтверждение", "shutdown" in r1.pending_confirmation)

    # с подтверждением — выполняется
    b2 = Brain(prov, ModelRouter("f", "s"), reg, confirm=lambda n: True)
    b2.understand("выключи компьютер")
    check("опасное с подтверждением выполнено", fired["n"] == 1)


def test_brain_fallback_no_key():
    prov = FakeProvider(available=False)
    brain = Brain(prov, ModelRouter("f", "s"))
    res = brain.understand("что угодно")
    check("фолбэк при отсутствии ключа", res.source == "fallback")


if __name__ == "__main__":
    print("=== ЭТАП 3: тесты AI Brain ===")
    for t in (test_router, test_registry, test_brain_text_reply, test_brain_tool_call,
              test_brain_dangerous_needs_confirm, test_brain_fallback_no_key):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
