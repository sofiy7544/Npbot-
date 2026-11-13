#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
find_lamp.py — автопоиск лампы WLED в локальной сети.

Зачем: если сменился Wi-Fi/роутер, IP лампы почти наверняка стал другим, а то и
подсеть сменилась (192.168.1.x → 192.168.0.x и т.п.). Этот модуль находит лампу
по сети, не завися от конкретного IP: быстро опрашивает всю подсеть и ищет
устройства, которые отвечают как WLED.

Использование:
  • как инструмент:  python find_lamp.py   → напечатает найденные лампы
  • из бота:         find_lamp.discover()  → список {ip,name,ver,leds}

Ничего не меняет на лампе — только читает её публичный /json/info (как это делает
официальное приложение WLED).
"""
from __future__ import annotations

import json
import socket
import ipaddress
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def local_ipv4s() -> list[str]:
    """Локальные IPv4 этого ПК со всех интерфейсов (чтобы понять, какие
    подсети сканировать). Берём из нескольких источников — так надёжнее на
    машинах с VPN (Radmin/Hamachi) и несколькими адаптерами."""
    ips: set[str] = set()
    # 1) исходящий маршрут по умолчанию (обычно это и есть домашний адаптер)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))           # не шлёт пакетов, просто узнаёт исходящий IP
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    # 2) по имени хоста
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    # 3) все адаптеры через psutil (если установлен)
    try:
        import psutil
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if getattr(a, "family", None) == socket.AF_INET and a.address:
                    ips.add(a.address)
    except Exception:
        pass
    return [ip for ip in ips if not ip.startswith("127.")]


def _probe(ip: str, timeout: float):
    """Вернуть данные, если по этому IP отвечает WLED, иначе None."""
    try:
        with urllib.request.urlopen(f"http://{ip}/json/info", timeout=timeout) as r:
            d = json.loads(r.read())
    except Exception:
        return None
    is_wled = (str(d.get("brand", "")).upper() == "WLED"
               or "wled" in str(d.get("product", "")).lower()
               or ("ver" in d and "leds" in d))
    if not is_wled:
        return None
    return {
        "ip": ip,
        "name": d.get("name", "WLED"),
        "ver": d.get("ver", ""),
        "leds": (d.get("leds") or {}).get("count"),
    }


def _subnets_to_scan() -> list:
    """/24-подсети для скана. Домашние (RFC1918: 192.168/10/172.16) в приоритете;
    VPN-подсети вроде Radmin (26.x) пропускаем, если есть домашние."""
    private, other = [], []
    for ip in local_ipv4s():
        try:
            net = ipaddress.ip_network(ip + "/24", strict=False)
        except Exception:
            continue
        if ipaddress.ip_address(ip).is_private:
            if net not in private:
                private.append(net)
        elif net not in other:
            other.append(net)
    return private or other   # если домашних нет — сканируем что есть


def discover(timeout: float = 0.4, workers: int = 128) -> list[dict]:
    """Просканировать локальные /24-подсети и вернуть найденные лампы WLED."""
    hosts: list[str] = []
    for net in _subnets_to_scan():
        hosts += [str(h) for h in net.hosts()]
    if not hosts:
        return []
    found: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(lambda ip: _probe(ip, timeout), hosts):
            if res:
                found.append(res)
    return found


def find_one(timeout: float = 0.4) -> str | None:
    """IP первой найденной лампы (или None)."""
    hits = discover(timeout)
    return hits[0]["ip"] if hits else None


if __name__ == "__main__":
    print("Ищу лампы WLED в локальной сети… (пара секунд)")
    print("Сканирую подсети:", ", ".join(str(n) for n in _subnets_to_scan()) or "—")
    hits = discover()
    if not hits:
        print("\n❌ Лампа WLED не найдена.")
        print("Проверь:")
        print("  1) ПК и лампа в одной Wi-Fi (сейчас это «INTELLECT»).")
        print("  2) Лампа переподключена к НОВОМУ Wi-Fi (см. режим WLED-AP).")
        print("  3) Лампа включена в розетку.")
    else:
        print(f"\n✅ Найдено ламп: {len(hits)}")
        for h in hits:
            leds = f", {h['leds']} LED" if h.get("leds") else ""
            print(f"   • {h['ip']}  —  {h['name']}  (WLED {h['ver']}{leds})")
        print(f"\nВпиши в .env:  WLED_IP={hits[0]['ip']}")
