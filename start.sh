#!/usr/bin/env bash
# Stanley Quote Bot — launcher for Linux / macOS (the .bat is the Windows equivalent).
set -e
cd "$(dirname "$0")"

echo "=== Stanley Quote Bot ==="

# Use a local virtualenv so we don't touch the system Python.
if [ ! -d ".venv" ]; then
  echo "Creating virtualenv (.venv)..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "Installing dependencies (first run only)..."
pip install --quiet --disable-pip-version-check -r requirements.txt

echo "Starting bot. Keep this window open. Ctrl+C to stop."
echo
python stanley_bot.py
