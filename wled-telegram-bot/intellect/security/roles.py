"""
roles.py — роли и подтверждение опасных действий.

Роли: admin (полный доступ), user (устройства/память/задачи, без системных
операций). Опасные действия требуют явного подтверждения пользователем.
"""
from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    USER = "user"


# Действия, которые НЕЛЬЗЯ выполнять без явного подтверждения пользователя.
DANGEROUS_ACTIONS = {
    "computer.shutdown",
    "computer.restart",
    "computer.kill_process",
    "computer.run_command",
    "files.delete",
    "network.change",
    "memory.wipe",
    "devices.bulk",
}


def is_admin(role: str | None) -> bool:
    return role == Role.ADMIN.value


def require_confirmation(action: str) -> bool:
    """True, если действие требует подтверждения перед выполнением."""
    return action in DANGEROUS_ACTIONS
