#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pc_report.py — диагностика ПК для оптимизации (Windows, безопасная).

ЧТО СОБИРАЕТ (только техническое, для ускорения ПК):
  • ОС, версия/сборка, аптайм, модель ПК, BIOS
  • процессор, память (сколько занято), видеокарта
  • диски: сколько занято/свободно; где «съедено» место (temp, кэши, корзина,
    размеры папок профиля — ТОЛЬКО размеры в байтах, без имён и содержимого)
  • автозапуск: программы в реестре Run, папка «Автозагрузка», задачи при входе
  • процессы: топ по памяти (только имена, без содержимого)
  • службы с автозапуском, план питания и настройки сна
  • установленные программы (имя/версия) — чтобы увидеть лишнее

ЧЕГО НЕ ДЕЛАЕТ (намеренно):
  ✗ не открывает и не копирует твои файлы, фото, документы
  ✗ не читает пароли, браузер, куки, переписку, ключи
  ✗ ничего никуда не отправляет — только пишет локальный отчёт

Результат — файл pc-reports/pc-report_<имя>_<дата>.json (+ .txt кратко).
Ты сам его смотришь и сам решаешь, присылать ли. Запуск: python pc_report.py
"""
from __future__ import annotations

import os
import sys
import json
import time
import shutil
import socket
import getpass
import platform
import subprocess
from datetime import datetime
from pathlib import Path

VERSION = "1.0"
IS_WIN = os.name == "nt"
OUT_DIR = Path(__file__).resolve().parent / "pc-reports"


# ───────────────────────── помощники ─────────────────────────
def run(cmd, timeout=25) -> str:
    """Выполнить команду, вернуть stdout (ошибки гасим)."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="ignore")
        return (p.stdout or "").strip()
    except Exception as e:
        return f"__err__: {e}"


def ps(script: str, depth: int = 4):
    """PowerShell -> объект Python через ConvertTo-Json. None при ошибке."""
    if not IS_WIN:
        return None
    out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
               f"{script} | ConvertTo-Json -Depth {depth} -Compress"], timeout=40)
    if not out or out.startswith("__err__"):
        return None
    try:
        return json.loads(out)
    except Exception:
        return None


def human(n: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} ПБ"


def dir_size(path: str, deadline: float = 8.0) -> dict:
    """Суммарный размер папки (только числа). С ограничением по времени,
    чтобы не сканировать вечно большие деревья. Имена файлов НЕ сохраняются."""
    total, files = 0, 0
    stop = time.time() + deadline
    approx = False
    try:
        for root, dirs, fnames in os.walk(path):
            if time.time() > stop:
                approx = True
                break
            for f in fnames:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                    files += 1
                except OSError:
                    pass
    except Exception:
        pass
    return {"bytes": total, "human": human(total), "files": files, "approx": approx}


# ───────────────────────── секции сбора ─────────────────────────
def sec_meta() -> dict:
    return {
        "report_version": VERSION,
        "created": datetime.now().isoformat(timespec="seconds"),
        "hostname": socket.gethostname(),
        "user": getpass.getuser(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }


def sec_os() -> dict:
    d = {"system": platform.system(), "release": platform.release(),
         "version": platform.version(), "arch": platform.machine()}
    if IS_WIN:
        info = ps("Get-CimInstance Win32_OperatingSystem | "
                  "Select-Object Caption,Version,BuildNumber,OSArchitecture,"
                  "LastBootUpTime,FreePhysicalMemory,TotalVisibleMemorySize")
        if isinstance(info, dict):
            d["edition"] = info.get("Caption")
            d["build"] = info.get("BuildNumber")
            boot = info.get("LastBootUpTime")
            d["last_boot"] = str(boot) if boot else None
    try:
        d["uptime_hours"] = round((time.time() - _boot_time()) / 3600, 1)
    except Exception:
        pass
    return d


def _boot_time() -> float:
    if IS_WIN:
        out = run(["powershell", "-NoProfile", "-Command",
                   "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToFileTimeUtc()"])
        try:
            # FILETIME -> unix
            return int(out) / 1e7 - 11644473600
        except Exception:
            pass
    try:
        with open("/proc/uptime") as f:
            return time.time() - float(f.read().split()[0])
    except Exception:
        return time.time()


def sec_hardware() -> dict:
    d = {"cpu": platform.processor()}
    if IS_WIN:
        cpu = ps("Get-CimInstance Win32_Processor | Select-Object Name,"
                 "NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed")
        if cpu:
            c = cpu[0] if isinstance(cpu, list) else cpu
            d["cpu"] = c.get("Name", d["cpu"])
            d["cores"] = c.get("NumberOfCores")
            d["threads"] = c.get("NumberOfLogicalProcessors")
            d["mhz"] = c.get("MaxClockSpeed")
        sysm = ps("Get-CimInstance Win32_ComputerSystem | "
                  "Select-Object Manufacturer,Model,TotalPhysicalMemory")
        if isinstance(sysm, dict):
            d["model"] = f"{sysm.get('Manufacturer','')} {sysm.get('Model','')}".strip()
            if sysm.get("TotalPhysicalMemory"):
                d["ram_total"] = human(int(sysm["TotalPhysicalMemory"]))
        gpu = ps("Get-CimInstance Win32_VideoController | Select-Object Name,"
                 "AdapterRAM,DriverVersion")
        if gpu:
            gpus = gpu if isinstance(gpu, list) else [gpu]
            d["gpu"] = [g.get("Name") for g in gpus if g.get("Name")]
        bios = ps("Get-CimInstance Win32_BIOS | Select-Object Manufacturer,"
                  "SMBIOSBIOSVersion,ReleaseDate")
        if isinstance(bios, dict):
            d["bios"] = f"{bios.get('Manufacturer','')} {bios.get('SMBIOSBIOSVersion','')}".strip()
    return d


def sec_memory() -> dict:
    if IS_WIN:
        m = ps("Get-CimInstance Win32_OperatingSystem | Select-Object "
               "TotalVisibleMemorySize,FreePhysicalMemory")
        if isinstance(m, dict) and m.get("TotalVisibleMemorySize"):
            total = int(m["TotalVisibleMemorySize"]) * 1024
            free = int(m.get("FreePhysicalMemory", 0)) * 1024
            used = total - free
            return {"total": human(total), "used": human(used),
                    "free": human(free), "used_percent": round(used / total * 100, 1)}
    try:
        import psutil
        v = psutil.virtual_memory()
        return {"total": human(v.total), "used": human(v.used),
                "free": human(v.available), "used_percent": v.percent}
    except Exception:
        return {"note": "нет данных (psutil не установлен)"}


def sec_disks() -> dict:
    disks = {}
    if IS_WIN:
        import string
        drives = [f"{c}:\\" for c in string.ascii_uppercase
                  if os.path.exists(f"{c}:\\")]
    else:
        drives = ["/"]
    for dv in drives:
        try:
            t, u, f = shutil.disk_usage(dv)
            disks[dv] = {"total": human(t), "used": human(u), "free": human(f),
                         "used_percent": round(u / t * 100, 1)}
        except Exception:
            pass
    return disks


def sec_storage_hotspots() -> dict:
    """Где «съедено» место — ТОЛЬКО размеры, без имён файлов."""
    spots = {}
    if IS_WIN:
        up = os.environ.get("USERPROFILE", "")
        candidates = {
            "TEMP (пользователь)": os.environ.get("TEMP", ""),
            "Windows\\Temp": r"C:\Windows\Temp",
            "Обновления Windows": r"C:\Windows\SoftwareDistribution\Download",
            "Downloads": os.path.join(up, "Downloads"),
            "Desktop": os.path.join(up, "Desktop"),
            "Documents": os.path.join(up, "Documents"),
            "Pictures (фото)": os.path.join(up, "Pictures"),
            "Videos": os.path.join(up, "Videos"),
        }
    else:
        home = os.path.expanduser("~")
        candidates = {"/tmp": "/tmp", "Downloads": os.path.join(home, "Downloads")}
    for name, path in candidates.items():
        if path and os.path.isdir(path):
            spots[name] = {"path": path, **dir_size(path)}
    return spots


def sec_top_processes(limit: int = 15) -> list:
    """Топ процессов по памяти. Только имена и цифры."""
    if IS_WIN:
        data = ps(f"Get-Process | Sort-Object WorkingSet64 -Descending | "
                  f"Select-Object -First {limit} Name,Id,"
                  f"@{{N='MemMB';E={{[math]::Round($_.WorkingSet64/1MB,1)}}}}")
        if data:
            data = data if isinstance(data, list) else [data]
            return [{"name": p.get("Name"), "pid": p.get("Id"),
                     "mem_mb": p.get("MemMB")} for p in data]
    try:
        import psutil
        procs = []
        for p in psutil.process_iter(["name", "pid", "memory_info"]):
            try:
                procs.append((p.info["name"], p.info["pid"],
                              p.info["memory_info"].rss))
            except Exception:
                pass
        procs.sort(key=lambda x: x[2], reverse=True)
        return [{"name": n, "pid": pid, "mem_mb": round(m / 1048576, 1)}
                for n, pid, m in procs[:limit]]
    except Exception:
        return [{"note": "нет данных"}]


def sec_startup() -> dict:
    """Автозапуск — главный рычаг для 'всегда включённого' ПК."""
    if not IS_WIN:
        return {"note": "только Windows"}
    out = {}
    reg = ps(r"""
      $keys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
      )
      $r=@()
      foreach($k in $keys){ if(Test-Path $k){
        (Get-Item $k).Property | ForEach-Object {
          $r += [pscustomobject]@{Key=$k;Name=$_;Value=(Get-ItemProperty $k).$_}
        }}}
      $r""")
    if reg:
        out["registry_run"] = reg if isinstance(reg, list) else [reg]
    tasks = ps(r"""Get-ScheduledTask | Where-Object {$_.State -ne 'Disabled' -and
        ($_.Triggers.CimClass.CimClassName -match 'Logon|Boot')} |
        Select-Object TaskName,TaskPath""")
    if tasks:
        out["logon_tasks"] = tasks if isinstance(tasks, list) else [tasks]
    folder = os.path.join(os.environ.get("APPDATA", ""),
                          r"Microsoft\Windows\Start Menu\Programs\Startup")
    if os.path.isdir(folder):
        try:
            out["startup_folder"] = [f for f in os.listdir(folder)
                                     if not f.lower().endswith(".ini")]
        except Exception:
            pass
    return out


def sec_services() -> list:
    if not IS_WIN:
        return [{"note": "только Windows"}]
    data = ps("Get-CimInstance Win32_Service | Where-Object "
              "{$_.StartMode -eq 'Auto'} | Select-Object Name,DisplayName,State")
    if data:
        data = data if isinstance(data, list) else [data]
        return [{"name": s.get("Name"), "title": s.get("DisplayName"),
                 "state": s.get("State")} for s in data]
    return []


def sec_power() -> dict:
    if not IS_WIN:
        return {"note": "только Windows"}
    d = {}
    scheme = run(["powercfg", "/getactivescheme"])
    if scheme and not scheme.startswith("__err__"):
        d["active_scheme"] = scheme
    # Настройки сна/выключения дисплея (важно для 'всегда включён')
    d["sleep_settings"] = run(["powercfg", "/query", "SCHEME_CURRENT",
                               "SUB_SLEEP"], timeout=15)[:1500]
    return d


def sec_installed() -> list:
    if not IS_WIN:
        return [{"note": "только Windows"}]
    data = ps(r"""
      $p=@()
      $paths=@(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
      foreach($pp in $paths){ Get-ItemProperty $pp -EA SilentlyContinue |
        Where-Object {$_.DisplayName} | ForEach-Object {
          $p += [pscustomobject]@{Name=$_.DisplayName;Version=$_.DisplayVersion;
            Publisher=$_.Publisher}}}
      $p | Sort-Object Name -Unique""", depth=3)
    if data:
        data = data if isinstance(data, list) else [data]
        return [{"name": a.get("Name"), "version": a.get("Version"),
                 "publisher": a.get("Publisher")} for a in data]
    return []


def sec_health() -> dict:
    """Здоровье железа: температура/троттлинг CPU, SMART-статус дисков.
    Часть данных доступна только с правами админа — чего нет, помечаем."""
    if not IS_WIN:
        return {"note": "только Windows"}
    d = {}

    # Температура CPU (ACPI thermal zone; на части десктопов недоступна)
    tz = ps("Get-CimInstance -Namespace root/wmi -ClassName "
            "MSAcpi_ThermalZoneTemperature -EA SilentlyContinue | "
            "Select-Object CurrentTemperature")
    if tz:
        tzs = tz if isinstance(tz, list) else [tz]
        temps = []
        for z in tzs:
            raw = z.get("CurrentTemperature")
            if raw:
                temps.append(round(raw / 10 - 273.15, 1))   # десятые Кельвина → °C
        if temps:
            d["cpu_temp_c"] = temps
    if "cpu_temp_c" not in d:
        d["cpu_temp_note"] = "датчик недоступен (частая ситуация на ПК; нужна HWiNFO)"

    # Троттлинг: текущая частота против максимальной
    clk = ps("Get-CimInstance Win32_Processor | "
             "Select-Object CurrentClockSpeed,MaxClockSpeed")
    if clk:
        c = clk[0] if isinstance(clk, list) else clk
        cur, mx = c.get("CurrentClockSpeed"), c.get("MaxClockSpeed")
        if cur and mx:
            d["cpu_clock"] = {"current_mhz": cur, "max_mhz": mx,
                              "percent_of_max": round(cur / mx * 100)}

    # SMART / здоровье дисков
    disks = ps("Get-PhysicalDisk | Select-Object FriendlyName,MediaType,"
               "HealthStatus,OperationalStatus,"
               "@{N='SizeGB';E={[math]::Round($_.Size/1GB)}}")
    if disks:
        disks = disks if isinstance(disks, list) else [disks]
        d["disks_health"] = [{"name": x.get("FriendlyName"), "type": x.get("MediaType"),
                              "health": x.get("HealthStatus"),
                              "state": x.get("OperationalStatus"),
                              "size_gb": x.get("SizeGB")} for x in disks]
    # Счётчики надёжности (температура диска, износ SSD, часы работы) — best-effort
    rel = ps("Get-PhysicalDisk | ForEach-Object { Get-StorageReliabilityCounter "
             "-PhysicalDisk $_ -EA SilentlyContinue | Select-Object DeviceId,"
             "Temperature,Wear,ReadErrorsTotal,PowerOnHours }")
    if rel:
        rel = rel if isinstance(rel, list) else [rel]
        d["disks_reliability"] = [{"id": x.get("DeviceId"), "temp_c": x.get("Temperature"),
                                   "wear_percent": x.get("Wear"),
                                   "read_errors": x.get("ReadErrorsTotal"),
                                   "power_on_hours": x.get("PowerOnHours")} for x in rel]
    return d


def sec_network() -> dict:
    d = {}
    try:
        d["local_ip"] = socket.gethostbyname(socket.gethostname())
    except Exception:
        pass
    if IS_WIN:
        ad = ps("Get-NetAdapter | Where-Object Status -eq 'Up' | "
                "Select-Object Name,InterfaceDescription,LinkSpeed")
        if ad:
            d["adapters"] = ad if isinstance(ad, list) else [ad]
    return d


# ───────────────────────── сборка отчёта ─────────────────────────
SECTIONS = [
    ("meta", sec_meta), ("os", sec_os), ("hardware", sec_hardware),
    ("memory", sec_memory), ("disks", sec_disks),
    ("storage_hotspots", sec_storage_hotspots), ("top_processes", sec_top_processes),
    ("startup", sec_startup), ("autostart_services", sec_services),
    ("power", sec_power), ("health", sec_health),
    ("installed_programs", sec_installed), ("network", sec_network),
]


def build() -> dict:
    report = {}
    for name, fn in SECTIONS:
        print(f"  • собираю: {name} ...", flush=True)
        try:
            report[name] = fn()
        except Exception as e:
            report[name] = {"__error__": str(e)}
    return report


def summary_txt(r: dict) -> str:
    L = []
    m, o, h = r.get("meta", {}), r.get("os", {}), r.get("hardware", {})
    L.append("ОТЧЁТ О ПК (для оптимизации)")
    L.append("=" * 40)
    L.append(f"ПК: {m.get('hostname')}  •  {m.get('created')}")
    L.append(f"ОС: {o.get('edition') or o.get('system')} (сборка {o.get('build','?')}), "
             f"аптайм {o.get('uptime_hours','?')} ч")
    L.append(f"CPU: {h.get('cpu')}  ({h.get('cores','?')} яд./{h.get('threads','?')} потоков)")
    L.append(f"RAM: {h.get('ram_total','?')}")
    mem = r.get("memory", {})
    if mem.get("used_percent") is not None:
        L.append(f"Память занята: {mem.get('used')} / {mem.get('total')} "
                 f"({mem.get('used_percent')}%)")
    L.append("")
    L.append("ДИСКИ:")
    for dv, info in (r.get("disks") or {}).items():
        L.append(f"  {dv}  занято {info['used']} / {info['total']} ({info['used_percent']}%), "
                 f"свободно {info['free']}")
    L.append("")
    L.append("ГДЕ МЕСТО (размеры папок):")
    for name, s in (r.get("storage_hotspots") or {}).items():
        L.append(f"  {name}: {s['human']}" + ("  (прибл.)" if s.get("approx") else ""))
    L.append("")
    sf = r.get("startup", {})
    nrun = len(sf.get("registry_run", []))
    ntask = len(sf.get("logon_tasks", []))
    nfold = len(sf.get("startup_folder", []))
    L.append(f"АВТОЗАПУСК: реестр Run={nrun}, задачи при входе={ntask}, папка={nfold}")
    L.append(f"АВТО-СЛУЖБЫ: {len(r.get('autostart_services', []))}")
    L.append(f"ПРОГРАММ УСТАНОВЛЕНО: {len(r.get('installed_programs', []))}")
    L.append("")
    L.append("ТОП ПРОЦЕССОВ ПО ПАМЯТИ:")
    for p in (r.get("top_processes") or [])[:10]:
        if p.get("name"):
            L.append(f"  {p['name']}: {p.get('mem_mb','?')} МБ")
    hl = r.get("health", {})
    if hl and "note" not in hl:
        L.append("")
        L.append("ЗДОРОВЬЕ ЖЕЛЕЗА:")
        if hl.get("cpu_temp_c"):
            L.append(f"  Темп. CPU: {', '.join(str(t) for t in hl['cpu_temp_c'])} °C")
        clk = hl.get("cpu_clock")
        if clk:
            L.append(f"  Частота CPU: {clk['current_mhz']}/{clk['max_mhz']} МГц "
                     f"({clk['percent_of_max']}% — ниже ~70% подряд = троттлинг)")
        for dh in hl.get("disks_health", []):
            L.append(f"  Диск {dh.get('name')}: {dh.get('health')} "
                     f"({dh.get('type')}, {dh.get('size_gb')} ГБ)")
    L.append("")
    L.append("Полные данные — в .json рядом. Личные файлы/фото/пароли НЕ собирались.")
    return "\n".join(L)


def main():
    print("=" * 50)
    print("  Диагностика ПК для оптимизации  (v" + VERSION + ")")
    print("  Собирается ТОЛЬКО техническая информация.")
    print("  Фото, файлы, пароли и браузер НЕ трогаются.")
    print("=" * 50)
    if not IS_WIN:
        print("[!] Это не Windows — часть данных будет недоступна (тест-режим).")

    report = build()
    OUT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    base = OUT_DIR / f"pc-report_{report['meta']['hostname']}_{stamp}"
    json_path = base.with_suffix(".json")
    txt_path = base.with_suffix(".txt")
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    txt = summary_txt(report)
    txt_path.write_text(txt, "utf-8")

    print("\n" + txt)
    print("\n" + "=" * 50)
    print("ГОТОВО. Отчёт сохранён:")
    print(f"  {json_path}")
    print(f"  {txt_path}")
    print("Пришли мне .json — я посмотрю и предложу оптимизацию.")
    print("=" * 50)


if __name__ == "__main__":
    main()
