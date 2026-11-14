#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты ТВ: ИИ-ядро и кнопки пульта используют ОДИН конфиг (tvremote/tv.json),
а вопрос «что идёт по телеку» никогда не включает/выключает телевизор.
Сеть не трогаем: отправка клавиш в tvremote подменена."""
import os, sys, json, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.pop("SAMSUNG_TV_IP", None)

import tvremote
from intellect.devices import SamsungTVDevice, register_device_tools
from intellect.ai import ToolRegistry, Brain, ModelRouter, FakeProvider
from intellect.ai.brain import DEFAULT_SYSTEM
from intellect.core.interfaces import ToolCall

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


SENT = []        # (ip, key, method) — что «ушло» в телевизор
ONLINE = {"v": True}


def _fresh():
    """Чистый общий конфиг во временной папке + заглушки сети."""
    os.environ.pop("SAMSUNG_TV_IP", None)
    tvremote.CONFIG_FILE = os.path.join(tempfile.mkdtemp(), "tv.json")
    tvremote.config.update(ip="", method="", mac="", name="", model="")
    tvremote._mtime = -1.0
    tvremote._dispatch = lambda ip, key, m: SENT.append((ip, key, m))
    tvremote.detect = lambda ip: {"method": None}
    tvremote.wake_on_lan = lambda mac: None
    tvremote._port_open = lambda ip, port, timeout=1.2: ONLINE["v"]
    SENT.clear()


def _pick(ip="192.168.1.106", method="ws-token"):
    """То же, что кнопка «Найти телевизор» → wled_bot._tv_pick."""
    tvremote.config.update(ip=ip, method=method, mac="64:1C:AE:FC:24:B7",
                           name="[TV] Samsung telek", model="UE55NU7093")
    tvremote.save_config()


def _brain(calls):
    reg = ToolRegistry()
    tv = SamsungTVDevice()
    register_device_tools(reg, tv=tv)
    prov = FakeProvider(scripted=lambda m: {"text": "", "tool_calls": list(calls)})
    return Brain(prov, ModelRouter("f", "s"), reg), reg


def test_not_configured_is_honest():
    _fresh()
    brain, _ = _brain([ToolCall("tv_key", {"key": "KEY_PAUSE"})])
    res = brain.understand("поставь телек на паузу")
    check("не настроен → так и говорит", "не настроен" in res.reply)
    check("подсказка, где настроить", "Найти телевизор" in res.reply)
    check("в пустой адрес не стучимся", SENT == [])


def test_ai_uses_button_config_live():
    _fresh()
    brain, _ = _brain([ToolCall("tv_key", {"key": "KEY_PAUSE"})])
    brain.understand("пауза")               # до настройки
    _pick()                                 # кнопки настроили ТВ — без перезапуска
    res = brain.understand("пауза")
    check("ИИ шлёт на IP из tv.json", SENT and SENT[-1][0] == "192.168.1.106")
    check("ИИ шлёт тем же протоколом (ws-token)", SENT and SENT[-1][2] == "ws-token")
    check("ответ про клавишу", "KEY_PAUSE" in res.reply)


def test_tv_json_changed_on_the_fly():
    _fresh()
    _pick()
    tv = SamsungTVDevice()
    tv.apply({"action": "key", "key": "KEY_PLAY"})
    with open(tvremote.CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump({"ip": "192.168.1.200", "method": "ws"}, f)
    t = time.time() + 5
    os.utime(tvremote.CONFIG_FILE, (t, t))  # гарантированно новый mtime
    tv.apply({"action": "key", "key": "KEY_PLAY"})
    check("новый tv.json подхвачен без перезапуска", SENT[-1][:3] == ("192.168.1.200", "KEY_PLAY", "ws"))
    check("кнопки видят то же", tvremote.config["ip"] == "192.168.1.200")


def test_env_ip_read_after_dotenv():
    _fresh()
    # wled_bot импортирует tvremote ДО загрузки .env → значение появляется позже
    os.environ["SAMSUNG_TV_IP"] = "10.0.0.5"
    tvremote.load_config()
    tv = SamsungTVDevice()
    tv.apply({"action": "key", "key": "KEY_HOME"})
    check("SAMSUNG_TV_IP из .env учтён", tvremote.config["ip"] == "10.0.0.5")
    check("id() и apply() смотрят в один адрес", tv.id() == "10.0.0.5" and SENT[-1][0] == "10.0.0.5")
    os.environ.pop("SAMSUNG_TV_IP", None)


def test_working_method_is_saved():
    _fresh()
    _pick(method="ws-token")
    def disp(ip, key, m):
        if m == "ws-token":
            raise RuntimeError("нет 8002")
        SENT.append((ip, key, m))
    tvremote._dispatch = disp
    SamsungTVDevice().apply({"action": "key", "key": "KEY_MUTE"})
    with open(tvremote.CONFIG_FILE, encoding="utf-8") as f:
        saved = json.load(f)
    check("сработавший протокол запомнен (как у кнопок)", tvremote.config["method"] == "ws"
          and saved["method"] == "ws")


def test_whats_on_tv_never_powers():
    _fresh()
    _pick()
    for q in ("Что щас идет по телеку", "Почему?"):
        for on in (False, True):
            SENT.clear()
            brain, _ = _brain([ToolCall("tv_power", {"on": on})])
            res = brain.understand(q)
            check(f"«{q}» + tv_power(on={on}) → питание не тронуто",
                  not any(k.startswith("KEY_POWER") for _, k, _ in SENT))
            check(f"«{q}» → честно: экран не вижу", "не вижу" in res.reply)


def test_explicit_power_still_works():
    _fresh()
    _pick()
    for q, on, key in (("выключи телевизор", False, "KEY_POWEROFF"),
                       ("вимкни телевізор", False, "KEY_POWEROFF"),
                       ("вруби телек", True, "KEY_POWERON")):
        SENT.clear()
        brain, _ = _brain([ToolCall("tv_power", {"on": on})])
        brain.understand(q)
        check(f"«{q}» → {key}", any(k == key for _, k, _ in SENT))


def test_no_double_status():
    _fresh()
    _pick()
    brain, _ = _brain([ToolCall("tv_status", {}), ToolCall("tv_power", {"on": False})])
    res = brain.understand("что по телеку")
    check("tv_status не задвоен", res.reply.count("не вижу") == 1)
    check("питание не тронуто", SENT == [])


def test_status_when_off():
    _fresh()
    _pick()
    ONLINE["v"] = False
    brain, _ = _brain([ToolCall("tv_status", {})])
    res = brain.understand("что с телеком")
    ONLINE["v"] = True
    check("ТВ не отвечает → так и говорит", "не отвечает" in res.reply and "UE55NU7093" in res.reply)


def test_prompt_and_schema():
    _fresh()
    _, reg = _brain([])
    check("есть инструмент tv_status", "tv_status" in reg.names())
    check("tv_power: только по прямой просьбе", "ТОЛЬКО" in reg.get("tv_power").description)
    check("промпт: экран ТВ не видно", "НЕ видишь" in DEFAULT_SYSTEM and "tv_status" in DEFAULT_SYSTEM)
    check("автоматизации tv_power не режутся (dispatch без фразы)",
          reg.dispatch(ToolCall("tv_power", {"on": True}))["ok"])


def test_power_confirmed_in_dialog():
    """«можешь выключить телик?» → бот уточнил → «да»: это явная просьба, выполнить.
    А «да» без такой просьбы раньше в разговоре — питание не трогать."""
    from intellect.core.interfaces import ChatMessage
    _fresh()
    _pick()
    brain, _ = _brain([ToolCall("tv_power", {"on": False})])
    hist = [ChatMessage("user", "можешь выключить телик?"),
            ChatMessage("assistant", "Выключить телевизор?")]
    SENT.clear()
    brain.understand("да", history=hist)
    check("«да» после «выключить телик?» → KEY_POWEROFF", any(k == "KEY_POWEROFF" for _, k, _ in SENT))
    SENT.clear()
    hist2 = [ChatMessage("user", "что по телеку?"), ChatMessage("assistant", "Не вижу экран.")]
    brain.understand("да", history=hist2)
    check("«да» без просьбы о питании → питание НЕ трогаем",
          not any(k.startswith("KEY_POWER") for _, k, _ in SENT))
    SENT.clear()
    brain2, _ = _brain([ToolCall("tv_power", {"on": True})])
    brain2.understand("запусти телик")
    check("«запусти телик» → KEY_POWERON", any(k == "KEY_POWERON" for _, k, _ in SENT))


if __name__ == "__main__":
    print("=== Телевизор: единый конфиг + без случайного питания ===")
    for t in (test_not_configured_is_honest, test_ai_uses_button_config_live,
              test_tv_json_changed_on_the_fly, test_env_ip_read_after_dotenv,
              test_working_method_is_saved, test_whats_on_tv_never_powers,
              test_explicit_power_still_works, test_no_double_status,
              test_status_when_off, test_prompt_and_schema, test_power_confirmed_in_dialog):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
