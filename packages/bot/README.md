# WatchLayer bot

Telegram (grammY) alert bot for GenLayer Bradbury validators. Kept as its own package so it can be split into a separate repo for the "Tooling for running a Validator" submission. It reads the WatchLayer JSON API (`docs/API.md`).

## Run
```
cp .env.example .env        # set TELEGRAM_BOT_TOKEN (from @BotFather); never commit it
npm run dev -w @watchlayer/bot
```
Env: `TELEGRAM_BOT_TOKEN` (required), `API_URL`, `BOT_DB_PATH`, `ALERT_CHECK_SECONDS` (120), `SILENT_HOURS` (6), `CHANGELOG_GUARD_CONSUMER` / `CHANGELOG_GUARD_ADDRESS` / `NODE_VERSION` (optional, see below).

## Commands
`/watch 0x…` · `/unwatch 0x…` · `/list` · `/status 0x…`

## Alerts (edge-triggered; sent once per condition, re-armed when it clears)
Operator gas runway < 3 days, then < 1 day · banned · needs priming · pending stake became active · operator sent no transaction for `SILENT_HOURS` while active.
Ban start/end include the ban window; strike counters are not on-chain, so `/status` states that instead of a number.
Mandatory node upgrade: read from Changelog Guard through C's consumer library (`docs/UPGRADE-ALERT.md`); alert only, never upgrades.
