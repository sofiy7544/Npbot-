#!/bin/bash
# =============================================================================
# tools/build_release.sh — собрать архив INTELLECT-2.0.zip для ПК пользователя.
#
#   tools/build_release.sh <папка_вывода> [путь/к/.env_пользователя]
#
# Что делает:
#   1. Копирует проект в <вывод>/INTELLECT-2.0, выкидывает мусор и то, что
#      нельзя перезаписывать у пользователя (журналы, база, tv.json, токен ТВ…).
#   2. Переводит все .bat/.cmd в CRLF (Windows) и проверяет, что они ASCII.
#   3. Пишет BUILD_INFO.txt: версия, дата, коммит, контрольные суммы файлов.
#   4. Если передан .env — проверяет, что токен настоящий (не шаблон),
#      и кладёт его внутрь архива (пользователь просил: ключи в архиве).
#   5. ЗАЩИТА: настоящие секреты (из переданного .env и из .env проекта)
#      не должны встречаться НИ В ОДНОМ другом файле архива — иначе сборка
#      падает. (Однажды в тестах оказался почти настоящий токен.)
#   6. Упаковывает <вывод>/INTELLECT-2.0.zip и кладёт рядом HANDOFF.md,
#      чтобы его можно было отправить отдельным файлом.
#
# После сборки ОБЯЗАТЕЛЬНО: tests (python tests/run_all.py в собранной папке)
# и tools/test_bats.sh <вывод>/INTELLECT-2.0 — см. HANDOFF.md.
# =============================================================================
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$1"
OUT="$(cd "$1" && pwd)"
USER_ENV="${2:-}"
STAGE="$OUT/INTELLECT-2.0"
PY="${PYTHON:-python3}"

rm -rf "$STAGE" "$OUT/INTELLECT-2.0.zip"
cp -a "$SRC" "$STAGE"
cd "$STAGE"

# 1) мусор и пользовательское состояние (у пользователя их НЕ перезаписываем)
find . \( -name .git -o -name __pycache__ -o -name '*.pyc' -o -name .venv -o -name venv \
  -o -name .deps_ok -o -name .optimized -o -name 'intellect.db*' -o -name logs \
  -o -name pc-reports -o -name '*.log' -o -name '*.log.*' -o -name intellect-report.zip \
  -o -name .env -o -name access.json -o -name tv.json -o -name tv_token.txt \) -prune -exec rm -rf {} +

# 2) .bat → CRLF + ASCII
for f in $(find . -name '*.bat' -o -name '*.cmd'); do
  sed -i 's/\r$//; s/$/\r/' "$f"
  if LC_ALL=C grep -qP '[^\x00-\x7F]' "$f"; then echo "ОШИБКА: не-ASCII в $f"; exit 1; fi
done

# 3) паспорт сборки
VER="$(head -1 VERSION 2>/dev/null || echo '?')"
{
  echo "INTELLECT $VER"
  echo "Собрано: $(date -u '+%Y-%m-%d %H:%M UTC')"
  if git -C "$SRC" rev-parse --short HEAD >/dev/null 2>&1; then
    echo "Последний коммит: $(git -C "$SRC" rev-parse --short HEAD)"
    if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
      echo "ВНИМАНИЕ: в сборке есть изменения, которых нет в коммитах (источник истины — этот архив)."
    fi
  fi
  echo
  echo "Контрольные суммы (sha256):"
  find . -type f ! -name BUILD_INFO.txt | LC_ALL=C sort | xargs -d '\n' sha256sum
} > BUILD_INFO.txt

# 4) .env пользователя (по желанию)
if [ -n "$USER_ENV" ]; then
  "$PY" - "$USER_ENV" <<'EOF'
import sys
sys.path.insert(0, ".")
import startup_checks as sc
vals = {}
for line in open(sys.argv[1], encoding="utf-8-sig"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("="); vals[k.strip()] = v.strip()
p = sc.config_problem(vals.get("WLED_BOT_TOKEN"), vals.get("ALLOWED_USERS"))
if p:
    sys.exit(f"ОШИБКА: .env пользователя не годится: {p}")
print(".env пользователя: ок (токен настоящий, не шаблон)")
EOF
  cp "$USER_ENV" .env
fi

# 5) защита от утечки настоящих секретов в другие файлы
"$PY" - "$SRC/.env" "${USER_ENV:-}" <<'EOF'
import os, sys
secrets = set()
for path in sys.argv[1:]:
    if not path or not os.path.exists(path):
        continue
    for line in open(path, encoding="utf-8-sig", errors="replace"):
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        if k.strip() in ("WLED_BOT_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY") and len(v) >= 20:
            body = v.split(":", 1)[1] if k.strip() == "WLED_BOT_TOKEN" and ":" in v else v[8:]
            for i in range(0, max(1, len(body) - 11), 6):     # любые 12 символов подряд
                secrets.add(body[i:i + 12])
bad = []
for root, dirs, files in os.walk("."):
    for fn in files:
        p = os.path.join(root, fn)
        if p == "./.env":
            continue
        try:
            t = open(p, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        if any(s in t for s in secrets):
            bad.append(p)
if bad:
    sys.exit("ОШИБКА: фрагмент НАСТОЯЩЕГО секрета найден в: " + ", ".join(bad))
print(f"Проверка утечек: чисто ({len(secrets)} фрагментов секретов проверено)")
EOF

# 6) архив + HANDOFF рядом
cd "$OUT"
zip -qr INTELLECT-2.0.zip INTELLECT-2.0
cp "$STAGE/HANDOFF.md" "$OUT/HANDOFF.md" 2>/dev/null || true
echo "Готово: $OUT/INTELLECT-2.0.zip (версия $VER$( [ -n "$USER_ENV" ] && echo ', С ключами пользователя внутри'))"
echo "Отдельно: $OUT/HANDOFF.md"
