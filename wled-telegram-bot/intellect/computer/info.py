"""
info.py — диагностика ПК (без секретов и личных файлов).

CPU, память, диски, сеть, топ процессов, аптайм. Использует psutil, если есть;
иначе — стандартная библиотека с деградацией. Кроссплатформенно (работает и на
Linux для тестов, и на целевом Windows).
"""
from __future__ import annotations

import os
import shutil
import socket
import platform
import time


def _human(n: float) -> str:
    for u in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} ПБ"


def collect(top_processes: int = 10) -> dict:
    data: dict = {
        "host": socket.gethostname(),
        "os": platform.platform(),
        "arch": platform.machine(),
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    try:
        import psutil
        data["cpu"] = {
            "percent": psutil.cpu_percent(interval=0.2),
            "cores": psutil.cpu_count(logical=False),
            "threads": psutil.cpu_count(logical=True),
        }
        vm = psutil.virtual_memory()
        data["memory"] = {
            "total": _human(vm.total), "used": _human(vm.used),
            "free": _human(vm.available), "percent": vm.percent,
        }
        try:
            data["uptime_hours"] = round((time.time() - psutil.boot_time()) / 3600, 1)
        except Exception:
            pass
        procs = []
        for p in psutil.process_iter(["name", "pid", "memory_info"]):
            try:
                procs.append((p.info["name"], p.info["pid"],
                              p.info["memory_info"].rss))
            except Exception:
                pass
        procs.sort(key=lambda x: x[2], reverse=True)
        data["top_processes"] = [
            {"name": n, "pid": pid, "mem_mb": round(m / 1048576, 1)}
            for n, pid, m in procs[:top_processes]]
    except Exception:
        data["cpu"] = {"percent": None}
        data["memory"] = {"note": "psutil не установлен"}
        data["top_processes"] = []

    disks = {}
    drives = ([f"{c}:\\" for c in "CDEFGH" if os.path.exists(f"{c}:\\")]
              if os.name == "nt" else ["/"])
    for dv in drives:
        try:
            t, u, f = shutil.disk_usage(dv)
            disks[dv] = {"total": _human(t), "used": _human(u),
                         "free": _human(f), "percent": round(u / t * 100, 1)}
        except Exception:
            pass
    data["disks"] = disks

    try:
        data["local_ip"] = _primary_ip()
    except Exception:
        pass
    return data


def _primary_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def quick_summary() -> str:
    d = collect(top_processes=5)
    cpu = d.get("cpu", {}).get("percent")
    mem = d.get("memory", {})
    lines = [f"🖥 {d.get('host')} — {d.get('os')}"]
    if cpu is not None:
        lines.append(f"CPU: {cpu}%  |  RAM: {mem.get('used')}/{mem.get('total')} ({mem.get('percent')}%)")
    for dv, v in (d.get("disks") or {}).items():
        lines.append(f"Диск {dv} свободно {v['free']} из {v['total']}")
    if d.get("uptime_hours") is not None:
        lines.append(f"Аптайм: {d['uptime_hours']} ч")
    return "\n".join(lines)
