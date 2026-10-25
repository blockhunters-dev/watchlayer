import { describe, it, expect } from "vitest";
import { networkEpochs, openDb, pruneSnapshots, recordRun, rpcHealth, validatorEpochs } from "../src/db.js";
import { collectOnce } from "../src/collect.js";
import { loadConfig } from "../src/config.js";
import type { ChainReader } from "../src/types.js";

const ADDR = "0x42b7bb7CDD228AeCEf96cbDaa5c94Ebc6A65635f";
const at = (epoch: bigint, nonce: number): ChainReader => ({
  getEpoch: async () => ({ currentEpoch: epoch, activeCount: 1, nextEpochEstimate: null, txLastHour: 1 }),
  getValidators: async () => [{ address: ADDR, owner: "0x1", operator: "0x2", moniker: null,
    identity: { moniker: null, logo: null, website: null, github: null }, vStakeRaw: 0n, dStakeRaw: 0n, pendingDeposits: [],
    banned: false, ban: null, pendingWithdrawals: [], needsPriming: false, active: true, operatorBalanceWei: 1n, operatorNonce: nonce }],
});
const D = 86400;
const count = (db: ReturnType<typeof openDb>, t: string) => Number(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()!.c);

describe("pruneSnapshots", () => {
  it("drops old full-resolution rows but keeps each epoch's last snapshot and the newest one", async () => {
    const db = openDb(":memory:");
    const t0 = 10 * D;
    await collectOnce(db, at(1n, 1), t0);          // epoch 1, old, not epoch end -> pruned
    await collectOnce(db, at(1n, 2), t0 + 100);    // epoch 1 end, old -> kept
    await collectOnce(db, at(2n, 3), t0 + 200);    // epoch 2, old, not end -> pruned
    await collectOnce(db, at(2n, 4), t0 + 300);    // epoch 2 end (until epoch 3 appears), old -> kept
    await collectOnce(db, at(3n, 5), t0 + 40 * D); // newest
    const deleted = pruneSnapshots(db, t0 + 40 * D, 14);
    expect(deleted).toBe(4); // 2 validator rows + 2 epoch rows
    expect(count(db, "validator_snapshots")).toBe(3);
    expect(count(db, "epoch_snapshots")).toBe(3);
    expect(validatorEpochs(db, ADDR).map((e) => e.epoch)).toEqual(["1", "2", "3"]);
  });
  it("keeps everything inside the retention window", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(1n, 1), 100 * D);
    await collectOnce(db, at(1n, 2), 100 * D + 60);
    expect(pruneSnapshots(db, 100 * D + 120, 14)).toBe(0);
  });
  it("RETENTION_DAYS defaults to 14", () => {
    expect(loadConfig({}).retentionDays).toBe(14);
    expect(loadConfig({ RETENTION_DAYS: "3" }).retentionDays).toBe(3);
  });
});

describe("epoch history limits", () => {
  it("caps rows to the most recent epochs and keeps a baseline for operatorTx", async () => {
    const db = openDb(":memory:");
    for (let e = 1; e <= 5; e++) await collectOnce(db, at(BigInt(e), e * 10), e * D);
    const v = validatorEpochs(db, ADDR, 3);
    expect(v.map((x) => x.epoch)).toEqual(["3", "4", "5"]);
    expect(v[0].operatorTx).toBe(10); // baseline from epoch 2 even though epoch 2 is not returned
    expect(networkEpochs(db, 2).map((x) => x.epoch)).toEqual(["4", "5"]);
    expect(networkEpochs(db, 2)[1].validators.total).toBe(1);
  });
});

describe("rpcHealth 24h window", () => {
  const D = 86400;
  it("reports no last success when every success is older than 24h", () => {
    const db = openDb(":memory:");
    const t0 = 100 * D;
    recordRun(db, t0, true, 1200);                 // old success, outside the window
    recordRun(db, t0 + 2 * D, false, 50, "rpc down");
    recordRun(db, t0 + 2 * D + 120, false, 50, "rpc down");
    expect(rpcHealth(db, t0 + 2 * D + 200)).toEqual({
      uptime24h: 0, runs24h: 2, lastSuccessAt: null, snapshotDurationMs: null, avgSnapshotDurationMs: null });
  });
  it("reports the newest success inside the window, ignoring older ones", () => {
    const db = openDb(":memory:");
    const now = 100 * D;
    recordRun(db, now - 3 * D, true, 9000);        // outside
    recordRun(db, now - 3600, true, 1000);         // inside
    recordRun(db, now - 60, true, 2000);           // newest
    recordRun(db, now - 30, false, 10, "x");
    expect(rpcHealth(db, now)).toMatchObject({ runs24h: 3, lastSuccessAt: now - 60, snapshotDurationMs: 2000, avgSnapshotDurationMs: 1500 });
    expect(rpcHealth(db, now).uptime24h).toBeCloseTo(2 / 3);
  });
});
