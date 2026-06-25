# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Stanley Quote Bot** — a small Telegram bot that turns a product link from
`www.stanley1913.com` into a ready-to-send PDF price quote (Ukrainian-language
"просчёт"/"розрахунок").

Flow: user sends a product URL → bot scrapes price + weight from the Shopify
storefront → applies markup and shipping math → renders a styled PDF card →
replies with the PDF and a short text summary.

Everything is Russian/Ukrainian-facing (UI text, README, PDF labels). Keep new
user-facing strings in the same language as the surrounding code.

## Project layout

```
stanley_bot.py     Main entry point: Telegram handlers, message parsing,
                   scraping, and the price calculation.
quote_pdf.py       PDF renderer (fpdf2). build_pdf(data, out_path) draws the
                   quote card. Runnable standalone to preview a sample PDF.
selftest.py        Offline smoke test. Stubs telebot + a fake token, mocks the
                   Shopify request, and runs parse_message → scrape → calculate
                   → build_pdf end-to-end. No token, no network needed.
requirements.txt   Python deps: pyTelegramBotAPI, requests, beautifulsoup4, fpdf2
token.txt          Telegram bot token, one line. Ships as a PLACEHOLDER
                   (comment lines only) — must be filled in to run.
start.bat          Windows launcher (installs deps, runs the bot).
start.sh           Linux/macOS launcher (creates .venv, installs deps, runs).
README.txt         End-user setup guide (non-technical, Russian).
```

There is no package manifest and no CI. The only test is `selftest.py`, an
offline smoke test (see below). It's a single-purpose script meant to be run on
an operator's machine.

## How it works (key modules)

### `stanley_bot.py`
- **Config block** (top of file): `MARKUP = 1.5`, `SHIP_PER_KG = 9`,
  `DEFAULT_QTY = 30`, plus unit-conversion constants. Change pricing behavior
  here.
- `read_token()` — reads `token.txt`, skips `#` comment lines, exits with a
  friendly message if no token is present. Called at **import time** when
  constructing `bot = telebot.TeleBot(...)`, so importing the module requires a
  token file with a real (or at least non-comment) value.
- `parse_message(text)` → `(url, qty, kg_override)`. Extracts the first URL via
  regex; bare integers become quantity, decimals become a manual per-unit weight
  in kg. Accepts `,` as a decimal separator.
- `scrape(url)` — fetches `{base}/products/{handle}.json` (Shopify product JSON),
  picks an available variant (else the first), reads `price` and `grams`. Falls
  back to `weight_from_page()` (HTML scrape for `Weight: X lb`) when grams are
  missing. Returns name/size/price/kg_each/available.
- `size_string(title)` — derives a litres spec from `QT`/`OZ` in the title.
- `calculate(p, qty, kg_override)` — the money math: `unit = price * MARKUP`,
  `goods = unit * qty`, `shipping = kg_each * qty * SHIP_PER_KG`,
  `total = goods + shipping`. Raises `ValueError("WEIGHT_UNKNOWN")` if no weight
  is available so the handler can prompt the user to supply one.
- Telegram handlers: `/start` and `/help` send the welcome text; all other text
  is treated as a quote request. Errors are reported by editing the
  "Считаю… 🔄" status message.
- Runs via `bot.infinity_polling(skip_pending=True)` — long-polling, no webhook.

### `quote_pdf.py`
- `build_pdf(data, out_path)` renders a fixed 110×150 mm card using fpdf2.
- `_font_paths()` needs a Cyrillic-capable TTF: Windows `arial.ttf`/`arialbd.ttf`
  or Linux DejaVu (`/usr/share/fonts/truetype/dejavu/DejaVuSans*.ttf`). It raises
  if neither is found — install DejaVu fonts on headless Linux.
- The `data` dict contract is exactly what `calculate()` returns (name, size,
  qty, unit_price, goods, kg_each, total_kg, shipping, total, ship_rate). If you
  change one, change both.

### `selftest.py`
- The fast feedback loop for changes to `stanley_bot.py` / `quote_pdf.py`. Run it
  with `python selftest.py` — exits `0` on success, `1` with a list of failed
  checks otherwise, and writes `selftest_quote.pdf` so you can eyeball the card.
- Works around the import-time side effects: it injects a stub `telebot` module
  and a fake `token.txt` (via a patched `open`) *before* importing `stanley_bot`,
  then monkeypatches `sb.requests.get` to return a canned Shopify product JSON.
  No bot token and no network access are required.
- Covers `parse_message` (incl. `,` decimal separator + the "no URL" path),
  `scrape` against the mock, the full `calculate` money math, the
  `WEIGHT_UNKNOWN` path, and that `build_pdf` produces a non-trivial file.
- If you change `calculate()`'s math or the `data` dict contract, update the
  expected numbers and assertions here too.

## Running locally

**Windows (intended audience):** put the token in `token.txt`, double-click
`start.bat`.

**Linux/macOS / this dev environment:**
```bash
./start.sh                 # creates .venv, installs deps, runs the bot
# or manually:
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python stanley_bot.py      # requires a real token in token.txt
```

To run the bot you need a token from `@BotFather` written into `token.txt`.

**Quick checks without a token / without Telegram:**
```bash
# Run the full offline smoke test (parse → scrape → calculate → build_pdf).
# Stubs telebot + token + the Shopify request; writes selftest_quote.pdf:
python selftest.py

# Preview the PDF with sample data (no token, no network):
python quote_pdf.py
```
`selftest.py` is the model for any new import-time-safe test: importing
`stanley_bot` calls `read_token()` and builds the `TeleBot` at module load, so a
token (or a stub) must exist before the import.

Bot usage (in Telegram): send `link`, `link 50`, or `link 50 0.84`
(qty + manual kg/unit when the site doesn't expose weight).

## Conventions & gotchas

- **Secrets:** never commit a real token. `token.txt` is git-ignored against real
  values; it ships only as a placeholder. Don't print token contents in logs or
  chat.
- **Don't commit** `.venv/`, `__pycache__/`, or generated `*.pdf` (see
  `.gitignore`) — this includes `rozrahunok.pdf` and `selftest_quote.pdf`.
- **Import side effects:** `stanley_bot` builds the `TeleBot` at import time, so
  any tooling/tests that import it must provide a token or stub `telebot`.
- **Scraping is fragile by nature:** it depends on Shopify's `/products/*.json`
  shape and the site's HTML. If scraping breaks, check that endpoint first.
- **Network:** the bot needs outbound HTTPS to `telegram.org` and
  `stanley1913.com`. In sandboxed CI/dev environments outbound calls to the store
  may be blocked — that's environmental, not a code bug.
- **Language:** user-facing text is Russian/Ukrainian. Match it.
- Keep `calculate()`'s output dict and `build_pdf()`'s expected keys in sync.

## Git workflow

Active development branch for assistant work: `claude/claude-md-docs-uc9ur7`.
Commit with clear messages; push with `git push -u origin <branch>`. Do not open
pull requests unless explicitly asked.
