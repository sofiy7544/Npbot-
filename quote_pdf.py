# -*- coding: utf-8 -*-
"""Генератор PDF-просчёта в стиле карточки Stanley (украинский)."""
import os
from fpdf import FPDF

# --- поиск кириллического шрифта (Windows -> Arial, иначе DejaVu) ---
def _font_paths():
    candidates = [
        (r"C:\Windows\Fonts\arial.ttf",  r"C:\Windows\Fonts\arialbd.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for reg, bold in candidates:
        if os.path.exists(reg) and os.path.exists(bold):
            return reg, bold
    raise RuntimeError("Не найден шрифт с кириллицей (Arial / DejaVuSans)")

# палитра
GREEN  = (31, 59, 44)
CREAM  = (244, 242, 236)
WHITE  = (255, 255, 255)
INK    = (21, 33, 26)
GREY   = (95, 90, 77)
LINE   = (236, 233, 224)
GOLD   = (167, 192, 168)

def _money(x):
    s = f"{x:,.2f}".replace(",", " ")
    if s.endswith(".00"):
        s = s[:-3]
    return "$" + s

def build_pdf(data: dict, out_path: str):
    """data: name, size, qty, unit_price, goods, kg_each, total_kg, shipping, total, ship_rate"""
    reg, bold = _font_paths()
    W, H = 110, 150  # мм, формат карточки
    pdf = FPDF(orientation="P", unit="mm", format=(W, H))
    pdf.set_auto_page_break(False)
    pdf.add_font("U", "", reg)
    pdf.add_font("U", "B", bold)
    pdf.add_page()

    # фон
    pdf.set_fill_color(*CREAM)
    pdf.rect(0, 0, W, H, style="F")

    m = 8
    cw = W - 2 * m
    # карточка
    pdf.set_fill_color(*WHITE)
    pdf.rect(m, m, cw, H - 2 * m, style="F", round_corners=True, corner_radius=4)

    x = m + 7
    y = m + 9
    rx = W - m - 7  # правый край контента

    # шапка: бренд + бейдж кол-ва
    pdf.set_xy(x, y)
    pdf.set_font("U", "B", 7.5)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 4, "@STANLEY_BRAND_UA")
    # бейдж
    badge = f"{data['qty']} шт"
    pdf.set_font("U", "B", 8)
    bw = pdf.get_string_width(badge) + 8
    pdf.set_fill_color(*GREEN)
    pdf.rect(rx - bw, y - 1, bw, 7, style="F", round_corners=True, corner_radius=3)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(rx - bw, y - 0.5)
    pdf.cell(bw, 6, badge, align="C")

    # подзаголовок
    y += 10
    pdf.set_xy(x, y)
    pdf.set_font("U", "B", 7)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 4, "ПОПЕРЕДНІЙ РОЗРАХУНОК")

    # название товара
    y += 6
    pdf.set_xy(x, y)
    pdf.set_font("U", "B", 15)
    pdf.set_text_color(*INK)
    pdf.multi_cell(cw - 14, 7, data["name"])
    y = pdf.get_y() + 1

    # спецификация
    pdf.set_xy(x, y)
    pdf.set_font("U", "", 7.5)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 4, data.get("size", ""))
    y += 8

    # строки
    rows = [
        ("Кількість", f"{data['qty']} шт"),
        ("Вартість товару", _money(data["goods"])),
        ("Загальна вага", f"{data['total_kg']:.2f} кг".replace('.', ',')),
        (f"Доставка · пошта (${data['ship_rate']:.0f} / кг)", _money(data["shipping"])),
    ]
    for k, v in rows:
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.2)
        pdf.line(x, y, rx, y)
        yy = y + 3
        pdf.set_xy(x, yy)
        pdf.set_font("U", "", 9)
        pdf.set_text_color(*GREY)
        pdf.cell(0, 6, k)
        pdf.set_font("U", "B", 10)
        pdf.set_text_color(*INK)
        pdf.set_xy(x, yy)
        pdf.cell(rx - x, 6, v, align="R")
        y += 11

    # итог-блок
    y += 2
    bh = 16
    pdf.set_fill_color(*GREEN)
    pdf.rect(x, y, rx - x, bh, style="F", round_corners=True, corner_radius=3)
    pdf.set_xy(x + 5, y + 3)
    pdf.set_font("U", "B", 7.5)
    pdf.set_text_color(*GOLD)
    pdf.cell(0, 4, "РАЗОМ ДО СПЛАТИ")
    pdf.set_xy(x, y + 5.5)
    pdf.set_font("U", "B", 17)
    pdf.set_text_color(*WHITE)
    pdf.cell(rx - x - 5, 8, _money(data["total"]), align="R")
    y += bh + 6

    # сноска
    pdf.set_xy(x, y)
    pdf.set_font("U", "", 6.8)
    pdf.set_text_color(150, 147, 132)
    pdf.multi_cell(cw - 14, 3.4,
        "Розрахунок попередній. Фінальна сума залежить від фактичної ваги "
        "посилки після пакування та курсу на день оплати.")

    pdf.output(out_path)
    return out_path


if __name__ == "__main__":
    sample = {
        "name": "Classic Legendary Bottle 1.0 QT",
        "size": "Об'єм 0.95 л · сталь 18/8 · вакуумна ізоляція",
        "qty": 30,
        "unit_price": 58.50,
        "goods": 1755.0,
        "kg_each": 0.635,
        "total_kg": 19.05,
        "shipping": 171.45,
        "total": 1926.45,
        "ship_rate": 9,
    }
    build_pdf(sample, "/home/claude/test_quote.pdf")
    print("PDF готов")
