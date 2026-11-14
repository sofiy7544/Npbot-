#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
panel_link.py — текст команды /panel: где открыть панель INTELLECT.

С 2.4.0 панель работает ТОЛЬКО в домашней сети (http://<IP ПК>:8090):
без туннеля, без сайта в интернете и без публикации адреса на GitHub.
"""
from __future__ import annotations

import html as _h


def panel_message(*, lan_url: str | None, password: str | None) -> str:
    """Текст для команды /panel (HTML Telegram)."""
    lines = ["🖥 <b>Панель INTELLECT</b>"]
    if lan_url:
        lines.append(f"🏠 Дома, по Wi-Fi: {_h.escape(lan_url)}")
    else:
        lines.append("Панель сейчас не запущена.")
    if password:
        lines.append(f"🔑 Пароль: <code>{_h.escape(password)}</code>")
    lines.append("Работает только в домашней сети — из интернета панель недоступна.")
    return "\n".join(lines)
