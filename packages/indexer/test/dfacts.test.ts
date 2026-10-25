import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { banHistory, firstSeenAt, openDb, pruneSnapshots } from "../src/db.js";
import { collectOnce } from "../src/collect.js";
import { createApi } from "../src/api.js";
import { isBannedNow } from "../src/derive.js";
import type { ChainReader, ValidatorSnapshot } from "../src/types.js";

const A = "0x" + "a".repeat(40);
const D = 86400;
const base = (o: Partial<ValidatorSnapshot> = {}): ValidatorSnapshot => ({
  address: A, owner: "0x1", operator: "0x2", moniker: "A", identity: { moniker: "A", logo: null, website: "https://a.example/", github: null },
  vStakeRaw: 5n, dStakeRaw: 0n, pendingDeposits: [], pendingWithdrawals: [], banned: false, ban: null, needsPriming: false, active: true,
  operatorBalanceWei: 100n, operatorNonce: 1, ...o });
const at = (epoch: bigint, v: ValidatorSnapshot): ChainReader => ({
  getEpoch: async () => ({ currentEpoch: epoch, activeCount: 1, nextEpochEstimate: null, txLastHour: 1 }),
  getValidators: async (e) => [{ ...v, banned: v.banned || isBannedNow(v.ban, e) }],
});
const banned = (until: bigint) => base({ ban: { untilEpoch: until, permanent: false } });

let server: ReturnType<typeof createApi>;
afterEach(() => server?.close());
const url = (s: ReturnType<typeof createApi>) => `http://127.0.0.1:${(s.listen(0).address() as AddressInfo).port}`;

describe("responses are a function of the snapshot, not of the request time", () => {
  it("returns identical validator objects when requested days apart", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(2n, base({ operatorNonce: 1, operatorBalanceWei: 100n })), 1_000_000);
    await collectOnce(db, at(2n, base({ operatorNonce: 3, operatorBalanceWei: 90n })), 1_000_000 + 3600);
    let clock = 1_000_000 + 7200;
    server = createApi(db, () => clock);
    const b = url(server);
    const first = await (await fetch(`${b}/validators/${A}`)).json();
    clock += 5 * D;
    const later = await (await fetch(`${b}/validators/${A}`)).json();
    expect(later).toEqual(first);
    expect(first.activity.silentHours).toBeCloseTo(0);          // measured at snapshot time (nonce rose in the last snapshot)
    expect(first.snapshotAt).toBe(1_000_000 + 3600);
    expect((await (await fetch(`${b}/validators`)).json())[0]).toEqual(first);
  });
});

describe("ban history and first-seen (for consumers needing 'no ban in N days')", () => {
  it("records ban windows permanently, even after full-resolution snapshots are pruned", async () => {
    const db = openDb(":memory:");
    const t0 = 10 * D;
    await collectOnce(db, at(2n, base()), t0);                       // first seen, not banned
    await collectOnce(db, at(3n, banned(5n)), t0 + 100);             // banned until epoch 5
    await collectOnce(db, at(3n, banned(5n)), t0 + 200);
    await collectOnce(db, at(5n, banned(5n)), t0 + D);               // ban expired (until 5, now epoch 5)
    await collectOnce(db, at(6n, base()), t0 + 40 * D);
    pruneSnapshots(db, t0 + 40 * D, 14);
    expect(banHistory(db, A)).toEqual([{ untilEpoch: "5", permanent: false, firstSeenAt: t0 + 100, lastSeenAt: t0 + 200 }]);
    expect(firstSeenAt(db, A)).toBe(t0);
    server = createApi(db, () => t0 + 40 * D);
    const v = await (await fetch(`${url(server)}/validators/${A}`)).json();
    expect(v.bans).toEqual([{ untilEpoch: "5", permanent: false, firstSeenAt: t0 + 100, lastSeenAt: t0 + 200 }]);
    expect(v.lastBannedAt).toBe(t0 + 200);
    expect(v.firstSeenAt).toBe(t0);
  });
  it("keeps separate windows, newest first, and handles permanent bans", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(2n, banned(4n)), 1000);
    await collectOnce(db, at(5n, base()), 2000);
    await collectOnce(db, at(6n, base({ ban: { untilEpoch: 0n, permanent: true } })), 3000);
    expect(banHistory(db, A).map((b) => [b.untilEpoch, b.permanent, b.firstSeenAt])).toEqual([["0", true, 3000], ["4", false, 1000]]);
  });
  it("keeps two bans with the same until epoch and permanence as separate windows", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(3n, banned(5n)), 1000);      // first ban window
    await collectOnce(db, at(3n, banned(5n)), 1100);
    await collectOnce(db, at(5n, base()), 2000);          // unbanned
    await collectOnce(db, at(4n, banned(5n)), 3000);      // banned again, same until epoch (e.g. re-banned in the same epoch range)
    await collectOnce(db, at(4n, banned(5n)), 3100);
    expect(banHistory(db, A)).toEqual([
      { untilEpoch: "5", permanent: false, firstSeenAt: 3000, lastSeenAt: 3100 },
      { untilEpoch: "5", permanent: false, firstSeenAt: 1000, lastSeenAt: 1100 },
    ]);
    server = createApi(db, () => 3100);
    const v = await (await fetch(`${url(server)}/validators/${A}`)).json();
    expect(v.bans).toHaveLength(2);
    expect(v.lastBannedAt).toBe(3100);
  });
  it("treats a changed ban (extended or made permanent) inside one banned period as the same window", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(3n, banned(5n)), 1000);
    await collectOnce(db, at(4n, banned(7n)), 1100);
    await collectOnce(db, at(4n, base({ ban: { untilEpoch: 0n, permanent: true } })), 1200);
    expect(banHistory(db, A)).toEqual([{ untilEpoch: "0", permanent: true, firstSeenAt: 1000, lastSeenAt: 1200 }]);
  });
  it("starts a new window when a validator drops off the list and returns banned", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(3n, banned(9n)), 1000);
    await collectOnce(db, { getEpoch: async () => ({ currentEpoch: 3n, activeCount: 0, nextEpochEstimate: null, txLastHour: 1 }), getValidators: async () => [] }, 1100);
    await collectOnce(db, at(3n, banned(9n)), 1200);
    expect(banHistory(db, A).map((b) => [b.firstSeenAt, b.lastSeenAt])).toEqual([[1200, 1200], [1000, 1000]]);
  });
  it("reports empty history and null lastBannedAt for a never-banned validator", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(2n, base()), 1000);
    server = createApi(db, () => 1000);
    const v = await (await fetch(`${url(server)}/validators/${A}`)).json();
    expect(v).toMatchObject({ bans: [], lastBannedAt: null, firstSeenAt: 1000 });
  });
});

describe("pending withdrawals", () => {
  it("are exposed per validator, empty when none", async () => {
    const db = openDb(":memory:");
    await collectOnce(db, at(2n, base({ pendingWithdrawals: [{ epoch: 2n, stakeRaw: 7n * 10n ** 18n }] })), 1000);
    server = createApi(db, () => 1000);
    const v = await (await fetch(`${url(server)}/validators/${A}`)).json();
    expect(v.pendingWithdrawals).toEqual([{ epoch: "2", stakeRaw: (7n * 10n ** 18n).toString() }]);
    const db2 = openDb(":memory:");
    await collectOnce(db2, at(2n, base()), 1000);
    const s2 = createApi(db2, () => 1000);
    const v2 = await (await fetch(`${url(s2)}/validators/${A}`)).json();
    s2.close();
    expect(v2.pendingWithdrawals).toEqual([]);
  });
});
