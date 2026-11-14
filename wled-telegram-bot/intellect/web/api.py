"""
api.py — серверная логика веб-панели (независимо от HTTP-транспорта).

Все методы возвращают (code, data). Пишут/читают через IntellectApp, поэтому
панель показывает РЕАЛЬНЫЕ данные (устройства, память, автоматизации, ПК), а не
заглушки. Авторизация — по паролю (ACCESS_PASSWORD), передаётся заголовком.
"""
from __future__ import annotations

import json
import time


class WebAPI:
    def __init__(self, app):
        self.app = app
        self.password = app.settings.access_password
        ids = app.settings.allowed_users
        self.user_id = ids[0] if ids else 1

    # Пароли, с которыми НЕЛЬЗЯ выпускать панель в интернет.
    WEAK_PASSWORDS = {"", "5750", "1234", "0000", "1111", "12345", "123456", "password", "пароль"}

    @classmethod
    def password_is_weak(cls, password: str | None) -> bool:
        p = (password or "").strip()
        return p in cls.WEAK_PASSWORDS or len(p) < 6

    def authorized(self, token: str | None) -> bool:
        import hmac
        # если пароль не задан — панель открыта (допустимо только в домашней сети;
        # при выходе в интернет через туннель бот требует надёжный пароль)
        if not self.password:
            return True
        return hmac.compare_digest(str(token or ""), self.password)

    def ping(self) -> dict:
        """Без авторизации: ПК на связи? нужен ли пароль? (для сайта панели)"""
        try:
            import diaglog
            ver = diaglog.version()
        except Exception:
            ver = "?"
        return {"ok": True, "app": "INTELLECT", "auth": bool(self.password), "version": ver}

    # ----------------------- эндпоинты -----------------------
    def status(self) -> tuple[int, dict]:
        return 200, self.app.status()

    def devices(self) -> tuple[int, dict]:
        return 200, {"devices": self.app.devices.status()}


    def chat(self, body: dict) -> tuple[int, dict]:
        text = (body.get("text") or "").strip()
        if not text:
            return 400, {"error": "пустой запрос"}
        out = self.app.handle_text(self.user_id, text,
                                   confirm=bool(body.get("confirm")))
        return 200, out

    def memory_list(self) -> tuple[int, dict]:
        items = self.app.memory.recent(self.user_id, limit=50)
        return 200, {"items": [{"id": i.id, "content": i.content, "kind": i.kind}
                               for i in items]}

    def memory_add(self, body: dict) -> tuple[int, dict]:
        content = (body.get("content") or "").strip()
        if not content:
            return 400, {"error": "пусто"}
        mid = self.app.memory.remember(self.user_id, content,
                                       kind=body.get("kind", "fact"))
        return 200, {"id": mid}

    def memory_delete(self, body: dict) -> tuple[int, dict]:
        ok = self.app.memory.forget(self.user_id, int(body.get("id", 0)))
        return 200, {"ok": ok}

    def automations(self) -> tuple[int, dict]:
        rows = self.app.automation.list(self.user_id)
        return 200, {"items": [{
            "id": r["id"], "name": r["name"], "trigger_type": r["trigger_type"],
            "trigger_spec": r["trigger_spec"], "enabled": bool(r["enabled"]),
            "last_run": r["last_run"]} for r in rows]}

    def automation_toggle(self, body: dict) -> tuple[int, dict]:
        self.app.automation.set_enabled(int(body["id"]), bool(body.get("enabled", True)))
        return 200, {"ok": True}

    def automation_delete(self, body: dict) -> tuple[int, dict]:
        self.app.automation.delete(int(body["id"]))
        return 200, {"ok": True}

    def tasks(self) -> tuple[int, dict]:
        rows = self.app.db.query(
            "SELECT id, title, status FROM tasks WHERE user_id=? AND status='open' ORDER BY id",
            (self.user_id,))
        return 200, {"items": [dict(r) for r in rows]}

    def task_add(self, body: dict) -> tuple[int, dict]:
        title = (body.get("title") or "").strip()
        if not title:
            return 400, {"error": "пусто"}
        self.app.db.insert("tasks", {"user_id": self.user_id, "title": title,
                                     "status": "open", "created_at": time.time()})
        return 200, {"ok": True}

    def task_done(self, body: dict) -> tuple[int, dict]:
        self.app.db.execute("UPDATE tasks SET status='done', done_at=? WHERE id=? AND user_id=?",
                            (time.time(), int(body["id"]), self.user_id))
        return 200, {"ok": True}

    def system(self) -> tuple[int, dict]:
        from ..computer import info
        return 200, info.collect(top_processes=8)

    # ======================= единый API для сайта (2.3.0) =======================
    # Всё, что раньше умел только старый пульт :8080 (webapp.py), — здесь,
    # под тем же паролем и лимитами. Сайт один: site/ (только в домашней сети).

    def _lamp_json(self, path: str, payload: dict | None = None):
        import urllib.request
        ip = self.app.wled.ip
        url = f"http://{ip}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as r:
            return json.loads(r.read() or b"{}")

    def lamp_state(self) -> tuple[int, dict]:
        """Сырое состояние WLED + списки эффектов/палитр (для колеса, слайдеров, поиска)."""
        try:
            full = self._lamp_json("/json")
            return 200, {"online": True, "state": full.get("state", {}),
                         "effects": full.get("effects", []), "palettes": full.get("palettes", []),
                         "name": (full.get("info") or {}).get("name", "")}
        except Exception:
            return 200, {"online": False, "state": {}, "effects": [], "palettes": []}

    def lamp_raw(self, body: dict) -> tuple[int, dict]:
        """Произвольная команда WLED (как /api/cmd старого пульта)."""
        if not isinstance(body, dict) or not body:
            return 400, {"error": "пустая команда"}
        try:
            self._lamp_json("/json/state", body)
            st = self._lamp_json("/json/state")
            return 200, {"ok": True, "state": st}
        except Exception:
            return 502, {"ok": False, "error": "лампа не отвечает"}

    def device_command(self, body: dict) -> tuple[int, dict]:
        key = body.get("device")
        dev = self.app.devices.get(key)
        if not dev:
            return 404, {"error": "устройство не найдено"}
        cmd = body.get("command") or {}
        if key == "lamp" and (cmd.get("action") or "") == "scene":
            from ..devices.tools import _apply_scene
            res = _apply_scene(self.app.wled, str(cmd.get("name", "")))
            return 200, {"ok": bool(res.get("ok", True)), "message": res.get("message", "")}
        ok = dev.apply(cmd)
        return 200, {"ok": ok}

    # ----- таймеры выключения (модуль timers из корня проекта) -----
    def timer_get(self) -> tuple[int, dict]:
        import timers
        return 200, {"lamp": timers.remaining("lamp"), "tv": timers.remaining("tv")}

    def timer_set(self, body: dict) -> tuple[int, dict]:
        import timers
        kind = body.get("kind")
        if kind not in ("lamp", "tv"):
            return 400, {"error": "kind: lamp|tv"}
        try:
            minutes = int(body.get("minutes", 0))
        except (TypeError, ValueError):
            return 400, {"error": "minutes: число"}
        if minutes <= 0:
            timers.cancel(kind)
        else:
            timers.set_timer(kind, minutes)
        return self.timer_get()

    # ----- телевизор (единый конфиг tvremote: tv.json + одно соединение) -----
    def _tvcfg(self) -> dict:
        import tvremote
        cfg = tvremote.current()
        return {"ip": cfg.get("ip", ""), "method": cfg.get("method", ""),
                "name": cfg.get("name", ""), "model": cfg.get("model", ""),
                "configured": bool(cfg.get("ip"))}

    def tv_config(self) -> tuple[int, dict]:
        return 200, self._tvcfg()

    def tv_config_set(self, body: dict) -> tuple[int, dict]:
        import tvremote
        ip = (body.get("ip") or "").strip()
        if not ip:
            return 400, {"error": "нужен ip"}
        cfg = tvremote.current()
        cfg.update(ip=ip, method="", mac="", name="", model="")
        try:
            info = tvremote.detect(ip) or {}
            cfg.update(method=info.get("method") or "", mac=info.get("mac", ""),
                       name=info.get("name", ""), model=info.get("model", ""))
        except Exception:
            pass
        tvremote.save_config()
        return 200, self._tvcfg()

    def tv_scan(self) -> tuple[int, dict]:
        import tvremote
        try:
            return 200, {"tvs": tvremote.discover(3.0)}
        except Exception as e:
            return 200, {"tvs": [], "error": str(e)}

    def _tv_ready(self):
        cfg = self._tvcfg()
        if not cfg["configured"]:
            return None, (400, {"ok": False, "error": "Телевизор не настроен — нажми «Найти телевизор»"})
        return cfg, None

    def tv_key(self, body: dict) -> tuple[int, dict]:
        import tvremote
        cfg, err = self._tv_ready()
        if err:
            return err
        key = str(body.get("key") or "").strip().upper()
        if not key.startswith("KEY_") or len(key) > 24:
            return 400, {"ok": False, "error": "key: KEY_*"}
        try:
            if key == "KEY_POWER" and tvremote.current().get("mac"):
                try:
                    tvremote.wake_on_lan(tvremote.current()["mac"])
                except Exception:
                    pass
            method = tvremote.send_key(cfg["ip"], key, cfg["method"] or None)
            if method and method != cfg["method"]:
                tvremote.current()["method"] = method
                tvremote.save_config()
            return 200, {"ok": True, "method": method}
        except Exception as e:
            return 502, {"ok": False, "error": f"{type(e).__name__}"}

    def tv_power(self, body: dict) -> tuple[int, dict]:
        import tvremote
        cfg, err = self._tv_ready()
        if err:
            return err
        try:
            ok = bool(tvremote.power(bool(body.get("on", True))))
            return (200 if ok else 502), {"ok": ok}
        except Exception as e:
            return 502, {"ok": False, "error": type(e).__name__}

    def tv_apps(self) -> tuple[int, dict]:
        import tvremote
        if not self._tvcfg()["configured"]:
            return 200, {"apps": []}
        try:
            return 200, {"apps": tvremote.list_apps() or []}
        except Exception:
            return 200, {"apps": []}

    def tv_app(self, body: dict) -> tuple[int, dict]:
        import tvremote
        cfg, err = self._tv_ready()
        if err:
            return err
        app_id = str(body.get("app") or "").strip()
        if not app_id:
            return 400, {"ok": False, "error": "app: id приложения"}
        try:
            tvremote.run_app(cfg["ip"], app_id, cfg["method"] or None)
            return 200, {"ok": True}
        except Exception as e:
            return 502, {"ok": False, "error": type(e).__name__}

    def tv_browser(self, body: dict) -> tuple[int, dict]:
        import tvremote
        import urllib.parse
        cfg, err = self._tv_ready()
        if err:
            return err
        q = (body.get("query") or "").strip()
        url = (body.get("url") or "").strip() or (
            "https://m.youtube.com/results?search_query=" + urllib.parse.quote(q) if q
            else "https://www.google.com")
        try:
            ok = bool(tvremote.open_browser(url, cfg["method"] or None))
            return (200 if ok else 502), {"ok": ok}
        except Exception as e:
            return 502, {"ok": False, "error": type(e).__name__}

    # ----- чат: подтверждение/отмена опасного действия -----
    def chat_confirm(self, body: dict) -> tuple[int, dict]:
        return 200, self.app.confirm_pending(self.user_id)

    def chat_cancel(self, body: dict) -> tuple[int, dict]:
        return 200, self.app.cancel_pending(self.user_id, power=bool(body.get("power")))

    # ----- где панель живёт (для экрана настроек сайта) -----
    panel_provider = None   # wled_bot подставляет функцию → {lan_url, ...}

    def panel(self) -> tuple[int, dict]:
        info = {"lan_url": None, "password_required": bool(self.password)}
        try:
            if self.panel_provider:
                info.update(self.panel_provider() or {})
        except Exception:
            pass
        return 200, info
