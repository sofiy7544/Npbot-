#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tunnel.py — доступ к веб-панели бота из интернета через Cloudflare quick tunnel.

Панель слушает только http://127.0.0.1:<порт> на домашнем ПК. cloudflared
(бесплатно, без аккаунта Cloudflare) пробрасывает её наружу и выдаёт адрес вида
https://xxx-yyy.trycloudflare.com с HTTPS. Адрес МЕНЯЕТСЯ при каждом запуске
туннеля — это нормально: подписчики on_url() получают новый адрес.

Что делает модуль:
  • находит cloudflared.exe рядом с проектом или в PATH; на Windows при
    отсутствии скачивает с GitHub (проверка: PE-файл «MZ», больше 10 МБ);
  • запускает `cloudflared tunnel --url http://127.0.0.1:<порт>` без окна;
  • вылавливает публичный URL из вывода; если процесс упал — перезапускает
    с нарастающей паузой (5 с → 5 мин), URL на время сбрасывается в None;
  • хранит последние 20 строк вывода для диагностики (last_output()).

Только стандартная библиотека. Ничего не бросает наружу из фонового потока.
"""
from __future__ import annotations

import collections
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

log = logging.getLogger("tunnel")

ROOT = os.path.dirname(os.path.abspath(__file__))

# Переопределение пути к бинарнику через окружение (например, для тестов).
TUNNEL_BIN_ENV = "CLOUDFLARED_PATH"

BIN_NAME = "cloudflared.exe" if os.name == "nt" else "cloudflared"
# Путь по умолчанию — рядом с проектом (тесты могут подменить).
BIN_PATH = os.path.join(ROOT, BIN_NAME)

DOWNLOAD_URL_WINDOWS = ("https://github.com/cloudflare/cloudflared/releases/latest/"
                        "download/cloudflared-windows-amd64.exe")
DOWNLOAD_URL_LINUX = ("https://github.com/cloudflare/cloudflared/releases/latest/"
                      "download/cloudflared-linux-amd64")
MIN_BIN_SIZE = 10 * 1024 * 1024          # меньше 10 МБ — это не cloudflared
DOWNLOAD_TIMEOUT = 60                    # сек на соединение

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

RESTART_BACKOFF_MIN = 5.0
RESTART_BACKOFF_MAX = 300.0
OUTPUT_KEEP = 20


def download_url() -> str:
    return DOWNLOAD_URL_WINDOWS if os.name == "nt" else DOWNLOAD_URL_LINUX


def find_binary() -> str | None:
    """Где cloudflared: переменная окружения → рядом с проектом → PATH."""
    env = os.environ.get(TUNNEL_BIN_ENV, "").strip()
    if env and os.path.isfile(env):
        return env
    if os.path.isfile(BIN_PATH):
        return BIN_PATH
    return shutil.which("cloudflared")


def download_binary(url: str | None = None, dest: str | None = None,
                    timeout: float = DOWNLOAD_TIMEOUT) -> str:
    """Скачать cloudflared в dest (по умолчанию BIN_PATH). Пишем во временный
    файл рядом, проверяем, затем os.replace. Бросает исключение при проблеме."""
    url = url or download_url()
    dest = dest or BIN_PATH
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".cloudflared-", suffix=".part",
                               dir=os.path.dirname(dest) or ".")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "INTELLECT-tunnel"})
        with urllib.request.urlopen(req, timeout=timeout) as resp, os.fdopen(fd, "wb") as f:
            head = resp.read(2)
            f.write(head)
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
        size = os.path.getsize(tmp)
        if os.name == "nt" or url.endswith(".exe"):
            if head != b"MZ":
                raise ValueError("скачанный файл — не программа Windows (нет заголовка MZ)")
        if size < MIN_BIN_SIZE:
            raise ValueError(f"скачанный файл подозрительно мал: {size} байт")
        os.replace(tmp, dest)
        if os.name != "nt":
            os.chmod(dest, 0o755)
        return dest
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


class Tunnel:
    """Супервизор cloudflared. start() не блокирует; url — текущий публичный адрес."""

    def __init__(self, *, command: list[str] | None = None,
                 backoff_min: float = RESTART_BACKOFF_MIN,
                 backoff_max: float = RESTART_BACKOFF_MAX,
                 allow_download: bool = True):
        # command — полная команда вместо бинарника (для тестов: ["python", "fake.py"]);
        # к ней добавляются аргументы tunnel --url ...
        self._command = command
        self._backoff_min = backoff_min
        self._backoff_max = backoff_max
        self._allow_download = allow_download
        self._port: int | None = None
        self._url: str | None = None
        self._proc: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._callbacks: list = []
        self._output: collections.deque = collections.deque(maxlen=OUTPUT_KEEP)
        self.last_error: str | None = None

    # ----------------------- публичное API -----------------------
    @property
    def url(self) -> str | None:
        return self._url

    def on_url(self, callback) -> None:
        """callback(url: str | None) — вызывается при появлении/смене/потере адреса."""
        self._callbacks.append(callback)

    def last_output(self) -> list[str]:
        return list(self._output)

    def start(self, local_port: int) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._port = int(local_port)
        self._stop.clear()
        self._thread = threading.Thread(target=self._supervise, name="tunnel", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._kill()
        t = self._thread
        if t and t.is_alive() and threading.current_thread() is not t:
            t.join(timeout=10)
        self._set_url(None)

    # ----------------------- внутреннее -----------------------
    def _set_url(self, url: str | None) -> None:
        with self._lock:
            if url == self._url:
                return
            self._url = url
        if url:
            log.info(f"🌐 Туннель открыт: {url}")
        for cb in list(self._callbacks):
            try:
                cb(url)
            except Exception as e:
                log.warning(f"on_url: обработчик упал: {type(e).__name__}: {e}")

    def _resolve_command(self) -> list[str] | None:
        if self._command:
            return list(self._command)
        path = find_binary()
        if not path and self._allow_download:
            try:
                log.info("cloudflared не найден — скачиваю (один раз, ~20 МБ)…")
                path = download_binary()
                log.info(f"cloudflared скачан: {path}")
            except Exception as e:
                self.last_error = f"не удалось скачать cloudflared: {type(e).__name__}: {e}"
                log.warning(f"⚠️ {self.last_error}. Панель доступна только в домашней сети; "
                            f"повторю попытку позже.")
                return None
        if not path:
            self.last_error = "cloudflared не найден (скачивание отключено)"
            log.warning(f"⚠️ {self.last_error} — туннель не поднят.")
            return None
        return [path]

    def _spawn(self, cmd: list[str]) -> subprocess.Popen:
        full = cmd + ["tunnel", "--url", f"http://127.0.0.1:{self._port}",
                      "--no-autoupdate", "--loglevel", "info"]
        kw: dict = {}
        if os.name == "nt":
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = 0
            kw["startupinfo"] = si
            kw["creationflags"] = (getattr(subprocess, "CREATE_NO_WINDOW", 0)
                                   | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0))
        return subprocess.Popen(full, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1, **kw)

    def _kill(self) -> None:
        p = self._proc
        if p is None:
            return
        try:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
        except Exception:
            pass

    def _supervise(self) -> None:
        backoff = self._backoff_min
        while not self._stop.is_set():
            cmd = self._resolve_command()
            if cmd is None:
                if self._stop.wait(backoff):
                    break
                backoff = min(backoff * 2, self._backoff_max)
                continue
            started = time.monotonic()
            try:
                self._proc = self._spawn(cmd)
            except Exception as e:
                self.last_error = f"не удалось запустить cloudflared: {type(e).__name__}: {e}"
                log.warning(f"⚠️ {self.last_error}")
                if self._stop.wait(backoff):
                    break
                backoff = min(backoff * 2, self._backoff_max)
                continue
            try:
                for line in self._proc.stdout:         # до закрытия пайпа (выход процесса)
                    line = line.rstrip("\r\n")
                    if line:
                        self._output.append(line)
                    m = URL_RE.search(line)
                    if m and m.group(0) != self._url:
                        self._set_url(m.group(0))
            except Exception as e:
                log.warning(f"чтение вывода cloudflared: {type(e).__name__}: {e}")
            rc = self._proc.wait() if self._proc else None
            self._set_url(None)
            if self._stop.is_set():
                break
            # прожил долго — считаем сбой разовым, пауза снова минимальная
            if time.monotonic() - started > 60:
                backoff = self._backoff_min
            log.warning(f"cloudflared завершился (код {rc}) — перезапуск через {backoff:.0f} с")
            if self._stop.wait(backoff):
                break
            backoff = min(backoff * 2, self._backoff_max)
        self._kill()
