"""
render.py — рисует текущее состояние лампы картинкой (PNG).

Это визуальная обратная связь для симулятора: видно цвет и яркость свечения.
Если Pillow не установлен — функция вернёт None, и бот просто не пришлёт фото.
"""

from __future__ import annotations

from pathlib import Path

from lamp import LampState, display_rgb


def render_lamp(state: LampState, path: str | Path) -> str | None:
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except Exception:
        return None

    W = H = 480
    bg = (18, 18, 22)
    img = Image.new("RGB", (W, H), bg)

    glow = display_rgb(state)
    cx, cy = W // 2, H // 2 - 10

    if state.power:
        # Слой свечения: яркий круг + сильное размытие = мягкий ореол
        halo = Image.new("RGB", (W, H), bg)
        hd = ImageDraw.Draw(halo)
        radius = 70 + int(state.brightness * 1.1)
        hd.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=glow)
        halo = halo.filter(ImageFilter.GaussianBlur(45))
        img = Image.blend(img, halo, 0.85)

    draw = ImageDraw.Draw(img)

    # Колба лампы
    bulb_r = 70
    bulb_fill = glow if state.power else (46, 46, 52)
    draw.ellipse([cx - bulb_r, cy - bulb_r, cx + bulb_r, cy + bulb_r],
                 fill=bulb_fill, outline=(90, 90, 100), width=3)
    # Цоколь
    draw.rectangle([cx - 26, cy + bulb_r - 6, cx + 26, cy + bulb_r + 34],
                   fill=(70, 70, 78), outline=(100, 100, 110), width=2)
    for i in range(3):
        y = cy + bulb_r + 2 + i * 9
        draw.line([cx - 26, y, cx + 26, y], fill=(120, 120, 128), width=2)

    # Подпись состояния
    label = ("💡 " + state.human()) if state.power else "⚫ выключена"
    draw.text((20, H - 34), label, fill=(210, 210, 220))

    out = str(path)
    img.save(out, "PNG")
    return out
