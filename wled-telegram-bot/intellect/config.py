"""
config.py — централизованная конфигурация INTELLECT.

Все настройки берутся из переменных окружения (файл .env). Секреты (токены,
ключи) НИКОГДА не попадают в логи/repr — для них отдельный тип Secret с маской.

Использование:
    from intellect.config import settings
    settings.openai_api_key.get()      # явный доступ к значению секрета
    settings.ai_model_fast             # обычные значения
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path

# Корень проекта (папка, где лежат .env, wled_bot.py и пакет intellect/).
ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path | None = None) -> None:
    """Простая загрузка .env рядом с проектом (без внешних зависимостей)."""
    path = path or (ROOT / ".env")
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    except Exception:
        pass


class Secret:
    """Обёртка над секретом: значение доступно только через .get(),
    а в логах/repr/str показывается маска — чтобы ключи не утекали."""

    __slots__ = ("_value",)

    def __init__(self, value: str | None):
        self._value = value or ""

    def get(self) -> str:
        return self._value

    def __bool__(self) -> bool:
        return bool(self._value)

    def masked(self) -> str:
        v = self._value
        if not v:
            return "<пусто>"
        return f"{v[:4]}…{v[-2:]}" if len(v) > 8 else "<скрыто>"

    def __repr__(self) -> str:
        return f"Secret({self.masked()})"

    __str__ = __repr__


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _env_ids(name: str) -> tuple[int, ...]:
    raw = os.environ.get(name, "").replace(" ", "")
    out = []
    for part in raw.split(","):
        if part:
            try:
                out.append(int(part))
            except ValueError:
                pass
    return tuple(out)


@dataclass(frozen=True)
class Settings:
    # --- Telegram ---
    bot_token: Secret
    allowed_users: tuple[int, ...]
    access_password: str

    # --- AI (облако) ---
    openai_api_key: Secret
    ai_model_fast: str          # простые задачи
    ai_model_strong: str        # сложный анализ
    ai_model_embed: str         # эмбеддинги для памяти
    ai_model_stt: str           # распознавание речи (Whisper)
    ai_enabled: bool

    # --- Устройства ---
    wled_ip: str
    samsung_tv_ip: str

    # --- Веб-панель ---
    web_port: int

    # --- Данные ---
    db_path: str

    def describe(self) -> str:
        """Безопасное описание конфигурации (секреты замаскированы) — для логов."""
        lines = ["Конфигурация INTELLECT:"]
        for f in fields(self):
            val = getattr(self, f.name)
            shown = val.masked() if isinstance(val, Secret) else val
            lines.append(f"  {f.name} = {shown}")
        return "\n".join(lines)


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        bot_token=Secret(_env("WLED_BOT_TOKEN") or _env("TG_BOT_TOKEN") or _env("BOT_TOKEN")),
        allowed_users=_env_ids("ALLOWED_USERS"),
        access_password=_env("ACCESS_PASSWORD", "5750"),
        openai_api_key=Secret(_env("OPENAI_API_KEY") or _env("AI_KEY")),
        ai_model_fast=_env("AI_MODEL_FAST") or _env("AI_MODEL", "gpt-4o-mini"),
        ai_model_strong=_env("AI_MODEL_STRONG", "gpt-4o"),
        ai_model_embed=_env("AI_MODEL_EMBED", "text-embedding-3-small"),
        ai_model_stt=_env("AI_MODEL_STT", "whisper-1"),
        ai_enabled=bool(_env("OPENAI_API_KEY") or _env("AI_KEY")),
        wled_ip=_env("WLED_IP", "192.168.1.106"),
        samsung_tv_ip=_env("SAMSUNG_TV_IP"),
        web_port=_env_int("WEB_PORT", 8080),
        db_path=_env("DB_PATH") or str(ROOT / "intellect.db"),
    )


# Единый экземпляр настроек на процесс.
settings = load_settings()
