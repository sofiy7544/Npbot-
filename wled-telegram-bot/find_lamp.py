#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
find_lamp.py — автопоиск лампы WLED в локальной сети.

Зачем: если сменился Wi-Fi/роутер, IP лампы почти наверняка стал другим, а то и
подсеть сменилась (192.168.1.x → 192.168.0.x и т.п.). Этот модуль находит лампу
по сети, не завися от конкретного IP: опрашивает всю подсеть и ищет
устройства, которые отвечают как WLED.

Использование:
  • как инструмент:  python find_lamp.py   → напечатает найденные лампы
                     (код выхода 0 — нашёл, 1 — нет; START.bat пишет его в start.log)
  • из бота:         find_lamp.discover()  → список {ip,name,ver,leds}
                     find_lamp.check(ip)   → проверить один IP с повторами

Ничего не меняет на лампе — только читает её публичный /json/info (как это делает
официальное приложение WLED).

Почему окно на адрес ~2 с, а не доли секунды: лампа (ESP по Wi-Fi) на первый
пакет после простоя нередко отвечает не сразу, а Windows повторяет запрос ARP и
SYN только через 1 с. С окном 0.4 с у каждого адреса была ровно одна попытка —
14.11 так «потерялась» лампа, которая через 20 с спокойно ответила.
"""
from __future__ import annotations

import json
import time
import socket
import ipaddress
import http.client
from concurrent.futures import ThreadPoolExecutor


def local_ipv4s() -> list[str]:
    """Локальные IPv4 этого ПК со всех интерфейсов (чтобы понять, какие
    подсети сканировать). Берём из нескольких источников — так надёжнее на
    машинах с VPN (Radmin/Hamachi) и несколькими адаптерами.
    Порядок важен: первым — адрес маршрута по умолчанию (основная сеть)."""
    ips: dict[str, None] = {}          # dict, а не set: сохраняет порядок
    # 1) исходящий маршрут по умолчанию (обычно это и есть домашний адаптер)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))           # не шлёт пакетов, просто узнаёт исходящий IP
        ips[s.getsockname()[0]] = None
        s.close()
    except Exception:
        pass
    # 2) по имени хоста
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.setdefault(info[4][0])
    except Exception:
        pass
    # 3) все адаптеры через psutil (если установлен)
    try:
        import psutil
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if getattr(a, "family", None) == socket.AF_INET and a.address:
                    ips.setdefault(a.address)
    except Exception:
        pass
    return [ip for ip in ips if not ip.startswith("127.")]


def _probe(ip: str, timeout: float, why: list | None = None, port: int | None = None):
    """Вернуть данные, если по этому IP отвечает WLED, иначе None.
    Напрямую через http.client: urllib на Windows берёт системный прокси из
    реестра, а в потоках каждый первый вызов строит свой opener с SSL-контекстом
    (загрузка хранилища сертификатов) — для лампы в своей сети это лишнее.
    why — список, куда дописать причину неудачи (для журнала);
    port=None — 80 или порт из самого адреса («IP:порт»)."""
    conn = http.client.HTTPConnection(ip, port, timeout=timeout)
    try:
        conn.request("GET", "/json/info")
        r = conn.getresponse()
        if r.status != 200:
            raise ValueError(f"HTTP {r.status}")
        d = json.loads(r.read())
    except Exception as e:
        if why is not None:
            why.append(f"{type(e).__name__}: {e}"[:120])
        return None
    finally:
        conn.close()
    is_wled = isinstance(d, dict) and (
        str(d.get("brand", "")).upper() == "WLED"
        or "wled" in str(d.get("product", "")).lower()
        or ("ver" in d and "leds" in d))
    if not is_wled:
        if why is not None:
            why.append("отвечает, но это не WLED")
        return None
    return {
        "ip": ip,
        "name": d.get("name", "WLED"),
        "ver": d.get("ver", ""),
        "leds": (d.get("leds") or {}).get("count"),
    }


def check(ip: str, attempts: int = 3, timeout: float = 2.0, pause: float = 0.5):
    """Проверить ОДИН адрес с повторами; таймаут растёт: 2 → 3 → 4 с.
    → (данные лампы или None, причина последней неудачи)."""
    why: list[str] = []
    for i in range(max(1, attempts)):
        hit = _probe(ip, timeout + i, why)
        if hit:
            return hit, ""
        if i + 1 < attempts:
            time.sleep(pause)
    return None, (why[-1] if why else "нет ответа")


def _docker_ish(ip) -> bool:
    """Диапазоны Docker/WSL (172.17–172.31.x) — не домашняя сеть."""
    o = str(ip).split(".")
    return o[0] == "172" and o[1].isdigit() and 17 <= int(o[1]) <= 31


def _subnets_to_scan() -> list:
    """/24-подсети для скана. Домашние (192.168/10) в приоритете. Пропускаем
    link-local (169.254 — отключённые адаптеры), Docker/WSL (172.17+) и VPN
    (напр. Radmin 26.x), если есть нормальная домашняя сеть."""
    home, docker, other = [], [], []
    for ips in local_ipv4s():
        try:
            ip = ipaddress.ip_address(ips)
            net = ipaddress.ip_network(ips + "/24", strict=False)
        except Exception:
            continue
        if ip.is_link_local:               # 169.254.x — мусор, всегда мимо
            continue
        if ip.is_private and not _docker_ish(ip):
            if net not in home:
                home.append(net)
        elif _docker_ish(ip):
            if net not in docker:
                docker.append(net)
        elif net not in other:
            other.append(net)
    # домашние → затем docker → затем прочее (VPN и т.п.), но только если лучше нет
    return home or docker or other


def discover(timeout: float = 2.0, workers: int = 128) -> list[dict]:
    """Просканировать локальные /24-подсети и вернуть найденные лампы WLED.
    Каждому адресу — окно timeout (≥2 с: успевает повтор ARP/SYN у Windows);
    128 потоков → /24 за ~4–5 с даже на слабом ПК. Подсети — по очереди, с
    основной; нашли лампу — остальные (VirtualBox, VPN…) не трогаем."""
    for net in _subnets_to_scan():
        hosts = [str(h) for h in net.hosts()]
        if not hosts:
            continue
        with ThreadPoolExecutor(max_workers=min(workers, len(hosts))) as ex:
            found = [r for r in ex.map(lambda ip: _probe(ip, timeout), hosts) if r]
        if found:
            return found
    return []


def find_one(timeout: float = 2.0) -> str | None:
    """IP первой найденной лампы (или None)."""
    hits = discover(timeout)
    return hits[0]["ip"] if hits else None


def env_ip() -> str:
    """WLED_IP из .env рядом с этим файлом (или "" — если не задан)."""
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k.strip() == "WLED_IP":
                    return v.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


if __name__ == "__main__":
    import sys
    # START.bat: сначала адрес из .env (с повторами) — если лампа там, скан не нужен
    ip = env_ip()
    if ip:
        print(f"Проверяю лампу из .env: {ip}…")
        hit, why = check(ip)
        if hit:
            print(f"✅ Лампа на связи: {ip}  —  {hit['name']}")
            sys.exit(0)
        print(f"Лампа по {ip} пока не отвечает ({why}).")
    print("Ищу лампы WLED в локальной сети… (несколько секунд)")
    print("Сканирую подсети:", ", ".join(str(n) for n in _subnets_to_scan()) or "—")
    hits = discover()
    if not hits:
        print("\nЛампа WLED пока не найдена — бот проверит её ещё раз после запуска.")
        print("Если так и не появится, проверь:")
        print("  1) ПК и лампа в одной Wi-Fi (сейчас это «INTELLECT»).")
        print("  2) Лампа переподключена к НОВОМУ Wi-Fi (см. режим WLED-AP).")
        print("  3) Лампа включена в розетку.")
    else:
        print(f"\n✅ Найдено ламп: {len(hits)}")
        for h in hits:
            leds = f", {h['leds']} LED" if h.get("leds") else ""
            print(f"   • {h['ip']}  —  {h['name']}  (WLED {h['ver']}{leds})")
        print(f"\nВпиши в .env:  WLED_IP={hits[0]['ip']}  (бот при запуске делает это сам)")
    # START.bat пишет код в logs\start.log: 0 — лампа найдена, 1 — нет
    # (раньше всегда было 0, и по журналу нельзя было понять, нашёл ли он её).
    sys.exit(0 if hits else 1)
