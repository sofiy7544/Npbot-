#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты: после простоя бот НЕ отвечает на каждое накопившееся сообщение
(«Ого ты заспамил»), а шлёт одно уведомление; свежее — обрабатывает."""
import os, sys, tempfile, subprocess, time, shutil
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import stale_updates as su
from telegram import Update, Message, Chat, User, CallbackQuery

_ok = _fail = 0
def check(name, cond):
    global _ok, _fail
    if cond: _ok += 1; print(f"  ✅ {name}")
    else: _fail += 1; print(f"  ❌ {name}")


CHAT = Chat(42, "private")
USER = User(42, False, "Stanley")
BOTU = User(1, True, "INTELLECT")
# как у пользователя: START.bat «Bot starting» 13:53:25, простой 10:35–13:37
BOOT = datetime(2026, 11, 14, 13, 53, 25).timestamp()
_uid = [0]


def _dt(ts):
    return datetime.fromtimestamp(ts, timezone.utc)


def msg(ts, text="Ку", edit_ts=None, chat=CHAT):
    _uid[0] += 1
    m = Message(_uid[0], _dt(ts), chat, from_user=USER, text=text,
                edit_date=_dt(edit_ts) if edit_ts else None)
    return Update(_uid[0], edited_message=m) if edit_ts else Update(_uid[0], message=m)


def press(dash_ts, data="toggle"):
    """Нажатие кнопки на панели, которую бот прислал в dash_ts."""
    _uid[0] += 1
    panel = Message(7, _dt(dash_ts), CHAT, from_user=BOTU, text="panel")
    return Update(_uid[0], callback_query=CallbackQuery(str(_uid[0]), USER, "ci", message=panel, data=data))


def test_messages():
    g = su.StaleGate(boot_ts=BOOT)
    check("сообщение за 3 ч до запуска → старое", g.is_stale(msg(BOOT - 3 * 3600)) is True)
    check("13:37 при запуске в 13:53 → старое", g.is_stale(msg(BOOT - 16 * 60)) is True)
    check("за 8 с до запуска (5-сек. перезапуск START.bat) → свежее", g.is_stale(msg(BOOT - 8)) is False)
    check("за 100 с (ручной START.bat: автозапуск+поиск лампы) → свежее", g.is_stale(msg(BOOT - 100)) is False)
    check("пока бот грузится (после старта) → свежее", g.is_stale(msg(BOOT + 30)) is False)
    check("старое сообщение, исправленное сейчас (edit_date) → свежее",
          g.is_stale(msg(BOOT - 3 * 3600, edit_ts=BOOT + 5)) is False)
    check("правка старого сообщения во время простоя → старая",
          g.is_stale(msg(BOOT - 3 * 3600, edit_ts=BOOT - 3000)) is True)
    check("апдейт без сообщения (напр. my_chat_member) → не трогаем", g.is_stale(Update(999)) is False)


def test_callbacks():
    g = su.StaleGate(boot_ts=BOOT)
    # ГЛАВНОЕ: effective_message у нажатия — это ПАНЕЛЬ (дата её отправки), а не нажатие
    old_panel = press(BOOT - 3 * 3600)
    check("effective_message нажатия = панель бота (её дата — 3 ч назад)",
          old_panel.effective_message.date == _dt(BOOT - 3 * 3600))
    check("кнопка на вчерашней панели, нажатая ПОСЛЕ запуска → работает", g.is_stale(old_panel) is False)
    g.set_backlog(2)
    check("нажатие из очереди простоя (pending_update_count) → старое", g.is_stale(press(BOOT + 3600)) is True)
    check("свежее сообщение в очереди (перезапуск) — всё равно обрабатывается", g.is_stale(msg(BOOT - 5)) is False)
    check("после очереди нажатия снова работают", g.is_stale(press(BOOT - 3 * 3600)) is False)
    g.set_backlog(None)
    check("getWebhookInfo без числа → очередь 0", g.backlog == 0)
    g.set_backlog("мусор")
    check("мусор вместо числа → очередь неизвестна (None) → судим только по дате", g.backlog is None)


def test_one_notice_per_chat():
    g = su.StaleGate(boot_ts=BOOT)
    t0 = datetime(2026, 11, 14, 10, 35).timestamp()
    t1 = datetime(2026, 11, 14, 13, 37).timestamp()
    texts = ["И как?", "Ворк?", "Не запустился получается", "Ау", "Ку", "Ку", "Ну", "И шо"]
    ups = [msg(t0 + i * (t1 - t0) / 12, "/start") for i in range(13)] + [msg(t0 + 60 * (i + 1), t) for i, t in enumerate(texts)]
    g.set_backlog(len(ups) + 1)
    firsts = []
    for u in ups:
        if g.is_stale(u):
            firsts.append(g.record(u))
    cb = press(BOOT - 3 * 3600)
    if g.is_stale(cb):
        firsts.append(g.record(cb))
    check("все 22 апдейта простоя распознаны как старые", len(firsts) == 22)
    check("уведомление планируется ровно один раз на чат", firsts.count(True) == 1 and firsts[0] is True)
    check("чат помечен как ждущий уведомления", g.has_pending(42))
    text = g.pop_notice(42, now=BOOT)
    print("     →", text.replace("\n", " / "))
    check("в тексте: 21 сообщение и 1 нажатие кнопки", "21 сообщение и 1 нажатие кнопки" in text)
    check("в тексте: время простоя «с 10:35 до 13:37»", "(с 10:35 до 13:37)" in text)
    check("в тексте: просьба повторить", "повтори" in text and "выключен" in text)
    check("второй раз уведомление не выдаётся", g.pop_notice(42) is None and not g.has_pending(42))
    other = Chat(77, "private")
    g2 = su.StaleGate(boot_ts=BOOT)
    a, b = msg(t0, chat=other), msg(t0)
    check("разные чаты — отдельные уведомления", g2.record(a) and g2.record(b))
    check("только нажатия: «2 нажатия кнопок», без времени",
          su.notice_text(0, 2, None, None).startswith("⏸ Я был выключен и пропустил 2 нажатия кнопок."))
    check("один момент: «(в 10:35)»", "(в 10:35)" in su.notice_text(1, 0, t0, t0 + 5, now=t0))
    check("простой через полночь → с датой",
          "13.11 23:50" in su.notice_text(2, 0, datetime(2026, 11, 13, 23, 50).timestamp(), t0, now=t0))


def test_plural():
    forms = {n: su.plural(n, "сообщение", "сообщения", "сообщений") for n in (1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111)}
    check("1, 21, 101 → сообщение", forms[1] == forms[21] == forms[101] == "сообщение")
    check("2, 4, 22 → сообщения", forms[2] == forms[4] == forms[22] == "сообщения")
    check("5, 11, 12, 14, 25, 111 → сообщений",
          all(forms[n] == "сообщений" for n in (5, 11, 12, 14, 25, 111)))


def test_clock_skew_is_bounded():
    """Часы ПК спешат на 5 минут: порог фиксирован, поэтому задеты только
    первые ~3 минуты после запуска, а не вся работа бота."""
    real_boot = BOOT
    g = su.StaleGate(boot_ts=real_boot + 300)          # ПК думает, что сейчас на 5 мин позже
    check("часы спешат: живое через 4 мин после старта → свежее", g.is_stale(msg(real_boot + 240)) is False)
    check("часы спешат: живое через час → свежее", g.is_stale(msg(real_boot + 3600)) is False)
    g2 = su.StaleGate(boot_ts=real_boot - 300)         # часы отстают — просто мягче
    check("часы отстают: за 8 с до старта → свежее", g2.is_stale(msg(real_boot - 8)) is False)
    check("часы отстают: за 3 ч → всё равно старое", g2.is_stale(msg(real_boot - 3 * 3600)) is True)
    # Главное: очередь при запуске известна → ВСЁ, что пришло после неё, свежее,
    # даже если часы ПК спешат на 5 минут (раньше первые ~3 мин после старта
    # свежие сообщения считались бы старыми и игнорировались).
    g3 = su.StaleGate(boot_ts=real_boot + 300)
    g3.set_backlog(1)
    check("часы спешат: старое из очереди → пропущено", g3.is_stale(msg(real_boot - 3 * 3600)) is True)
    check("часы спешат: живое сразу после старта (вне очереди) → ОБРАБОТАНО", g3.is_stale(msg(real_boot + 5)) is False)
    check("часы спешат: живое через минуту → обработано", g3.is_stale(msg(real_boot + 60)) is False)
    g4 = su.StaleGate(boot_ts=real_boot)
    g4.set_backlog(0)
    check("очередь пуста → даже «старое» по дате не трогаем (это не накопленное)", g4.is_stale(msg(real_boot - 3600)) is False)


def test_window_and_single_notice():
    """Конец очереди виден по счётчику; окно страхует неверный/неизвестный размер
    очереди; второго уведомления чату не бывает."""
    now = [1000.0]
    clock = lambda: now[0]
    t_old = BOOT - 3 * 3600
    # размер очереди неизвестен + часы ПК спешат на 10 мин: по дате судим только в окне
    g = su.StaleGate(boot_ts=BOOT + 600, clock=clock)
    g.arm()
    # (цена неизвестности: в окне живое при спешащих часах ещё может счесться старым)
    g.is_stale(msg(BOOT + 5))
    now[0] += su.WINDOW_SEC + 1
    check("…но после окна — обработано (бот не «глохнет» надолго)", g.is_stale(msg(BOOT + 70)) is False)
    check("после окна очередь считается разобранной", g.backlog_done)
    # Telegram пообещал 5, отдал 2 (часть устарела): после окна кнопки снова работают
    g2 = su.StaleGate(boot_ts=BOOT, clock=clock)
    g2.set_backlog(5); g2.arm()
    g2.is_stale(msg(t_old)); g2.is_stale(msg(t_old))
    check("pending_update_count больше, чем пришло: в окне нажатие ещё считается старым",
          g2.is_stale(press(BOOT)) is True and not g2.backlog_done)
    now[0] += su.WINDOW_SEC + 1
    check("…после окна — работает", g2.is_stale(press(BOOT)) is False and g2.backlog_done)
    # конец очереди известен: готовность уведомлять — только когда очередь разобрана
    g3 = su.StaleGate(boot_ts=BOOT, clock=clock)
    g3.set_backlog(3); g3.arm()
    for _ in range(2):
        u = msg(t_old)
        g3.is_stale(u); g3.record(u)
    now[0] += 30                                     # долгая пауза ВНУТРИ очереди (медленная сеть)
    check("очередь ещё не разобрана → таймер не шлёт (не будет «половинного» уведомления)",
          not g3.ready(42, 2.0) and not g3.backlog_done)
    u = press(BOOT); g3.is_stale(u); g3.record(u)
    check("последний апдейт очереди → очередь разобрана, уведомлять пора", g3.backlog_done and g3.ready(42, 2.0))
    text = g3.pop_notice(42, now=BOOT)
    check("в уведомлении полный счёт: 2 сообщения и 1 нажатие", "2 сообщения и 1 нажатие кнопки" in text)
    late = msg(t_old)
    check("старое, пришедшее ПОСЛЕ уведомления, второго уведомления не вызывает",
          g3.record(late) is False and not g3.has_pending(42) and g3.pop_notice(42) is None)
    # очередь неизвестна: таймер ждёт тишины в потоке старых апдейтов
    g4 = su.StaleGate(boot_ts=BOOT, clock=clock)
    g4.arm()
    u = msg(t_old); g4.is_stale(u); g4.record(u)
    check("очередь неизвестна: сразу после старого — не готов", not g4.ready(42, 2.0))
    now[0] += 2.5
    check("…после 2 с тишины — готов", g4.ready(42, 2.0))


# ---------- сквозной: настоящий wled_bot.py + поддельный Telegram ----------
PRE_BACKLOG = r'''
import sys, os, json, asyncio, runpy, time
_real_time = time.time                      # часы Telegram (верные)
SCEN = os.environ.get("E2E_SCEN", "downtime")
SKEW = float(os.environ.get("E2E_SKEW", "0"))
if SKEW:
    time.time = lambda: _real_time() + SKEW   # часы ПК врут
import telegram.request._httpxrequest as hx
CHAT = {"id": 42, "type": "private", "first_name": "Stanley"}
USER = {"id": 42, "is_bot": False, "first_name": "Stanley"}
BOT = {"id": 1, "is_bot": True, "first_name": "INTELLECT", "username": "x_bot"}
n = {"gu": 0, "msg": 1000, "uid": 100}; ST = {}; LAST = [_real_time()]
def _msg(ts, text):
    n["uid"] += 1; uid = n["uid"]
    m = {"message_id": uid, "date": int(ts), "chat": CHAT, "from": USER, "text": text}
    if text.startswith("/"):
        m["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text)}]
    return {"update_id": uid, "message": m}
def _cb(cid, data, dash_ts):
    n["uid"] += 1; uid = n["uid"]
    return {"update_id": uid, "callback_query": {"id": cid, "from": USER, "chat_instance": "ci", "data": data,
            "message": {"message_id": 7, "date": int(dash_ts), "chat": CHAT, "from": BOT, "text": "panel"}}}
def backlog(now):
    t0 = now - 3 * 3600
    ups = []
    if SCEN == "slowcb":                    # много старых нажатий, сеть/ПК медленные
        ups += [_msg(t0 + i * 60, "Ку") for i in range(5)]
        ups += [_cb("cbOLD%d" % i, "toggle", t0 - 600) for i in range(6)]
        ups += [_msg(t0 + 600 + i * 60, "Ау") for i in range(5)]
        return ups
    if SCEN in ("fastclock", "noinfo"):
        return [_msg(t0 + i * 60, "Ку") for i in range(3)]
    texts = ["И как?", "Ворк?", "Не запустился получается", "Ау", "Ку", "Ку", "Ну", "И шо"]
    for i in range(13):
        ups.append(_msg(t0 + i * 800, "/start"))
        if i < len(texts):
            ups.append(_msg(t0 + i * 800 + 60, texts[i]))
    ups.append(_cb("cbOLD", "toggle", t0 - 600))        # нажата часы назад
    ups.append(_msg(now - 8, "Лампу выключи"))           # во время перезапуска
    ups.append(_cb("cbBOOT", "toggle", t0 - 600))       # нажата, пока бот грузился
    return ups
async def fake(self, url, method, request_data=None, read_timeout=None, write_timeout=None,
               connect_timeout=None, pool_timeout=None):
    m = url.rsplit("/", 1)[-1]
    p = request_data.parameters if request_data else {}
    ok = lambda r: (200, json.dumps({"ok": True, "result": r}).encode())
    now = _real_time()
    if m != "getUpdates":
        LAST[0] = now
    if m == "getMe":
        return ok(BOT)
    if m == "getWebhookInfo":
        ST["bl"] = backlog(now)
        if SCEN == "noinfo":                    # Telegram не ответил — размер очереди неизвестен
            return 502, json.dumps({"ok": False, "error_code": 502, "description": "Bad Gateway"}).encode()
        return ok({"url": "", "has_custom_certificate": False, "pending_update_count": len(ST["bl"])})
    if m == "getUpdates":
        n["gu"] += 1
        if n["gu"] == 1:
            return ok(ST.get("bl") or backlog(now))
        if n["gu"] == 2 and SCEN == "downtime":
            await asyncio.sleep(5)
            return ok([_cb("cbLIVE", "refresh", now - 3 * 3600)])   # старая панель, живое нажатие
        if n["gu"] == 2 and SCEN == "fastclock":
            await asyncio.sleep(1)
            return ok([_msg(_real_time() - 1, "Лампу выключи")])    # набрано только что
        if n["gu"] == 6 and SCEN == "noinfo":
            return ok([_msg(_real_time() - 1, "Лампу выключи")])    # живое — уже после уведомления
        await asyncio.sleep(1)
        if n["gu"] >= 5 and _real_time() - LAST[0] > 3:
            print("E2E_DONE", flush=True)
        return ok([])
    if m in ("sendMessage", "sendPhoto", "editMessageText"):
        n["msg"] += 1
        txt = str(p.get("text") or p.get("caption") or "")
        print("API %s %s" % (m, txt.replace("\n", " / ")[:160]), flush=True)
        return ok({"message_id": n["msg"], "date": int(now), "chat": CHAT, "from": BOT, "text": txt})
    if m == "answerCallbackQuery":
        cid = str(p.get("callback_query_id"))
        if SCEN == "slowcb":
            await asyncio.sleep(0.6)
        print("API answerCallbackQuery %s %s" % (cid, p.get("text") or ""), flush=True)
        if cid.startswith("cbOLD"):
            return 400, json.dumps({"ok": False, "error_code": 400, "description":
                "Bad Request: query is too old and response timeout expired or query ID is invalid"}).encode()
        return ok(True)
    return ok(True)
hx.HTTPXRequest.do_request = fake
sys.argv = [sys.argv[1]]
runpy.run_path(sys.argv[0], run_name="__main__")
'''


def _free_port():
    import socket as _s
    with _s.socket() as t:
        t.bind(("127.0.0.1", 0))
        return t.getsockname()[1]


def _run_e2e(scen="downtime", skew=0.0, limit=150):
    """Настоящий wled_bot.py в копии проекта; вернуть (строки вывода, вызовы API)."""
    import threading
    work = Path(tempfile.mkdtemp()) / "bot"
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(
        ".env", "__pycache__", "*.db", "*.log", "pc-reports", ".git", "logs"))
    (work / ".env").write_text("WLED_BOT_TOKEN=5550001112:AAFakeFakeFakeFakeFakeFakeFakeFake12\n"
                               "ALLOWED_USERS=42\nWLED_IP=127.0.0.1\nOPENAI_API_KEY=\n", encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("WLED_BOT_TOKEN", "ALLOWED_USERS", "OPENAI_API_KEY")}
    env.update(WEB_PORT="0", INTELLECT_WEB_PORT="0", PYTHONIOENCODING="utf-8",
               INTELLECT_LOCK_PORT=str(_free_port()), E2E_SCEN=scen, E2E_SKEW=str(skew))
    pr = subprocess.Popen([sys.executable, "-c", PRE_BACKLOG, str(work / "wled_bot.py")], cwd=work, env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    killer = threading.Timer(limit, pr.kill)       # зависший бот не повесит весь прогон тестов
    killer.start()
    lines = []
    try:
        for line in pr.stdout:
            lines.append(line.rstrip())
            if "E2E_DONE" in line:
                break
    finally:
        killer.cancel()
        pr.kill(); pr.wait()
        shutil.rmtree(work.parent, ignore_errors=True)
    return lines, [l[4:] for l in lines if l.startswith("API ")]


def test_backlog_after_downtime_e2e():
    lines, api = _run_e2e()
    sends = [a for a in api if a.startswith("sendMessage")]
    notices = [a for a in sends if "пропустил" in a]
    check("бот дошёл до живого опроса", any("E2E_DONE" in l for l in lines))
    check("13 старых /start → ни одного баннера", not any(a.startswith("sendPhoto") for a in api))
    check("ровно одно уведомление о пропущенном", len(notices) == 1)
    check("…посчитано 21 сообщение и 1 нажатие (то, что Telegram уже не принял)",
          bool(notices) and "21 сообщение и 1 нажатие кнопки" in notices[0])
    check("сообщение из окна перезапуска (8 с) обработано — есть ответ", len(sends) == 2)
    check("уведомление пришло ДО ответа на свежее", bool(sends) and sends[0] in notices)
    check("старое нажатие «toggle» не выполнено (панель не перерисована на «ВКЛ»)",
          not any(a.startswith("editMessageText") and "ВКЛ" in a for a in api))
    check("нажатие во время загрузки — подсказка «нажми ещё раз»",
          any(a.startswith("answerCallbackQuery cbBOOT") and "ещё раз" in a for a in api))
    check("живое нажатие на панели 3-часовой давности — работает (панель обновлена)",
          any(a.startswith("answerCallbackQuery cbLIVE") for a in api)
          and sum(a.startswith("editMessageText") for a in api) == 1)
    if _fail:
        print("\n".join(lines[-60:]))


def test_slow_backlog_one_notice_e2e():
    """Старые нажатия: каждое — запрос answerCallbackQuery (0,6 с на слабом ПК).
    Разбор очереди дольше 2 с — раньше чат получал ДВА уведомления с половинным счётом."""
    lines, api = _run_e2e("slowcb")
    notices = [a for a in api if a.startswith("sendMessage") and "пропустил" in a]
    check("медленная очередь: бот дошёл до живого опроса", any("E2E_DONE" in l for l in lines))
    check("медленная очередь: ровно одно уведомление", len(notices) == 1)
    check("…и в нём полный счёт: 10 сообщений и 6 нажатий",
          bool(notices) and "10 сообщений и 6 нажатий кнопок" in notices[0])
    check("…и оно после разбора всей очереди (после последнего нажатия)",
          bool(notices) and api.index(notices[0]) >
          max((i for i, a in enumerate(api) if a.startswith("answerCallbackQuery")), default=len(api)))
    if _fail:
        print("\n".join(lines[-60:]))


def test_fast_pc_clock_live_message_e2e():
    """Часы ПК спешат на 10 мин: живое сообщение сразу после запуска НЕ должно
    считаться старым (раньше порог по дате действовал на все сообщения)."""
    lines, api = _run_e2e("fastclock", skew=600)
    sends = [a for a in api if a.startswith("sendMessage")]
    notices = [a for a in sends if "пропустил" in a]
    check("часы спешат: одно уведомление о 3 старых", len(notices) == 1 and "3 сообщения" in notices[0])
    check("часы спешат: живое «Лампу выключи» обработано (есть ответ)", len(sends) == 2)
    if _fail:
        print("\n".join(lines[-60:]))


def test_unknown_backlog_e2e():
    """getWebhookInfo не ответил: старое всё равно пропущено (по дате), уведомление —
    одно (по таймеру тишины), живое после него — обработано."""
    lines, api = _run_e2e("noinfo")
    sends = [a for a in api if a.startswith("sendMessage")]
    notices = [a for a in sends if "пропустил" in a]
    check("без getWebhookInfo: бот дошёл до живого опроса", any("E2E_DONE" in l for l in lines))
    check("без getWebhookInfo: одно уведомление о 3 старых", len(notices) == 1 and "3 сообщения" in notices[0])
    check("без getWebhookInfo: живое сообщение обработано, уведомление — раньше",
          len(sends) == 2 and sends[0] in notices)
    if _fail:
        print("\n".join(lines[-60:]))


def test_edited_message_does_not_crash_handlers():
    """Правка старого сообщения не должна попадать в on_text (там update.message = None)."""
    import inspect, re
    from telegram import Update
    from telegram.ext import filters
    src = (ROOT / "wled_bot.py").read_text(encoding="utf-8")
    m = re.search(r"MessageHandler\((.+?),\s*on_text\)", src)
    check("обработчик текста ограничен новыми сообщениями (UpdateType.MESSAGE)",
          bool(m) and "UpdateType.MESSAGE" in m.group(1))
    m2 = re.search(r"MessageHandler\((.+?),\s*on_voice\)", src)
    check("обработчик голоса тоже", bool(m2) and "UpdateType.MESSAGE" in m2.group(1))
    flt = filters.TEXT & ~filters.COMMAND & filters.UpdateType.MESSAGE
    base = {"message_id": 7, "date": 1794650000, "chat": {"id": 42, "type": "private"},
            "from": {"id": 42, "is_bot": False, "first_name": "U"}, "text": "Ку"}
    edited = Update.de_json({"update_id": 1, "edited_message": dict(base, edit_date=1794650100)}, None)
    fresh = Update.de_json({"update_id": 2, "message": base}, None)
    check("правка сообщения фильтром НЕ ловится", not flt.check_update(edited))
    check("новое сообщение ловится", bool(flt.check_update(fresh)))


if __name__ == "__main__":
    print("=== Старые апдейты после простоя: без спама, одно уведомление ===")
    for t in (test_messages, test_callbacks, test_one_notice_per_chat, test_plural,
              test_clock_skew_is_bounded, test_window_and_single_notice,
              test_backlog_after_downtime_e2e, test_slow_backlog_one_notice_e2e,
              test_fast_pc_clock_live_message_e2e, test_unknown_backlog_e2e,
              test_edited_message_does_not_crash_handlers):
        print(f"\n[{t.__name__}]"); t()
    print(f"\nИТОГ: {_ok} ok, {_fail} fail")
    sys.exit(1 if _fail else 0)
