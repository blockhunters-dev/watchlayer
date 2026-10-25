import { DatabaseSync } from "node:sqlite";
import type { ValidatorSnapshot, EpochSnapshot } from "./types.js";
import type { BalanceSample } from "./derive.js";

// bigint values are stored as TEXT: wei amounts overflow SQLite's 64-bit INTEGER.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS epoch_snapshots (
  t INTEGER NOT NULL, epoch TEXT NOT NULL, active_count INTEGER NOT NULL, next_epoch_estimate INTEGER, tx_last_hour INTEGER, avg_block_seconds REAL
);
CREATE TABLE IF NOT EXISTS collect_runs (t INTEGER NOT NULL, ok INTEGER NOT NULL, duration_ms INTEGER NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS validator_snapshots (
  t INTEGER NOT NULL, address TEXT NOT NULL, operator TEXT NOT NULL, moniker TEXT,
  status TEXT NOT NULL, v_stake TEXT NOT NULL, d_stake TEXT NOT NULL,
  pending_deposits TEXT NOT NULL, operator_balance TEXT NOT NULL, operator_nonce INTEGER NOT NULL DEFAULT 0, identity TEXT, ban TEXT,
  pending_withdrawals TEXT,
  snapshot_id INTEGER -- rowid of the epoch_snapshots row saved in the same transaction; the unambiguous snapshot identity
);
-- Permanent, tiny: one row per contiguous banned period per validator (never pruned), and when each validator was first seen.
-- open = the validator was banned in the latest snapshot that contained it; a later non-banned snapshot closes the window,
-- so a second ban with the same until epoch starts a new row.
CREATE TABLE IF NOT EXISTS ban_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, until_epoch TEXT NOT NULL, permanent INTEGER NOT NULL,
  first_t INTEGER NOT NULL, last_t INTEGER NOT NULL, open INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_bw ON ban_windows(address, last_t);
CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS validator_first_seen (address TEXT PRIMARY KEY, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vs ON validator_snapshots(address, t);
`;

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Upgrade databases created before these columns existed.
  for (const [table, col, def] of [["epoch_snapshots", "tx_last_hour", "INTEGER"], ["epoch_snapshots", "avg_block_seconds", "REAL"], ["validator_snapshots", "operator_nonce", "INTEGER NOT NULL DEFAULT 0"], ["validator_snapshots", "identity", "TEXT"], ["validator_snapshots", "ban", "TEXT"], ["validator_snapshots", "snapshot_id", "INTEGER"], ["validator_snapshots", "pending_withdrawals", "TEXT"]]) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  // Rows from before snapshot_id existed: best-effort link by timestamp (latest snapshot at that second).
  db.exec("UPDATE validator_snapshots SET snapshot_id = (SELECT MAX(e.rowid) FROM epoch_snapshots e WHERE e.t = validator_snapshots.t) WHERE snapshot_id IS NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_vs_snap ON validator_snapshots(snapshot_id)");
  migrateBanLog(db);
  return db;
}
export type Db = ReturnType<typeof openDb>;

/**
 * Databases written before ban windows were contiguous periods have a ban_log table keyed by
 * (address, until_epoch, permanent). Runs once (guarded by a schema_meta marker, not by row matching, because
 * migrated windows are later extended and would no longer match): every ban_log row is copied into ban_windows
 * before any history is served. A row stays open when the ban was still running at the validator's newest saved
 * snapshot (that snapshot is at the row's last_t and is "banned"), so a restart during a ban continues the same
 * window; every other row is closed. ban_log is left untouched.
 */
function migrateBanLog(db: DatabaseSync) {
  if (db.prepare("SELECT 1 FROM schema_meta WHERE k = 'ban_log_migrated'").get()) return;
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ban_log'").get();
  db.exec("BEGIN");
  try {
    if (has) {
      db.exec(`INSERT INTO ban_windows (address, until_epoch, permanent, first_t, last_t, open)
        SELECT b.address, b.until_epoch, b.permanent, b.first_t, b.last_t,
          EXISTS (SELECT 1 FROM validator_snapshots v WHERE v.address = b.address AND v.t = b.last_t AND v.status = 'banned'
                  AND v.t = (SELECT MAX(t) FROM validator_snapshots WHERE address = b.address)
                  AND b.last_t = (SELECT MAX(last_t) FROM ban_log WHERE address = b.address))
        FROM ban_log b ORDER BY b.first_t`);
    }
    db.exec("INSERT INTO schema_meta VALUES ('ban_log_migrated', '1')");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

const j = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

export function saveSnapshot(db: Db, t: number, epoch: EpochSnapshot, validators: (ValidatorSnapshot & { status: string })[]) {
  db.exec("BEGIN");
  try {
    const snap = db.prepare("INSERT INTO epoch_snapshots VALUES (?,?,?,?,?,?)").run(
      t, epoch.currentEpoch.toString(), epoch.activeCount,
      epoch.nextEpochEstimate ? Math.floor(epoch.nextEpochEstimate.getTime() / 1000) : null, epoch.txLastHour, epoch.avgBlockSeconds ?? null);
    const id = Number(snap.lastInsertRowid);
    const ins = db.prepare("INSERT INTO validator_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const seen = db.prepare("INSERT OR IGNORE INTO validator_first_seen VALUES (?,?)");
    const openWin = db.prepare("SELECT id FROM ban_windows WHERE address = ? AND open = 1");
    const extendWin = db.prepare("UPDATE ban_windows SET last_t = ?, until_epoch = ?, permanent = ? WHERE id = ?");
    const newWin = db.prepare("INSERT INTO ban_windows (address, until_epoch, permanent, first_t, last_t, open) VALUES (?,?,?,?,?,1)");
    const closeWin = db.prepare("UPDATE ban_windows SET open = 0 WHERE id = ?");
    for (const v of validators) {
      ins.run(t, v.address, v.operator, v.moniker, v.status, v.vStakeRaw.toString(), v.dStakeRaw.toString(),
        j(v.pendingDeposits), v.operatorBalanceWei.toString(), v.operatorNonce, j(v.identity), j(v.ban), j(v.pendingWithdrawals), id);
      seen.run(v.address, t);
      const open = openWin.get(v.address);
      if (v.status === "banned") {
        const until = v.ban ? v.ban.untilEpoch.toString() : "unknown", perm = v.ban?.permanent ? 1 : 0;
        if (open) extendWin.run(t, until, perm, open.id as number); else newWin.run(v.address, until, perm, t, t);
      } else if (open) closeWin.run(open.id as number);
    }
    // A validator that disappeared from the list ends its window; coming back banned starts a new one.
    const present = new Set(validators.map((x) => x.address));
    for (const r of db.prepare("SELECT id, address FROM ban_windows WHERE open = 1").all()) if (!present.has(r.address as string)) closeWin.run(r.id as number);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function balanceSamples(db: Db, address: string, since: number): BalanceSample[] {
  const rows = db.prepare(
    "SELECT t, operator_balance b FROM validator_snapshots WHERE address = ? AND t >= ? ORDER BY t, snapshot_id").all(address, since);
  return rows.map((r) => ({ t: Number(r.t), wei: BigInt(r.b as string) }));
}

export function latestValidators(db: Db) {
  return db.prepare(
    `SELECT * FROM validator_snapshots WHERE snapshot_id = (SELECT MAX(rowid) FROM epoch_snapshots) ORDER BY address`).all();
}
export function latestEpoch(db: Db) {
  return db.prepare("SELECT * FROM epoch_snapshots ORDER BY rowid DESC LIMIT 1").get();
}

export interface NonceSample { t: number; nonce: number }
export function nonceSamples(db: Db, address: string): NonceSample[] {
  return db.prepare("SELECT t, operator_nonce n FROM validator_snapshots WHERE address = ? ORDER BY t, snapshot_id").all(address)
    .map((r) => ({ t: Number(r.t), nonce: Number(r.n) }));
}
export function validatorHistory(db: Db, address: string, limit = 500) {
  return db.prepare(
    "SELECT t, status, v_stake, d_stake, operator_balance, operator_nonce FROM validator_snapshots WHERE address = ? ORDER BY t DESC, snapshot_id DESC LIMIT ?")
    .all(address, limit).reverse();
}
export function networkHistory(db: Db, limit = 500) {
  return db.prepare("SELECT t, epoch, active_count, tx_last_hour FROM epoch_snapshots ORDER BY t DESC, rowid DESC LIMIT ?").all(limit).reverse();
}


export const MAX_EPOCH_ROWS = 500;

export function validatorEpochs(db: Db, address: string, limit = MAX_EPOCH_ROWS) {
  // The validator's last snapshot within each epoch, picked by snapshot identity (not timestamp), so same-second
  // snapshots in different epochs cannot be confused and a validator missing from an epoch's final snapshot
  // still gets that epoch's last row that contains it. limit + 1 rows keep a baseline for operatorTx.
  const rows = db.prepare(
    `SELECT es.epoch, es.t, v.status, v.v_stake, v.d_stake, v.operator_balance, v.operator_nonce
     FROM validator_snapshots v JOIN epoch_snapshots es ON es.rowid = v.snapshot_id
     WHERE v.address = ? AND v.snapshot_id = (
       SELECT MAX(v2.snapshot_id) FROM validator_snapshots v2 JOIN epoch_snapshots e2 ON e2.rowid = v2.snapshot_id
       WHERE v2.address = v.address AND e2.epoch = es.epoch)
     ORDER BY CAST(es.epoch AS INTEGER) DESC LIMIT ?`).all(address, limit + 1).reverse();
  const out = rows.map((r, i) => ({
    epoch: r.epoch as string, t: Number(r.t), status: r.status as string,
    vStake: r.v_stake as string, dStake: r.d_stake as string, operatorBalanceWei: r.operator_balance as string,
    operatorNonce: Number(r.operator_nonce),
    // Operator transactions sent since the previous epoch's last snapshot; unknown for the first observed epoch.
    operatorTx: i === 0 ? null : Math.max(0, Number(r.operator_nonce) - Number(rows[i - 1].operator_nonce)),
  }));
  return out.length > limit ? out.slice(1) : out;
}

export function networkEpochs(db: Db, limit = MAX_EPOCH_ROWS) {
  // One query: epoch-end rows joined to that snapshot's validators, grouped in JS.
  const rows = db.prepare(
    `SELECT e.epoch, e.t, e.tx_last_hour, v.status, v.v_stake, v.d_stake
     FROM epoch_snapshots e
     JOIN (SELECT MAX(rowid) AS id FROM epoch_snapshots GROUP BY epoch ORDER BY CAST(epoch AS INTEGER) DESC LIMIT ?) m
       ON m.id = e.rowid
     LEFT JOIN validator_snapshots v ON v.snapshot_id = e.rowid
     ORDER BY CAST(e.epoch AS INTEGER)`).all(limit);
  const byEpoch = new Map<string, { t: number; txPerHour: number | null; rows: typeof rows }>();
  for (const r of rows) {
    const e = byEpoch.get(r.epoch as string) ?? { t: Number(r.t), txPerHour: r.tx_last_hour as number | null, rows: [] };
    if (r.status !== null) e.rows.push(r);
    byEpoch.set(r.epoch as string, e);
  }
  return [...byEpoch].map(([epoch, e]) => {
    const count = (s: string) => e.rows.filter((r) => r.status === s).length;
    return {
      epoch, t: e.t, txPerHour: e.txPerHour,
      validators: { total: e.rows.length, active: count("active"), pending: count("pending"), banned: count("banned"), needsPriming: count("needs_priming") },
      totalStake: e.rows.filter((r) => r.status === "active").reduce((a, r) => a + BigInt(r.v_stake as string) + BigInt(r.d_stake as string), 0n).toString(),
    };
  });
}

/**
 * Retention: drop full-resolution snapshots older than `days`, but keep the last snapshot of every epoch
 * (the per-epoch history) and the newest snapshot overall. Returns rows deleted.
 */
export function pruneSnapshots(db: Db, now: number, days: number): number {
  const cutoff = now - days * 86400;
  db.prepare("DELETE FROM collect_runs WHERE t < ?").run(cutoff);
  const keepIds = `(SELECT MAX(rowid) FROM epoch_snapshots GROUP BY epoch UNION SELECT MAX(rowid) FROM epoch_snapshots)`;
  db.exec("BEGIN");
  try {
    const a = db.prepare(`DELETE FROM validator_snapshots WHERE t < ? AND snapshot_id NOT IN ${keepIds}`).run(cutoff);
    const b = db.prepare(`DELETE FROM epoch_snapshots WHERE t < ? AND rowid NOT IN ${keepIds}`).run(cutoff);
    db.exec("COMMIT");
    return Number(a.changes) + Number(b.changes);
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function recordRun(db: Db, t: number, ok: boolean, durationMs: number, error?: string) {
  db.prepare("INSERT INTO collect_runs VALUES (?,?,?,?)").run(t, ok ? 1 : 0, Math.round(durationMs), error?.slice(0, 300) ?? null);
}

/** Indexer-observed RPC health over the last 24h: success ratio of collection runs and latest durations. */
export function rpcHealth(db: Db, now: number) {
  const r = db.prepare("SELECT COUNT(*) n, SUM(ok) ok FROM collect_runs WHERE t >= ?").get(now - 86400)!;
  const n = Number(r.n), ok = Number(r.ok ?? 0);
  // Same 24h window as the other fields: a success older than that must not look current.
  const last = db.prepare("SELECT t, duration_ms FROM collect_runs WHERE ok = 1 AND t >= ? ORDER BY t DESC LIMIT 1").get(now - 86400);
  const avg = db.prepare("SELECT AVG(duration_ms) a FROM collect_runs WHERE ok = 1 AND t >= ?").get(now - 86400)!;
  return {
    uptime24h: n ? ok / n : null, runs24h: n,
    lastSuccessAt: last ? Number(last.t) : null,
    snapshotDurationMs: last ? Number(last.duration_ms) : null,
    avgSnapshotDurationMs: avg.a === null ? null : Math.round(Number(avg.a)),
  };
}

export interface BanWindow { untilEpoch: string; permanent: boolean; firstSeenAt: number; lastSeenAt: number }
/** Contiguous banned periods observed for a validator, newest first. Not subject to snapshot retention. */
export function banHistory(db: Db, address: string, limit = 20): BanWindow[] {
  return db.prepare("SELECT until_epoch, permanent, first_t, last_t FROM ban_windows WHERE address = ? ORDER BY last_t DESC, id DESC LIMIT ?")
    .all(address, limit).map((r) => ({ untilEpoch: r.until_epoch as string, permanent: r.permanent === 1, firstSeenAt: Number(r.first_t), lastSeenAt: Number(r.last_t) }));
}
export function firstSeenAt(db: Db, address: string): number | null {
  const r = db.prepare("SELECT t FROM validator_first_seen WHERE address = ?").get(address);
  return r ? Number(r.t) : null;
}
