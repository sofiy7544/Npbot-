# -*- coding: utf-8 -*-
"""
Локальный смоук-тест Stanley Quote Bot — без токена и без интернета.

Прогоняет весь конвейер на фикстуре:
  parse_message -> scrape (мок Shopify JSON) -> calculate -> build_pdf

Запуск:
    python selftest.py
Выход 0 — всё ок, PDF лежит в selftest_quote.pdf.
"""
import os
import sys
import types

# 1) Заглушка telebot, чтобы импорт stanley_bot не требовал токен/сеть.
_tb = types.ModuleType("telebot")
class _Bot:
    def __init__(self, *a, **k): pass
    def message_handler(self, *a, **k):
        return lambda f: f
    def infinity_polling(self, *a, **k): pass
_tb.TeleBot = _Bot
sys.modules["telebot"] = _tb

# 2) Подсунем фиктивный токен, чтобы read_token() не завершал процесс.
import builtins
_real_open = builtins.open
HERE = os.path.dirname(os.path.abspath(__file__))
def _fake_open(path, *a, **k):
    if os.path.abspath(str(path)) == os.path.join(HERE, "token.txt"):
        import io
        return io.StringIO("123456:SELFTEST\n")
    return _real_open(path, *a, **k)
builtins.open = _fake_open
import stanley_bot as sb
builtins.open = _real_open

# 3) Мокаем requests внутри stanley_bot — отдаём заранее сохранённый Shopify JSON.
SAMPLE_PRODUCT = {
    "product": {
        "title": "Classic Legendary Bottle 1.0 QT | Hammertone Green",
        "variants": [
            {"price": "58.50", "grams": 635, "available": True},
            {"price": "58.50", "grams": 635, "available": False},
        ],
    }
}
class _Resp:
    def __init__(self, data): self._data = data
    def raise_for_status(self): pass
    def json(self): return self._data
def _fake_get(url, *a, **k):
    return _Resp(SAMPLE_PRODUCT)
sb.requests.get = _fake_get

failures = []
def check(name, cond, got=None):
    status = "OK " if cond else "FAIL"
    print(f"[{status}] {name}" + (f"  -> {got}" if got is not None else ""))
    if not cond:
        failures.append(name)

# --- parse_message ---
u, q, kg = sb.parse_message(
    "https://www.stanley1913.com/products/classic-legendary-bottle-1-0-qt 50 0,84")
check("parse_message: url", u.endswith("classic-legendary-bottle-1-0-qt"), u)
check("parse_message: qty=50", q == 50, q)
check("parse_message: kg=0.84 (запятая как разделитель)", kg == 0.84, kg)

u2, q2, kg2 = sb.parse_message("просто текст без ссылки")
check("parse_message: нет ссылки -> None", u2 is None, u2)

# --- scrape (на моке) ---
p = sb.scrape("https://www.stanley1913.com/products/classic-legendary-bottle-1-0-qt")
check("scrape: price=58.5", p["price"] == 58.5, p["price"])
check("scrape: kg_each=0.635 (из grams)", p["kg_each"] == 0.635, p["kg_each"])
check("scrape: available=True", p["available"] is True, p["available"])
check("scrape: size содержит литры", "л" in p["size"], p["size"])

# --- calculate ---
d = sb.calculate(p, 30)
check("calculate: unit=87.75 (58.5*1.5)", d["unit_price"] == 87.75, d["unit_price"])
check("calculate: goods=2632.5", d["goods"] == 2632.5, d["goods"])
check("calculate: total_kg=19.05", d["total_kg"] == 19.05, d["total_kg"])
check("calculate: shipping=171.45 (19.05*9)", d["shipping"] == 171.45, d["shipping"])
check("calculate: total=2803.95", d["total"] == 2803.95, d["total"])

# --- calculate: нет веса -> WEIGHT_UNKNOWN ---
try:
    sb.calculate({"name": "x", "size": "s", "price": 10, "kg_each": None,
                  "available": True}, 30)
    check("calculate: WEIGHT_UNKNOWN", False)
except ValueError as e:
    check("calculate: WEIGHT_UNKNOWN при отсутствии веса", str(e) == "WEIGHT_UNKNOWN", str(e))

# --- build_pdf ---
out = os.path.join(HERE, "selftest_quote.pdf")
sb.build_pdf(d, out)
check("build_pdf: файл создан", os.path.exists(out) and os.path.getsize(out) > 1000,
      f"{os.path.getsize(out)} bytes")

print()
if failures:
    print(f"ПРОВАЛЕНО {len(failures)}: " + ", ".join(failures))
    sys.exit(1)
print("ВСЁ ОК. Открой selftest_quote.pdf чтобы посмотреть карточку.")
