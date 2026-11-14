# API — веб-панель INTELLECT 2.0

Базовый URL: `http://<IP-ПК>:8090`. Все `/api/*` требуют заголовок
`X-Intellect-Token: <ACCESS_PASSWORD>` (иначе 401).

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /api/status | — | состояние AI, голоса, устройств, счётчики |
| GET | /api/devices | — | снимок состояния устройств |
| POST | /api/devices/command | {device, command} | {ok} |
| POST | /api/chat | {text, confirm?} | {reply, pending_confirmation, did_actions} |
| GET | /api/memory | — | {items:[{id,content,kind}]} |
| POST | /api/memory | {content, kind?} | {id} |
| DELETE | /api/memory | {id} | {ok} |
| GET | /api/automations | — | {items:[…]} |
| POST | /api/automations/toggle | {id, enabled} | {ok} |
| POST | /api/automations/delete | {id} | {ok} |
| GET | /api/tasks | — | {items} |
| POST | /api/tasks/add | {title} | {ok} |
| POST | /api/tasks/done | {id} | {ok} |
| GET | /api/system | — | диагностика ПК |

Статические: `/` (панель), `/manifest.json`, `/icon.png`, `/icon-192.png`, `/icon-512.png`.
