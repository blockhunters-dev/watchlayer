import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { banHistory, latestValidators, networkEpochs, openDb, pruneSnapshots, validatorEpochs } from "../src/db.js";
import { collectOnce } from "../src/collect.js";
import { fetchAllPages } from "../src/chain.js";
import { isBannedNow } from "../src/derive.js";
import type { ChainReader, ValidatorSnapshot } from "../src/types.js";

const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);
const v = (address: string, nonce: number, extra: Partial<ValidatorSnapshot> = {}): ValidatorSnapshot => ({
  address, owner: "0x1", operator: "0x2", moniker: null, identity: { moniker: null, logo: null, website: null, github: null },
  vStakeRaw: 1n, dStakeRaw: 0n, pendingDeposits: [], banned: false, ban: null, pendingWithdrawals: [], needsPriming: false, active: true,
  operatorBalanceWei: 1n, operatorNonce: nonce, ...extra });
const reader = (epoch: bigint, vs: ValidatorSnapshot[]): ChainReader => ({
  getEpoch: async () => ({ currentEpoch: epoch, activeCount: vs.length, nextEpochEstimate: null, txLastHour: 1 }),
  getValidators: async () => vs,
});

describe("snapshot identity (same-second snapshots, missing validators)", () => {
  it("keeps epochs apart when snapshots in different epochs share a timestamp", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, reader(2n, [v(A, 5)]), 1000);
    await collectOnce(db, reader(3n, [v(A, 9)]), 1000); // same second, next epoch
    expect(validatorEpochs(db, A).map((e) => [e.epoch, e.operatorNonce, e.operatorTx])).toEqual([["2", 5, null], ["3", 9, 4]]);
    expect(networkEpochs(db).map((e) => e.epoch)).toEqual(["2", "3"]);
    expect((latestValidators(db) as { operator_nonce: number }[])[0].operator_nonce).toBe(9); // newest snapshot, not a time tie
  });
  it("uses the validator's last snapshot in an epoch even if absent from the epoch's final snapshot", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, reader(2n, [v(A, 1), v(B, 7)]), 1000);
    await collectOnce(db, reader(2n, [v(A, 2)]), 1060);          // B missing from epoch 2's final snapshot
    await collectOnce(db, reader(3n, [v(A, 3), v(B, 8)]), 1120);
    expect(validatorEpochs(db, B).map((e) => [e.epoch, e.operatorNonce, e.operatorTx])).toEqual([["2", 7, null], ["3", 8, 1]]);
    expect(validatorEpochs(db, A).map((e) => [e.epoch, e.operatorNonce])).toEqual([["2", 2], ["3", 3]]);
    expect(networkEpochs(db)[0].validators.total).toBe(1); // epoch 2 end snapshot had only A
  });
  it("retention keeps the right rows when timestamps tie", async () => {
    const db = openDb(":memory:");
    const old = 1000;
    await collectOnce(db, reader(2n, [v(A, 1)]), old);
    await collectOnce(db, reader(3n, [v(A, 2)]), old); // same second, epoch 3
    await collectOnce(db, reader(4n, [v(A, 3)]), old + 100 * 86400);
    pruneSnapshots(db, old + 100 * 86400, 14);
    expect(validatorEpochs(db, A).map((e) => e.epoch)).toEqual(["2", "3", "4"]);
  });
  it("links pre-existing rows to a snapshot when opening an old database", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-"));
    try {
      const path = join(dir, "old.db");
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE epoch_snapshots (t INTEGER NOT NULL, epoch TEXT NOT NULL, active_count INTEGER NOT NULL, next_epoch_estimate INTEGER);
        CREATE TABLE validator_snapshots (t INTEGER NOT NULL, address TEXT NOT NULL, operator TEXT NOT NULL, moniker TEXT, status TEXT NOT NULL,
          v_stake TEXT NOT NULL, d_stake TEXT NOT NULL, pending_deposits TEXT NOT NULL, operator_balance TEXT NOT NULL);
        INSERT INTO epoch_snapshots VALUES (500, '2', 1, NULL);
        INSERT INTO validator_snapshots VALUES (500, '${A}', '0x2', NULL, 'active', '1', '0', '[]', '1');`);
      old.close();
      const db = openDb(path);
      expect(validatorEpochs(db, A).map((e) => e.epoch)).toEqual(["2"]);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("fetchAllPages (banned list pagination)", () => {
  const bans = Array.from({ length: 250 }, (_, i) => ({ validator: `0x${i}`, untilEpoch: 9n, permanentlyBanned: false }));
  const page = async (start: bigint, size: bigint) => bans.slice(Number(start), Number(start + size));

  it("reads beyond the first page so a ban at index 230 is not lost", async () => {
    const calls: bigint[] = [];
    const all = await fetchAllPages(async (s, z) => { calls.push(s); return page(s, z); }, 100n);
    expect(all).toHaveLength(250);
    expect(calls).toEqual([0n, 100n, 200n]);
    const late = all.find((b) => b.validator === "0x230")!;
    expect(isBannedNow({ untilEpoch: late.untilEpoch, permanent: late.permanentlyBanned }, 3n)).toBe(true);
  });
  it("makes one extra call when the list is an exact multiple of the page size", async () => {
    const calls: bigint[] = [];
    const all = await fetchAllPages(async (s, z) => { calls.push(s); return bans.slice(0, 200).slice(Number(s), Number(s + z)); }, 100n);
    expect(all).toHaveLength(200);
    expect(calls).toEqual([0n, 100n, 200n]);
  });
  it("refuses an endless list", async () => {
    await expect(fetchAllPages(async () => [1, 2], 2n, 5)).rejects.toThrow("exceeded 5 pages");
  });
});

describe("epoch rollover during a collection", () => {
  it("evaluates validators against the same epoch it saves", async () => {
    const db = openDb(":memory:");
    const chain = { epoch: 3n };                       // chain is in epoch 3 when the snapshot starts
    const seen: bigint[] = [];
    const r: ChainReader = {
      getEpoch: async () => { const e = chain.epoch; chain.epoch = 4n; /* rollover right after the read */ return { currentEpoch: e, activeCount: 1, nextEpochEstimate: null, txLastHour: 1 }; },
      getValidators: async (epoch) => {
        seen.push(epoch);
        const ban = { untilEpoch: 4n, permanent: false };   // banned through epoch 3, expires at 4
        return [v(A, 1, { ban, banned: isBannedNow(ban, epoch) })];
      },
    };
    await collectOnce(db, r, 1000);
    expect(seen).toEqual([3n]);                         // validators saw the epoch that gets saved, not the post-rollover one
    const row = latestValidators(db)[0] as { status: string };
    expect(row.status).toBe("banned");
    expect(networkEpochs(db)[0]).toMatchObject({ epoch: "3", validators: { banned: 1 } });
  });
});

describe("upgrade from the pre-change ban_log schema", () => {
  const A2 = "0x" + "c".repeat(40);
  it("migrates every old ban_log row into closed ban_windows before serving history, and is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-ban-"));
    try {
      const path = join(dir, "old.db");
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE ban_log (address TEXT NOT NULL, until_epoch TEXT NOT NULL, permanent INTEGER NOT NULL,
          first_t INTEGER NOT NULL, last_t INTEGER NOT NULL, PRIMARY KEY (address, until_epoch, permanent));
        INSERT INTO ban_log VALUES ('${A}', '5', 0, 100, 200);
        INSERT INTO ban_log VALUES ('${A}', '0', 1, 300, 400);
        INSERT INTO ban_log VALUES ('${A2}', '9', 0, 150, 150);`);
      old.close();

      const db = openDb(path);
      expect(banHistory(db, A)).toEqual([
        { untilEpoch: "0", permanent: true, firstSeenAt: 300, lastSeenAt: 400 },
        { untilEpoch: "5", permanent: false, firstSeenAt: 100, lastSeenAt: 200 },
      ]);
      expect(banHistory(db, A2)).toEqual([{ untilEpoch: "9", permanent: false, firstSeenAt: 150, lastSeenAt: 150 }]);
      expect(db.prepare("SELECT COUNT(*) c FROM ban_windows WHERE open = 1").get()!.c).toBe(0); // migrated rows are closed
      db.close();

      const again = openDb(path);   // reopen: no duplicates
      expect(Number(again.prepare("SELECT COUNT(*) c FROM ban_windows").get()!.c)).toBe(3);
      expect(banHistory(again, A)).toHaveLength(2);
      again.close();

      const third = openDb(path);   // and a third time
      expect(Number(third.prepare("SELECT COUNT(*) c FROM ban_windows").get()!.c)).toBe(3);
      third.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("new bans after migration start separate windows and do not touch migrated rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-ban-"));
    try {
      const path = join(dir, "old.db");
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE ban_log (address TEXT NOT NULL, until_epoch TEXT NOT NULL, permanent INTEGER NOT NULL,
          first_t INTEGER NOT NULL, last_t INTEGER NOT NULL, PRIMARY KEY (address, until_epoch, permanent));
        INSERT INTO ban_log VALUES ('${A}', '5', 0, 100, 200);`);
      old.close();
      const db = openDb(path);
      const r = (epoch: bigint, ban: { untilEpoch: bigint; permanent: boolean } | null): ChainReader => ({
        getEpoch: async () => ({ currentEpoch: epoch, activeCount: 1, nextEpochEstimate: null, txLastHour: 1 }),
        getValidators: async () => [v(A, 1, { ban, banned: ban !== null })],
      });
      await collectOnce(db, r(3n, { untilEpoch: 5n, permanent: false }), 1000); // same until epoch as the migrated row
      expect(banHistory(db, A)).toEqual([
        { untilEpoch: "5", permanent: false, firstSeenAt: 1000, lastSeenAt: 1000 },
        { untilEpoch: "5", permanent: false, firstSeenAt: 100, lastSeenAt: 200 },
      ]);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  /** Old-schema file: epoch/validator snapshots plus ban_log, with the validator's newest snapshot at t=200. */
  function oldDb(dir: string, newestStatus: "banned" | "active", newestT = 200) {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE epoch_snapshots (t INTEGER NOT NULL, epoch TEXT NOT NULL, active_count INTEGER NOT NULL, next_epoch_estimate INTEGER);
      CREATE TABLE validator_snapshots (t INTEGER NOT NULL, address TEXT NOT NULL, operator TEXT NOT NULL, moniker TEXT, status TEXT NOT NULL,
        v_stake TEXT NOT NULL, d_stake TEXT NOT NULL, pending_deposits TEXT NOT NULL, operator_balance TEXT NOT NULL);
      CREATE TABLE ban_log (address TEXT NOT NULL, until_epoch TEXT NOT NULL, permanent INTEGER NOT NULL,
        first_t INTEGER NOT NULL, last_t INTEGER NOT NULL, PRIMARY KEY (address, until_epoch, permanent));
      INSERT INTO ban_log VALUES ('${A}', '5', 0, 100, 200);
      INSERT INTO epoch_snapshots VALUES (100, '3', 1, NULL), (200, '3', 1, NULL), (${newestT}, '3', 1, NULL);
      INSERT INTO validator_snapshots VALUES (100, '${A}', '0x2', NULL, 'banned', '1', '0', '[]', '1');
      INSERT INTO validator_snapshots VALUES (200, '${A}', '0x2', NULL, 'banned', '1', '0', '[]', '1');
      ${newestT !== 200 ? `INSERT INTO validator_snapshots VALUES (${newestT}, '${A}', '0x2', NULL, '${newestStatus}', '1', '0', '[]', '1');` : ""}`);
    old.close();
    return path;
  }
  const bannedReader = (epoch: bigint, banned: boolean): ChainReader => ({
    getEpoch: async () => ({ currentEpoch: epoch, activeCount: 1, nextEpochEstimate: null, txLastHour: 1 }),
    getValidators: async () => [v(A, 1, banned ? { ban: { untilEpoch: 5n, permanent: false }, banned: true } : {})],
  });

  it("continues the same window when the node restarts during a ban (old DB, validator still banned)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-ban-"));
    try {
      const path = oldDb(dir, "banned");
      const db = openDb(path);
      expect(db.prepare("SELECT open FROM ban_windows").all()).toEqual([{ open: 1 }]); // newest snapshot was banned -> still open
      await collectOnce(db, bannedReader(3n, true), 300);
      expect(banHistory(db, A)).toEqual([{ untilEpoch: "5", permanent: false, firstSeenAt: 100, lastSeenAt: 300 }]);
      db.close();

      const again = openDb(path);   // reopen after the window has been extended: nothing is copied again
      expect(banHistory(again, A)).toEqual([{ untilEpoch: "5", permanent: false, firstSeenAt: 100, lastSeenAt: 300 }]);
      expect(Number(again.prepare("SELECT COUNT(*) c FROM ban_windows").get()!.c)).toBe(1);
      again.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("starts a separate window when the old DB's newest snapshot was not banned (the ban had ended)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-ban-"));
    try {
      const path = oldDb(dir, "active", 250);   // newest snapshot (t=250) is not banned
      const db = openDb(path);
      expect(db.prepare("SELECT open FROM ban_windows").all()).toEqual([{ open: 0 }]);
      await collectOnce(db, bannedReader(4n, true), 300);   // banned again, same until epoch
      expect(banHistory(db, A)).toEqual([
        { untilEpoch: "5", permanent: false, firstSeenAt: 300, lastSeenAt: 300 },
        { untilEpoch: "5", permanent: false, firstSeenAt: 100, lastSeenAt: 200 },
      ]);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("a non-banned snapshot after a restart-during-ban closes the migrated window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-ban-"));
    try {
      const db = openDb(oldDb(dir, "banned"));
      await collectOnce(db, bannedReader(4n, false), 300);   // unbanned
      await collectOnce(db, bannedReader(4n, true), 400);    // banned again
      expect(banHistory(db, A).map((b) => [b.firstSeenAt, b.lastSeenAt])).toEqual([[400, 400], [100, 200]]);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
