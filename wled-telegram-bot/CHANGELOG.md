# CHANGELOG — INTELLECT

## 2.0.0-dev (в разработке)

### Этап 1 — Аудит
- Полный разбор существующих модулей (см. ARCHITECTURE.md).
- Точка отката: git-тег `intellect-1.0-pre2.0`.

### Этап 2 — Фундамент
- `intellect/config.py`: централизованная конфигурация из `.env`,
  тип `Secret` (секреты не попадают в логи/repr), `settings.describe()`.
- `intellect/db/`: слой SQLite (WAL, foreign keys), система миграций,
  12 таблиц по ТЗ (users, conversations, messages, memories, devices,
  device_states, automations, automation_runs, tasks, notifications,
  settings, audit_logs).
- `intellect/security/`: аудит действий с вычисткой секретов (`redact`),
  роли (admin/user), список опасных действий с требованием подтверждения.
- `intellect/core/`: интерфейсы модулей (AIProvider, Device, MemoryStore).
- Тесты: `tests/test_foundation.py` — 16/16 пройдено.

### Дальше
- Этап 3 — AI Brain (роутинг моделей, провайдер OpenAI, инструменты).
- Этап 4 — Memory Engine (семантический поиск на эмбеддингах).
- Этапы 5–10 — голос, устройства, автоматизации, ПК, веб-панель, тесты.

### Этапы 3–10 (выполнено)
- Этап 3 AI Brain, Этап 4 Memory, Этап 5 Voice, Этап 6 Devices,
  Этап 7 Automation, Этап 8 Computer, Этап 9 Web-панель, Этап 10 интеграция.
- Оркестратор `intellect/app.py` связал всё; бот `wled_bot.py` маршрутизирует
  текст/голос через ядро, поток подтверждений, новая панель на :8090.
- Документы: SECURITY.md, API.md, INSTALLATION.md, GITHUB_RESEARCH.md, TEST_REPORT.md.
- Тесты: 102/102.
