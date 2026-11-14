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
import time


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
    # Минимальная задержка: ИИ может передать 0 → ПК уходил в перезагрузку
    # мгновенно, и кнопка «Отмена»/команда /cancel уже не успевали.
    MIN_POWER_DELAY = 20
    MAX_POWER_DELAY = 3600

    @classmethod
    def _clamp_delay(cls, delay_sec) -> int:
        try:
            d = int(delay_sec)
        except (TypeError, ValueError):
            d = 30
        return max(cls.MIN_POWER_DELAY, min(d, cls.MAX_POWER_DELAY))

    def power_pending(self) -> str | None:
        """Что запланировано и ещё не случилось: 'restart' / 'shutdown' / None."""
        until = getattr(self, "_power_until", 0.0)
        if until and time.monotonic() < until:
            return getattr(self, "_power_kind", None)
        return None

    # Коды shutdown.exe (Windows)
    ERR_ALREADY_SCHEDULED = 1190   # «выключение уже запланировано»
    ERR_NOTHING_SCHEDULED = 1116   # «нечего отменять»

    @staticmethod
    def _run(args):
        """subprocess.run с перехватом вывода; вернуть код выхода."""
        r = subprocess.run(args, check=False, capture_output=True)
        return getattr(r, "returncode", 0) or 0

    def _schedule(self, kind: str, delay_sec) -> dict:
        d = self._clamp_delay(delay_sec)
        what = "Перезагрузка" if kind == "restart" else "Выключение"
        try:
            if os.name == "nt":
                # Сначала снять прежний таймер: иначе Windows откажет (1190),
                # а пользователь будет думать, что время поменялось.
                self._run(["shutdown", "/a"])
                flag = "/r" if kind == "restart" else "/s"
                rc = self._run(["shutdown", flag, "/t", str(d)])
            else:
                self._run(["shutdown", "-c"])
                flag = "-r" if kind == "restart" else "-h"
                rc = self._run(["shutdown", flag, f"+{max(1, d // 60)}"])
            if rc != 0:
                self._power_kind, self._power_until = None, 0.0
                return {"ok": False, "message": f"⚠️ Не получилось запланировать: "
                                                f"{what.lower()} (код Windows {rc})."}
            self._power_kind, self._power_until = kind, time.monotonic() + d
            return {"ok": True, "message": f"⏳ {what} через {d} с. Передумал — отправь /cancel."}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка: {type(e).__name__}"}

    def shutdown(self, delay_sec: int = 30) -> dict:
        """ОПАСНО. Вызывать только после подтверждения пользователя."""
        return self._schedule("shutdown", delay_sec)

    def restart(self, delay_sec: int = 30) -> dict:
        """ОПАСНО. Только после подтверждения."""
        return self._schedule("restart", delay_sec)

    def cancel_shutdown(self) -> dict:
        """Отменить выключение/перезагрузку. Спрашиваем саму Windows (shutdown /a),
        а не память бота — так отмена работает и после перезапуска бота."""
        kind = self.power_pending()
        try:
            if os.name == "nt":
                rc = self._run(["shutdown", "/a"])
                nothing = rc == self.ERR_NOTHING_SCHEDULED
            else:
                rc = self._run(["shutdown", "-c"])
                nothing = kind is None
            self._power_kind, self._power_until = None, 0.0
            if nothing:
                return {"ok": False, "nothing": True,
                        "message": "Отменять нечего — выключение/перезагрузка ПК не запланированы."}
            if rc != 0:
                return {"ok": False, "message": f"⚠️ Не получилось отменить (код Windows {rc})."}
            msg = {"restart": "🛑 Перезагрузка отменена.",
                   "shutdown": "🛑 Выключение отменено."}.get(kind, "🛑 Выключение/перезагрузка ПК отменены.")
            return {"ok": True, "message": msg}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка: {type(e).__name__}"}
