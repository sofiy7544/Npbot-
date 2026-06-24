# -*- coding: utf-8 -*-
"""
Stanley Quote Bot
Кидаешь боту ссылку на товар с www.stanley1913.com -> получаешь PDF-просчёт.
Формат сообщения:
    <ссылка>                      -> 30 шт, наценка x1.5, почта $9/кг
    <ссылка> 50                   -> 50 шт
    <ссылка> 50 0.84              -> 50 шт и вес 0.84 кг/шт вручную (если сайт вес не отдал)
"""
import os
import re
import sys
import tempfile
import requests
from bs4 import BeautifulSoup

import telebot
from quote_pdf import build_pdf

# ------------------- НАСТРОЙКИ -------------------
MARKUP       = 1.5     # наценка
SHIP_PER_KG  = 9       # доставка, $/кг
DEFAULT_QTY  = 30      # кол-во по умолчанию
LB_TO_KG     = 0.453592
QT_TO_L      = 0.946353
OZ_TO_L      = 0.0295735
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/124.0 Safari/537.36"}
# -------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))


def read_token():
    p = os.path.join(HERE, "token.txt")
    if not os.path.exists(p):
        sys.exit("Нет файла token.txt рядом с ботом. Создай его и вставь токен от @BotFather.")
    lines = [ln.strip() for ln in open(p, encoding="utf-8")]
    t = next((ln for ln in lines if ln and not ln.startswith("#")), "")
    if not t:
        sys.exit("В token.txt нет токена. Открой файл, вставь токен от @BotFather и сохрани.")
    return t


# ---------- разбор сообщения ----------
def parse_message(text):
    """Возвращает (url, qty, kg_override|None)."""
    url_match = re.search(r"https?://[^\s]+", text)
    if not url_match:
        return None, None, None
    url = url_match.group(0)
    rest = (text[:url_match.start()] + " " + text[url_match.end():]).split()
    qty, kg = DEFAULT_QTY, None
    for tok in rest:
        tok = tok.replace(",", ".")
        if re.fullmatch(r"\d+", tok):
            qty = int(tok)
        elif re.fullmatch(r"\d+\.\d+", tok):
            kg = float(tok)
    return url, qty, kg


def handle_from_url(url):
    m = re.search(r"/products/([^/?#]+)", url)
    return m.group(1) if m else None


def size_string(title):
    """Из названия достаём объём и собираем спецификацию."""
    spec = "сталь 18/8 · вакуумна ізоляція"
    m = re.search(r"(\d+(?:\.\d+)?)\s*(QT|qt|OZ|oz)", title)
    if m:
        val = float(m.group(1))
        if m.group(2).lower() == "qt":
            litres = val * QT_TO_L
        else:
            litres = val * OZ_TO_L
        return f"Об'єм {litres:.2f} л · " + spec
    return spec


# ---------- скрейпинг ----------
def scrape(url):
    handle = handle_from_url(url)
    if not handle:
        raise ValueError("Это не похоже на ссылку товара stanley1913.com (нет /products/...).")

    base = re.match(r"(https?://[^/]+)", url).group(1)
    j = requests.get(f"{base}/products/{handle}.json", headers=HEADERS, timeout=20)
    j.raise_for_status()
    product = j.json()["product"]
    title = product["title"]
    variants = product.get("variants", [])
    if not variants:
        raise ValueError("У товара не нашлось вариантов — проверь ссылку.")

    # цена: берём доступный вариант, иначе первый
    chosen = next((v for v in variants if v.get("available")), variants[0])
    price = float(chosen["price"])

    # вес: сначала из Shopify (граммы), потом из текста страницы (lb)
    grams = chosen.get("grams") or 0
    kg_each = grams / 1000 if grams else None
    if not kg_each:
        kg_each = weight_from_page(url)

    available = any(v.get("available") for v in variants)
    name = re.sub(r"\s*\|\s*", " ", title).strip()
    return {
        "name": name,
        "size": size_string(title),
        "price": price,
        "kg_each": kg_each,
        "available": available,
    }


def weight_from_page(url):
    try:
        html = requests.get(url, headers=HEADERS, timeout=20).text
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        m = re.search(r"Weight[:\s]*([\d.]+)\s*lb", text, re.I)
        if m:
            return round(float(m.group(1)) * LB_TO_KG, 4)
    except Exception:
        pass
    return None


# ---------- расчёт ----------
def calculate(p, qty, kg_override=None):
    kg_each = kg_override or p["kg_each"]
    if not kg_each:
        raise ValueError("WEIGHT_UNKNOWN")
    unit = round(p["price"] * MARKUP, 2)
    goods = round(unit * qty, 2)
    total_kg = round(kg_each * qty, 2)
    shipping = round(total_kg * SHIP_PER_KG, 2)
    total = round(goods + shipping, 2)
    return {
        "name": p["name"], "size": p["size"], "qty": qty,
        "unit_price": unit, "goods": goods, "kg_each": kg_each,
        "total_kg": total_kg, "shipping": shipping, "total": total,
        "ship_rate": SHIP_PER_KG,
    }


# ---------- Telegram ----------
bot = telebot.TeleBot(read_token())

WELCOME = (
    "Привет! Кинь ссылку на товар с stanley1913.com — пришлю PDF-просчёт.\n\n"
    "По умолчанию: 30 шт, наценка ×1.5, почта $9/кг.\n"
    "Можно так:\n"
    "• ссылка\n"
    "• ссылка 50  (другое кол-во)\n"
    "• ссылка 50 0.84  (если вес не подтянулся — указать кг/шт)"
)


@bot.message_handler(commands=["start", "help"])
def on_start(msg):
    bot.reply_to(msg, WELCOME)


@bot.message_handler(func=lambda m: True, content_types=["text"])
def on_text(msg):
    url, qty, kg = parse_message(msg.text)
    if not url:
        bot.reply_to(msg, "Пришли ссылку на товар (https://www.stanley1913.com/products/...).")
        return
    note = bot.reply_to(msg, "Считаю… 🔄")
    try:
        product = scrape(url)
        data = calculate(product, qty, kg)
        out = os.path.join(tempfile.gettempdir(), "rozrahunok.pdf")
        build_pdf(data, out)

        cap = (f"{data['name']} — {qty} шт\n"
               f"Товар ${data['goods']:,.0f} · вес {data['total_kg']:.2f} кг · "
               f"почта ${data['shipping']:.2f}\n"
               f"РАЗОМ ${data['total']:,.2f}").replace(",", " ")
        if not product["available"]:
            cap += "\n\n⚠️ Сейчас все цвета Sold Out на сайте."
        with open(out, "rb") as f:
            bot.send_document(msg.chat.id, f, caption=cap, visible_file_name="rozrahunok.pdf")
        bot.delete_message(note.chat.id, note.message_id)
    except ValueError as e:
        if str(e) == "WEIGHT_UNKNOWN":
            bot.edit_message_text(
                "Не удалось определить вес товара. Пришли так:\n"
                "ссылка 30 0.84  (где 0.84 — вес одного, кг)",
                note.chat.id, note.message_id)
        else:
            bot.edit_message_text(f"Ошибка: {e}", note.chat.id, note.message_id)
    except Exception as e:
        bot.edit_message_text(f"Не получилось обработать ссылку: {e}", note.chat.id, note.message_id)


if __name__ == "__main__":
    print("Stanley Quote Bot запущен. Не закрывай это окно. Ctrl+C — остановить.")
    bot.infinity_polling(skip_pending=True)
