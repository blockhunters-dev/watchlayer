# Mandatory-upgrade alert (Changelog Guard)

The bot does not define its own upgrade format. It uses the consumer library of Changelog Guard, an intelligent contract that publishes a verdict on each GenLayer node release (`genlayer-changelog-guard/consumer/index.mjs`): `readLatest(client, address, network)` reads the on-chain verdict (read-only, no key) and `buildAlert(running, verdict)` returns the alert (`null` when up to date or not mandatory). The bot only alerts; it never upgrades or restarts anything.

## Configuration (all three required, else the alert is disabled and the bot logs that)
| env | meaning |
|---|---|
| `CHANGELOG_GUARD_CONSUMER` | path to Changelog Guard's `consumer/index.mjs` (not published as a package) |
| `CHANGELOG_GUARD_ADDRESS` | deployed ChangelogGuard contract address |
| `NODE_VERSION` | the node version the operator is running (the WatchLayer API has no such field) |
| `CHANGELOG_GUARD_NETWORK` | optional, default `bradbury-phase2` |

The read uses the public HTTP RPC (`RPC_URL`); no validator, node or WebSocket key.

## Behaviour (`packages/bot/src/upgrade.ts`)
Checked every `ALERT_CHECK_SECONDS`. Each subscribed chat gets the alert text once per `(version, severity)`: it re-alerts once if the same upgrade turns critical (overdue or breaking). Failed sends are retried per chat; a chat that blocked the bot is unsubscribed. A failed chain read is logged and retried next run.

## Tests and pinned version
`packages/bot/test/fixtures/changelog-guard-consumer/` holds a copy of the consumer pinned by content: `manifest.json` records the source and a SHA-256 for every file. `packages/bot/test/upgrade-compat.test.ts` always runs against that copy and exercises the real `readLatest` (call shape `get_latest(network)`, Map/bigint conversion) and `buildAlert` through the bot's `checkUpgrade`. A second test compares a sibling `genlayer-changelog-guard` checkout with the manifest and fails if the consumer drifted (skipped when no checkout is present).

## Status
Disabled on the public instance until Changelog Guard is deployed on Bradbury and its address is configured.
