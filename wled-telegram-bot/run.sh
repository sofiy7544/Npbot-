#!/usr/bin/env bash
# Запуск WLED-бота в один шаг (Linux / macOS).
# Ставит зависимости, при первом запуске спрашивает настройки и сохраняет в .env.
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "       WLED Telegram Bot — запуск"
echo "============================================"

# 1) Python
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "[!] Python не найден. Установи Python 3.10+."
  exit 1
fi
echo "[1/3] Python: $PY"

# 2) Зависимости
echo "[2/3] Проверяю зависимости..."
"$PY" -m pip install --quiet --upgrade pip || true
"$PY" -m pip install --quiet -r requirements.txt --break-system-packages 2>/dev/null \
  || "$PY" -m pip install --quiet -r requirements.txt
echo "      Готово."

# 3) Первый запуск — настройки в .env
if [ ! -f ".env" ]; then
  echo
  echo "Первый запуск. Введи 3 значения (сохранятся в .env):"
  read -r -p "1) Токен бота от @BotFather: " TOKEN
  read -r -p "2) Твой Telegram ID (у @userinfobot): " USERID
  read -r -p "3) IP лампы WLED [Enter = 192.168.1.106]: " LAMPIP
  LAMPIP="${LAMPIP:-192.168.1.106}"
  {
    echo "WLED_BOT_TOKEN=$TOKEN"
    echo "ALLOWED_USERS=$USERID"
    echo "WLED_IP=$LAMPIP"
  } > .env
  echo "Настройки сохранены в .env"
fi

# 4) Запуск
echo "[3/3] Запускаю бота. Ctrl+C — остановить."
echo "============================================"
exec "$PY" wled_bot.py
