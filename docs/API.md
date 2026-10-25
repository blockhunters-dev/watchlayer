# WatchLayer JSON API (v0)

Public, read-only, CORS `*`. Served by `packages/indexer` (`PORT`, default 20360). Consumed by the dashboard and the bot; open to any client.
Conventions: JSON; all token amounts are **decimal strings in wei** (18 decimals); epochs are decimal strings; timestamps are unix seconds (integer); addresses keep checksum case in responses, lookups are case-insensitive. Unavailable data is `null`, never guessed.

Status: **implemented** unless marked *(planned)*.

## GET /health
`200 {"ok": true, "lastSnapshot": <unix|null>}`

## GET /network
`503 {"error":"no snapshot yet"}` before the first snapshot. Otherwise:
```json
{ "epoch": "2", "nextEpochEstimate": 1792765216, "snapshotAt": 1792701818,
  "validators": { "total": 51, "active": 44, "pending": 4, "banned": 0, "needsPriming": 3 } }
```
| field | notes |
|---|---|
| totalStake | wei string: self + delegated stake of `active` validators |
| txPerHour | transactions in blocks of the last hour (exact block scan), or `null` if the scan failed or could not cover a full hour within its 600-block cap (never a silent undercount) |
| avgBlockSeconds | average seconds between blocks over that hour (chain latency proxy); `null` if fewer than 2 blocks or the scan failed |
| rpc | indexer-observed RPC health: `{uptime24h, runs24h, lastSuccessAt, snapshotDurationMs, avgSnapshotDurationMs}`. `uptime24h` = successful / total collection runs in 24h (`null` with no runs). Every field covers the same 24h window: `lastSuccessAt`, `snapshotDurationMs` and `avgSnapshotDurationMs` are `null` when there was no success in the last 24h. Measured from this indexer's own runs, not a network-wide uptime |

## GET /network/history
Array of `{t, epoch, activeCount, txPerHour}` per snapshot (last 500, oldest first).

## Determinism
Every field of a Validator object (including `activity` and `gasRunwayDays`) is computed at the snapshot's own time (`snapshotAt`), never at request time: two requests that return the same `snapshotAt` return identical objects. (Before this change `activity.silentHours`/`txLast24h` and `gasRunwayDays` used the request time.) `/network` `rpc` is the exception: it is measured against request time. Epoch rows from `*/epochs` are never newer than the latest `snapshotAt`.

## GET /validators
Array of Validator objects from the latest snapshot, ordered by address.

## GET /validators/:address
One Validator, or `404 {"error":"unknown validator"}`. Address must match `0x` + 40 hex.

### Validator object
| field | type | notes |
|---|---|---|
| address | string | validator wallet |
| operator | string | operator address (gas account) |
| moniker | string\|null | registered moniker (same as `identity.moniker`) |
| identity | object | `{moniker, logo, website, github}` registered at staking; each `string\|null`. Normalized by the indexer: `website`, `github` and `logo` are absolute http(s) URLs only (a bare GitHub handle becomes `https://github.com/<handle>`, `ipfs://` logos become `https://ipfs.io/ipfs/...`); anything else, or empty, is `null`. Values are user-supplied: clients must still escape them and use `rel="noopener noreferrer nofollow"` |
| status | `active`\|`pending`\|`banned`\|`needs_priming` | precedence: banned > needs_priming > active > pending |
| vStake, dStake | string | active self / delegated stake, wei |
| pendingDeposits | `{epoch, stakeRaw, activatesAtEpoch, stillPending}[]` | `epoch` = deposit epoch from the staking contract. `activatesAtEpoch` = `epoch + 2` (derived, see below). `stillPending` = `activatesAtEpoch > current epoch`. The contract keeps already-activated deposits in this list until claimed (live: 44 active validators list epoch-0 deposits), so consumers must filter on `stillPending` to show waiting stake |
| operatorBalanceWei | string | operator gas balance |
| gasRunwayDays | number\|null | balance / burn rate over last 24h; only decreases count as burn; null = not measurable |
| activity | object (computed at the snapshot's time) | `{lastTxAt, txLast24h, silentHours}` from operator nonce changes between snapshots. `lastTxAt` = snapshot time the nonce was first seen to increase (null if never); `silentHours` counts from `lastTxAt`, or from the first snapshot if none |
| ban | `{untilEpoch, permanent}`\|null | from the Staking banned list (`getBannedValidators`): the idleness/strike outcome. `untilEpoch` is a decimal string. A validator is `banned` while `permanent` or `untilEpoch > current epoch` (also when the SDK's own `banned` flag is set). Live: 3 validators banned until epoch 4 were previously mislabelled `needs_priming` |
| pendingWithdrawals | `{epoch, stakeRaw}[]` | pending withdrawals from the staking contract; `epoch` = withdrawal epoch, `stakeRaw` in wei. Unbonding delay is not read from the contract, so no ready-epoch is derived |
| firstSeenAt | number\|null | snapshot time the indexer first saw this validator: the start of the observed window |
| bans | `{untilEpoch, permanent, firstSeenAt, lastSeenAt}[]` | one entry per contiguous banned period observed (newest first, max 20). A new entry starts after the validator was seen not banned (or absent from the validator list), even if the new ban has the same `untilEpoch`; a ban that changes while the validator stays banned (extended, or made permanent) updates the same entry. `untilEpoch`/`permanent` are the latest values seen in that period; times are snapshot times first/last seen banned. Stored permanently: not limited by the 500-snapshot `/history` window or by retention, so a ban that started and ended between epoch ends is still reported |
| lastBannedAt | number\|null | newest `lastSeenAt` in `bans`; `null` if never observed banned. "No ban in N days" is `snapshotAt - lastBannedAt >= N*86400`, valid only if `snapshotAt - firstSeenAt >= N*86400` |
| strikes | null | the Staking ABI has no strike counter (only quarantine/ban lists and `ValidatorBannedIdleness` events), so the count is always null; use `ban` for the observable outcome |
| snapshotAt | number | snapshot time |

## GET /validators/:address/history
Last 500 snapshots, oldest first: `{t, status, vStake, dStake, operatorBalanceWei, operatorNonce}`. `404` if unknown. (Per snapshot, not per epoch; consumers may bucket by epoch via `/network/history`.)

## Derived values
- `activatesAtEpoch`: 2-epoch delay is observed on Phase 2 (a deposit made in epoch 2 activates in epoch 4; genesis epoch-0 deposits are active at epoch 2) It is not read from the contract.

## GET /network/epochs
One row per epoch observed, using that epoch's last snapshot (by snapshot id), oldest first:
`{epoch, t, txPerHour, totalStake, validators:{total,active,pending,banned,needsPriming}}`.

## GET /validators/:address/epochs
One row per epoch in which the validator was observed, oldest first, taken from the validator's last snapshot in that epoch (snapshots are identified by id, not timestamp, so same-second snapshots in different epochs stay separate): `{epoch, t, status, vStake, dStake, operatorBalanceWei, operatorNonce, operatorTx}`. `operatorTx` = operator nonce delta since the previous epoch's last snapshot; `null` for the first observed epoch (no baseline). History starts when the indexer first ran, not at genesis. `404` if unknown.

## Limits and retention
- Every list endpoint is bounded: `*/history` returns the last 500 snapshots, `*/epochs` the last 500 epochs.
- Retention (`RETENTION_DAYS`, default 14): full-resolution snapshots older than that are pruned after each collection; the last snapshot of every epoch and the newest snapshot are always kept, so `*/epochs` history is never pruned and `*/history` covers at most the retention window.
- Each snapshot reads the chain epoch once and evaluates ban expiry against that same epoch; the banned list is read in full (all pages).
- Other consumers should use `/validators` (current state, identity included) and `/validators/:address/epochs` for stable per-epoch facts.

## Planned (not implemented; do not depend on them yet)
- Backfill of epochs before the indexer started.
Changing a planned endpoint is free; changing an implemented one requires updating this file and tests in the same commit.

## GET /upgrades
Latest Changelog Guard verdict and every release WatchLayer has seen. Read-only `gen_call` of `get_latest(network)` on
`CHANGELOG_GUARD_ADDRESS` through `GENLAYER_RPC_URL`, every `UPGRADE_CHECK_SECONDS` (600).
`{ enabled, contract, network, latest, history[], checkedAt, error }`; each verdict has `version, network, mandatory,
breaking, deadline, config_changes[], env_changes[], actions[], source_url, firstSeenAt`. `enabled: false` when no address is set.
