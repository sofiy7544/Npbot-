#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
panel_link.py — где сейчас живёт панель и как об этом узнаёт сайт.

Сайт панели (папка site/) лежит на GitHub Pages по постоянному адресу, а ПК
доступен из интернета через туннель Cloudflare, адрес которого меняется при
каждом запуске. Чтобы сайт всегда знал актуальный адрес API, бот после старта
туннеля записывает файл api.json в репозиторий сайта (GitHub Contents API).
Нужен токен GitHub с правом «contents: write» на ЭТОТ репозиторий
(.env: GITHUB_TOKEN, GITHUB_PAGES_REPO=владелец/репозиторий). Без токена сайт
на Pages попросит адрес вручную, а бот пришлёт ссылку в Telegram.

Только стандартная библиотека.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger("panel")

GITHUB_API = "https://api.github.com"   # тесты подменяют на локальный сервер
API_JSON_PATH = "api.json"
TIMEOUT = 20


def _gh(method: str, url: str, token: str, payload: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "INTELLECT-panel",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status, json.loads(r.read() or b"{}")


def ensure_branch(repo: str, token: str, branch: str) -> bool:
    """Служебная ветка для api.json: если её нет — создать от головы ветки по умолчанию.
    Так адрес туннеля не засоряет историю основной ветки и не требует передеплоя сайта."""
    try:
        _gh("GET", f"{GITHUB_API}/repos/{repo}/git/ref/heads/{branch}", token)
        return True
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log.warning(f"GitHub: ветка {branch}: HTTP {e.code}")
            return False
    except Exception as e:
        log.warning(f"GitHub недоступен: {type(e).__name__}")
        return False
    try:
        _, info = _gh("GET", f"{GITHUB_API}/repos/{repo}", token)
        default = info.get("default_branch") or "main"
        _, ref = _gh("GET", f"{GITHUB_API}/repos/{repo}/git/ref/heads/{default}", token)
        sha = (ref.get("object") or {}).get("sha")
        st, _ = _gh("POST", f"{GITHUB_API}/repos/{repo}/git/refs", token,
                    {"ref": f"refs/heads/{branch}", "sha": sha})
        log.info(f"GitHub: создана ветка {branch}")
        return st in (200, 201)
    except Exception as e:
        log.warning(f"GitHub: не смог создать ветку {branch}: {type(e).__name__}")
        return False


def publish_api_url(repo: str, token: str, api_url: str, *, branch: str | None = None,
                    path: str = API_JSON_PATH) -> bool:
    """Записать {"api": api_url} в <repo>/<path>. True — записано (или уже такое)."""
    if not (repo and token and api_url):
        return False
    if branch and not ensure_branch(repo, token, branch):
        return False
    base = f"{GITHUB_API}/repos/{repo}/contents/{path}"
    q = f"?ref={branch}" if branch else ""
    content = json.dumps({"api": api_url, "updated": _now_iso()}, ensure_ascii=False)
    sha = None
    try:
        st, cur = _gh("GET", base + q, token)
        sha = cur.get("sha")
        try:
            old = json.loads(base64.b64decode(cur.get("content", "")).decode("utf-8"))
            if old.get("api") == api_url:
                log.info("api.json на GitHub уже актуален")
                return True
        except Exception:
            pass
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log.warning(f"GitHub: не смог прочитать {path}: HTTP {e.code}")
            return False
    except Exception as e:
        log.warning(f"GitHub недоступен: {type(e).__name__}")
        return False
    payload = {"message": f"panel: api → {api_url}",
               "content": base64.b64encode(content.encode("utf-8")).decode("ascii")}
    if sha:
        payload["sha"] = sha
    if branch:
        payload["branch"] = branch
    try:
        st, _ = _gh("PUT", base, token, payload)
        ok = st in (200, 201)
        log.info("api.json опубликован на GitHub" if ok else f"GitHub ответил {st}")
        return ok
    except urllib.error.HTTPError as e:
        log.warning(f"GitHub: не смог записать {path}: HTTP {e.code} "
                    f"(проверь токен: права contents:write на {repo})")
        return False
    except Exception as e:
        log.warning(f"GitHub недоступен: {type(e).__name__}")
        return False


def _now_iso() -> str:
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def panel_message(*, lan_url: str | None, tunnel_url: str | None, pages_url: str | None,
                  password: str | None, tunnel_enabled: bool, weak_password: bool) -> str:
    """Текст для команды /panel и для уведомления при смене адреса (HTML Telegram)."""
    import html as _h
    lines = ["🖥 <b>Панель INTELLECT</b>"]
    if pages_url:
        lines.append(f"🌐 Сайт (откуда угодно): {_h.escape(pages_url)}")
    if tunnel_url:
        lines.append(f"🔗 Прямой адрес (пока ПК не перезагружали): {_h.escape(tunnel_url)}")
    elif tunnel_enabled and not weak_password:
        lines.append("🔗 Туннель поднимается… адрес пришлю, как появится.")
    if lan_url:
        lines.append(f"🏠 Дома, по Wi-Fi: {_h.escape(lan_url)}")
    if password:
        lines.append(f"🔑 Пароль: <code>{_h.escape(password)}</code>")
    if tunnel_enabled and weak_password:
        lines.append("⚠️ Выход в интернет выключен: пароль слабый. Впиши в .env "
                     "ACCESS_PASSWORD длиной от 6 символов и перезапусти START.bat.")
    return "\n".join(lines)
