#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор оформления для WLED-бота: иконка приложения и баннер.
Стиль совпадает с веб-приложением (тёмный фон, фиолетовый акцент #7c5cff).

Запуск:  python assets/make_assets.py
Создаёт: assets/app-icon.png (1024²), assets/cover.png (1280×640),
         assets/icon-192.png, assets/icon-512.png (для PWA-манифеста).
"""
from __future__ import annotations
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent

# Палитра из webapp.py
BG1 = (14, 14, 23)       # #0e0e17
BG0 = (7, 7, 12)         # #07070c
ACC = (124, 92, 255)     # #7c5cff
ACC2 = (157, 123, 255)   # #9d7bff
WARM = (255, 209, 127)   # тёплый свет лампы
INK = (240, 240, 246)
MUT = (144, 144, 168)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def vgrad(w, h, top, bottom):
    """Вертикальный градиент."""
    img = Image.new("RGB", (w, h), top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img


def radial_glow(size, center, radius, color, strength=1.0):
    """Мягкое радиальное свечение (RGBA), чтобы накладывать поверх фона."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    cx, cy = center
    ImageDraw.Draw(layer).ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=color + (int(255 * strength),))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.55))


def over(base_rgb: Image.Image, layer_rgba: Image.Image) -> Image.Image:
    """Наложить RGBA-слой на RGB-основу, вернуть RGB."""
    return Image.alpha_composite(base_rgb.convert("RGBA"), layer_rgba).convert("RGB")


def draw_bulb(base: Image.Image, cx: int, cy: int, R: int, glow=True) -> Image.Image:
    """Светящаяся лампочка с нитью накала и «умными» дугами-сигналом.
    Рисует поверх base (RGB) и возвращает новый RGB-кадр."""
    # Ореол: фиолетовый рим шире, тёплый центр — поверх
    if glow:
        base = over(base, radial_glow(base.size, (cx, cy), int(R * 2.4), ACC, 0.30))
        base = over(base, radial_glow(base.size, (cx, cy), int(R * 1.7), WARM, 0.34))

    d = ImageDraw.Draw(base)
    # «Умные» дуги (как Wi-Fi) над лампой — намёк на управление по сети
    for rr in (int(R * 1.7), int(R * 2.1)):
        d.arc([cx - rr, cy - rr, cx + rr, cy + rr], start=-150, end=-30,
              fill=ACC2, width=max(4, R // 22))

    # Стеклянная колба: градиентный шар (тёплый центр → акцентный край)
    glass = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glass)
    for i in range(R, 0, -1):
        t = i / R
        col = tuple(int(WARM[k] + (ACC[k] - WARM[k]) * (t ** 1.5)) for k in range(3))
        gd.ellipse([cx - i, cy - i, cx + i, cy + i], fill=col + (255,))
    gd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(255, 255, 255, 70), width=max(3, R // 26))
    base = over(base, glass)

    d = ImageDraw.Draw(base)
    # Нить накала
    fw = max(3, R // 16)
    fil = (255, 244, 220)
    top = cy - int(R * 0.34)
    d.line([(cx - int(R * 0.34), cy + int(R * 0.30)), (cx - int(R * 0.30), top)], fill=fil, width=fw)
    d.line([(cx + int(R * 0.34), cy + int(R * 0.30)), (cx + int(R * 0.30), top)], fill=fil, width=fw)
    d.arc([cx - int(R * 0.30), top - int(R * 0.22), cx + int(R * 0.30), top + int(R * 0.22)],
          start=180, end=360, fill=fil, width=fw)
    # блик на стекле
    hb = [cx - int(R * 0.52), cy - int(R * 0.58), cx - int(R * 0.20), cy - int(R * 0.26)]
    d.ellipse(hb, fill=(255, 255, 255, 255))

    # Цоколь (металлические кольца)
    bw = int(R * 0.52)
    by = cy + int(R * 0.88)
    d.rounded_rectangle([cx - bw, by, cx + bw, by + int(R * 0.32)], radius=max(2, R // 14), fill=(154, 154, 170))
    for k in range(3):
        yy = by + int(R * 0.07) + k * int(R * 0.09)
        d.line([(cx - bw, yy), (cx + bw, yy)], fill=(92, 92, 108), width=max(3, R // 30))
    d.rounded_rectangle([cx - int(bw * 0.55), by + int(R * 0.32), cx + int(bw * 0.55), by + int(R * 0.50)],
                        radius=max(2, R // 18), fill=(112, 112, 128))
    return base


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0], size[1]], radius=radius, fill=255)
    return m


def make_icon(side=1024):
    img = vgrad(side, side, BG1, BG0).convert("RGB")
    # фиолетовое сияние сверху
    img.paste(Image.alpha_composite(img.convert("RGBA"),
              radial_glow((side, side), (side // 2, int(side * 0.12)), int(side * 0.5), ACC, 0.22)
              ).convert("RGB"), (0, 0))
    img = draw_bulb(img, side // 2, int(side * 0.46), int(side * 0.26))
    # скруглить углы (красиво и на Android; iOS скруглит сам)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask((side, side), int(side * 0.22)))
    out.save(HERE / "app-icon.png")
    out.resize((512, 512), Image.LANCZOS).save(HERE / "icon-512.png")
    out.resize((192, 192), Image.LANCZOS).save(HERE / "icon-192.png")
    return HERE / "app-icon.png"


def make_cover(w=1280, h=640):
    img = vgrad(w, h, BG1, BG0).convert("RGB")
    img.paste(Image.alpha_composite(img.convert("RGBA"),
              radial_glow((w, h), (int(w * 0.26), int(h * 0.5)), int(h * 0.7), ACC, 0.20)
              ).convert("RGB"), (0, 0))
    # лампа слева
    img = draw_bulb(img, int(w * 0.24), int(h * 0.50), int(h * 0.28))

    d = ImageDraw.Draw(img)
    x = int(w * 0.46)
    d.text((x, int(h * 0.26)), "INTELLECT", font=font(FONT_BOLD, 92), fill=INK)
    # акцентная черта
    d.rounded_rectangle([x + 4, int(h * 0.44), x + 250, int(h * 0.44) + 10], radius=5, fill=ACC)
    d.text((x, int(h * 0.50)), "Умный свет и телевизор", font=font(FONT_REG, 40), fill=(210, 210, 224))
    d.text((x, int(h * 0.60)), "из Telegram — голосом и текстом", font=font(FONT_REG, 34), fill=MUT)

    # чипы-возможности (компактно, чтобы влезли по ширине)
    chips = ["Свет", "Эффекты", "ТВ", "Голос"]
    cx = x
    cy = int(h * 0.74)
    f = font(FONT_BOLD, 25)
    pad, gap, hgt = 18, 13, 48
    for c in chips:
        tw = d.textlength(c, font=f)
        d.rounded_rectangle([cx, cy, cx + tw + pad * 2, cy + hgt], radius=hgt // 2,
                            fill=(27, 27, 39), outline=(48, 44, 70), width=2)
        d.text((cx + pad, cy + 11), c, font=f, fill=ACC2)
        cx += int(tw + pad * 2 + gap)
    img.save(HERE / "cover.png")
    return HERE / "cover.png"


if __name__ == "__main__":
    i = make_icon()
    c = make_cover()
    print("OK:", i, c)
