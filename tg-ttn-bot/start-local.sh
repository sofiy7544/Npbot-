#!/usr/bin/env bash
# tg-ttn-bot — simple local run (MOCK mode, NO database). Needs Node.js + a token.
# (start.bat / npm run dev uses main.ts which requires Postgres+Redis — heavier.)
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — open it and set TG_BOT_TOKEN, then run again."
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (1-2 min first time)..."
  npm install --no-fund --no-audit --ignore-scripts
fi

echo "Bot starting in MOCK mode (fake TTNs 9999...). Ctrl+C to stop."
npm run dev:legacy
