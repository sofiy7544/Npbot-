# CLAUDE.md

Guidance for AI assistants working in this repository.

## Overview

Monorepo with two cooperating projects for a Stanley-thermos dropshipping shop
(Ukrainian market):

- **`stanley-brand-site/`** — storefront + admin panel. Static front-end that
  forwards orders to a Telegram group; an optional `backend/` Node server adds
  Monobank acquiring and server-side Telegram forwarding.
- **`tg-ttn-bot/`** — Telegram bot that reads order messages, parses them
  (regex + optional AI fallback), and creates Nova Poshta TTN waybills.

The site **produces** order text in Telegram; the bot **consumes** it and makes
the TTN. They are independent — each runs and is tested on its own.

User-facing language is Ukrainian/Russian. Match it in new strings.

---

## `tg-ttn-bot/` — the TTN bot

TypeScript, ESM (`"type": "module"`, imports use `.js` extensions), Node ≥20.

### Architecture (clean / hexagonal) — `src/`
```
domain/          Entities + value objects (Phone, Money), order fingerprint. Pure, no I/O.
application/     Use-cases (IngestMessage, CreateTtn, SyncNpWarehouses) + ports (interfaces).
infrastructure/  Adapters: nova-poshta/ (HTTP client + mock), telegram/, persistence/ (Prisma
                 repos), redis/ (rate limiter), ai/ (ClaudeExtractor), parser/ (the order parser).
presentation/    bot/ (grammy handlers + views), admin/ (Fastify admin API).
jobs/            BullMQ worker + warehouse-sync job/CLI.
shared/          config (zod-validated env), logger (pino), Result type.
main.ts          Composition root (main.container.ts wires deps). Legacy single-file entry: index.ts.
```

There is a **legacy flat layer** (`src/parser.ts`, `src/handlers.ts`, `src/np-client.ts`,
`src/format.ts`, `src/state.ts`, `index.ts`) alongside the new architecture. The
parser is the workhorse — it handles 264+ Ukrainian order formats, typo
correction, postomat/branch detection, COD/prepaid classification, and a bundled
428-city dictionary.

### Running it
- **Mock mode** (default when `NP_API_KEY` is empty): creates FAKE TTNs starting
  with `9999`. No Nova Poshta account needed. Set `TG_BOT_TOKEN` and go.
- **Real TTNs**: fill `NP_API_KEY` + sender Refs in `.env` (see `QUICK-START.md`
  "Phase 3").
- Commands: `npm run dev` (tsx watch), `npm run build` then `npm start`,
  `npm run worker` (queue), `npm run admin` (admin API),
  `npm run sync:warehouses` (NP warehouse sync).
- Full stack: `docker compose up -d --build` (Postgres + Redis + queue).

### Tests — IMPORTANT gotcha
The test files (`src/**/*.test.ts`) are **legacy tsx scripts**, NOT vitest
suites — they use a custom `assert()` with `console.log` ✅/❌ and run via `tsx`.
`npm test` (`vitest run`) reports "No test suite found" for all of them — that is
a packaging mismatch, **not** a real failure. Run them the real way:
```bash
for f in $(find src -name '*.test.ts'); do npx tsx "$f"; done
```
Verified: **265 assertions pass, 0 fail** across 16 files (parser, segmenter,
payment-classifier, Money, Phone, fingerprint, sync-diff).

### Config
`.env.example` is the source of truth for env vars (Telegram, DB, Redis, NP API,
AI keys, rate limits, admin API). Copy to `.env`. The AI fallback uses Claude
(`ANTHROPIC_API_KEY`, model `claude-3-5-haiku-...`) only when regex parsing
fails to fill required fields, cached 30 days by message hash. `OPENAI_API_KEY`
is a secondary fallback.

---

## `stanley-brand-site/` — storefront + admin

Static site, no build step. Open `index.html` (shop) / `admin.html` (admin,
password-gated, config in `localStorage`). Serve with `python3 -m http.server`.

### Patch-layer convention
The base page is extended by **layered patch files**, loaded in order in
`index.html`. Do NOT rewrite the base — add/adjust the matching patch:
- `mobile-cro-patch.{css,js}` — mobile/CRO fixes
- `account-v3-patch.{css,js}` — account UI
- `premium-patch{,-v2..v6}.{css,js}` — successive premium passes (v6 is newest)
- `admin-premium.{css,js}` — admin polish

Order overrides (products, colors, banner, sold-counter) live in `localStorage`
keys prefixed `dua_admin_*`, set from the admin panel.

Orders are forwarded to Telegram by `premium-patch.js`
(`sendOrderDirectToBot()`) — checkout does NOT call `window.open()`. Telegram
credentials are read from admin config, never hardcoded in the front-end.

### `backend/` (optional Node server)
`server.js` + `.env.example`: Monobank acquiring + server-side order forwarding
to Telegram. Configure via `.env` (Monobank token, Telegram bot token + chat id,
CORS origins). `.env.example` uses placeholders.

### Many `*-AUDIT.md` / `CHANGELOG-*.md`
These document past review rounds. Useful history; not load-bearing.

---

## Conventions & guardrails

- **Secrets: never commit real tokens.** Only `*.env.example` with placeholders
  belong in git. A real Telegram bot token was found hardcoded in the site's
  `backend/` docs + `.env.example` and was **redacted** before the first commit;
  audit docs still reference it in truncated form by design. If a real token
  ever appears, redact it and tell the user to revoke it in @BotFather.
- `.gitignore` excludes `node_modules/`, `dist/`, `.env`, `logs/`, Prisma
  generated client. Don't commit them.
- **Match the existing layer/style**: bot = clean architecture + `.js` ESM
  imports; site = patch files, not base rewrites.
- Keep UI text Ukrainian/Russian.

## Environment notes (this sandbox)
- `npm install` fails on **Prisma's postinstall** (engine download from
  `binaries.prisma.sh` is blocked). Use `npm install --ignore-scripts`; parser
  and domain tests don't need the Prisma engine.
- `tsc --noEmit` reports ~19 errors, **all** stemming from the un-generated
  `@prisma/client` (run `prisma generate` where the engine host is reachable to
  clear them). Non-Prisma code typechecks clean.
- Outbound to `api.telegram.org`, `novaposhta.ua`, `binaries.prisma.sh` is
  blocked here — live bot polling / real TTNs / Prisma generate must be done on
  a machine with open network. These are environment limits, not code defects.

## Git workflow
Active branch for assistant work: `claude/claude-md-docs-tkeav6`.
Commit with clear messages; `git push -u origin <branch>`. No PRs unless asked.
