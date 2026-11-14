"""
audit.py — журнал действий (кто, что, над чем, успех/ошибка).

Все заметные действия (команды устройствам, автоматизации, операции с ПК,
изменения памяти) пишутся в таблицу audit_logs. Секреты вычищаются перед
записью — токены/ключи в журнал не попадают.
"""
from __future__ import annotations

import re
import json
import time
from typing import Any

# Шаблоны секретов, которые НЕ должны попасть в журнал/логи.
_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),              # OpenAI-ключи
    re.compile(r"\b\d{6,}:[A-Za-z0-9_\-]{25,}\b"),      # Telegram-токены
    re.compile(r"(?i)(api[_-]?key|token|password|secret)\s*[=:]\s*\S+"),
]


def redact(value: Any) -> Any:
    """Заменить любые секреты в строке/структуре на [REDACTED]."""
    if isinstance(value, str):
        out = value
        for pat in _SECRET_PATTERNS:
            out = pat.sub("[REDACTED]", out)
        return out
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def audit(db, action: str, *, user_id: int | None = None,
          target: str | None = None, detail: Any = None, ok: bool = True) -> None:
    """Записать действие в журнал. Никогда не бросает исключение наружу."""
    try:
        clean = redact(detail)
        detail_json = json.dumps(clean, ensure_ascii=False) if clean is not None else None
        db.insert("audit_logs", {
            "user_id": user_id,
            "action": action,
            "target": target,
            "detail": detail_json,
            "ok": 1 if ok else 0,
            "created_at": time.time(),
        })
    except Exception:
        pass
