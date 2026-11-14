"""
control.py — БЕЗОПАСНОЕ управление ПК.

Принципы (по ТЗ):
  • НИКАКОГО выполнения произвольных shell-команд от AI.
  • Запуск только приложений из белого списка.
  • Завершение только процессов из белого списка.
  • Выключение/перезагрузка — опасные действия, требуют подтверждения
    (гейт подтверждения — на уровне AI Brain / вызывающего кода).
"""
from __future__ import annotations

import os
import subprocess


class SafetyError(Exception):
    """Запрошено действие вне белого списка / запрещённое."""


class ComputerControl:
    def __init__(self, *, allowed_apps: dict[str, str] | None = None,
                 killable: set[str] | None = None):
        # имя → путь/команда запуска (только эти можно запускать)
        self.allowed_apps = {k.lower(): v for k, v in (allowed_apps or {}).items()}
        # какие процессы разрешено завершать (по имени)
        self.killable = {n.lower() for n in (killable or set())}

    # ----------------------- запуск приложения -----------------------
    def launch(self, name: str) -> dict:
        key = (name or "").lower().strip()
        target = self.allowed_apps.get(key)
        if not target:
            raise SafetyError(f"приложение «{name}» не в белом списке")
        try:
            if os.name == "nt":
                os.startfile(target)  # noqa: безопасно — путь из белого списка
            else:
                subprocess.Popen([target], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            return {"ok": True, "message": f"Запустил {name}"}
        except Exception as e:
            return {"ok": False, "message": f"Не удалось запустить: {type(e).__name__}"}

    # ----------------------- завершение процесса -----------------------
    def kill(self, name: str) -> dict:
        key = (name or "").lower().strip()
        if key not in self.killable:
            raise SafetyError(f"процесс «{name}» не разрешён к завершению")
        try:
            import psutil
        except Exception:
            return {"ok": False, "message": "psutil недоступен"}
        killed = 0
        for p in psutil.process_iter(["name"]):
            try:
                if (p.info["name"] or "").lower() == key + (".exe" if os.name == "nt" else ""):
                    p.terminate(); killed += 1
                elif (p.info["name"] or "").lower() == key:
                    p.terminate(); killed += 1
            except Exception:
                pass
        return {"ok": killed > 0, "message": f"Завершено процессов: {killed}"}

    # ----------------------- питание (ОПАСНО) -----------------------
    def shutdown(self, delay_sec: int = 30) -> dict:
        """ОПАСНО. Вызывать только после подтверждения пользователя."""
        try:
            if os.name == "nt":
                subprocess.run(["shutdown", "/s", "/t", str(delay_sec)], check=False)
            else:
                subprocess.run(["shutdown", "-h", f"+{max(1, delay_sec // 60)}"], check=False)
            return {"ok": True, "message": f"Выключение через {delay_sec} с (отмена: /cancel)"}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка: {type(e).__name__}"}

    def cancel_shutdown(self) -> dict:
        try:
            if os.name == "nt":
                subprocess.run(["shutdown", "/a"], check=False)
            else:
                subprocess.run(["shutdown", "-c"], check=False)
            return {"ok": True, "message": "Выключение отменено"}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка: {type(e).__name__}"}

    def restart(self, delay_sec: int = 30) -> dict:
        """ОПАСНО. Только после подтверждения."""
        try:
            if os.name == "nt":
                subprocess.run(["shutdown", "/r", "/t", str(delay_sec)], check=False)
            else:
                subprocess.run(["shutdown", "-r", f"+{max(1, delay_sec // 60)}"], check=False)
            return {"ok": True, "message": f"Перезагрузка через {delay_sec} с"}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка: {type(e).__name__}"}
