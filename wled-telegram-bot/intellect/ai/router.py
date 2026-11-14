"""
router.py — маршрутизация моделей.

Правило: простая команда → быстрая дешёвая модель; сложный анализ → мощная.
Плюс запасная цепочка моделей на случай ошибки основной.
"""
from __future__ import annotations

import re


class ModelRouter:
    def __init__(self, fast: str, strong: str):
        self.fast = fast
        self.strong = strong

    def classify(self, text: str) -> str:
        """Грубая оценка сложности запроса: 'simple' | 'complex'."""
        t = (text or "").lower()
        if len(t) > 220:
            return "complex"
        # признаки сложной задачи
        if re.search(r"проанализ|сравни|объясни почему|составь план|почему|"
                     r"напиши код|разбери|стратег|пошагов|подробно", t):
            return "complex"
        # несколько действий в одной фразе
        if t.count(" и ") >= 2 or t.count(",") >= 3:
            return "complex"
        return "simple"

    def choose(self, text: str = "", *, force: str | None = None) -> str:
        if force in ("fast", "simple"):
            return self.fast
        if force in ("strong", "complex"):
            return self.strong
        return self.strong if self.classify(text) == "complex" else self.fast

    def fallback_chain(self, text: str = "") -> list[str]:
        """Порядок попыток: выбранная модель, затем вторая как запас."""
        primary = self.choose(text)
        other = self.fast if primary == self.strong else self.strong
        # убираем дубли, сохраняя порядок
        seen, chain = set(), []
        for m in (primary, other):
            if m and m not in seen:
                seen.add(m)
                chain.append(m)
        return chain
