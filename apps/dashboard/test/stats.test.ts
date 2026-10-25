import { describe, it, expect } from "vitest";
import { banRows, compact, nakamoto, searchValidators, shares, topShare } from "../src/lib/stats";
import type { Validator } from "../src/lib/api";

const G = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const v = (o: Partial<Validator>): Validator => ({
  address: "0xA", operator: "0xB", moniker: "m", identity: { moniker: "m", logo: null, website: null, github: null }, status: "active", vStake: "0", dStake: "0", pendingDeposits: [],
  operatorBalanceWei: "0", gasRunwayDays: null, pendingWithdrawals: [], firstSeenAt: null, bans: [], lastBannedAt: null, strikes: null, ban: null, snapshotAt: 0,
  activity: { lastTxAt: null, txLast24h: 0, silentHours: 0 }, ...o });

describe("stats", () => {
  const set = [v({ address: "0x1", vStake: G(50) }), v({ address: "0x2", vStake: G(30) }), v({ address: "0x3", vStake: G(20) }), v({ address: "0x4", status: "banned", vStake: G(999) })];
  it("counts validators needed to exceed a third of active stake, ignoring non-active", () => {
    expect(nakamoto(set)).toBe(1); // 50 of 100 > 33.3
    expect(nakamoto([v({ address: "0x1", vStake: G(30) }), v({ address: "0x2", vStake: G(30) }), v({ address: "0x3", vStake: G(40) })])).toBe(1);
    expect(nakamoto([v({ vStake: G(25) }), v({ vStake: G(25) }), v({ vStake: G(25) }), v({ vStake: G(25) })])).toBe(2);
    expect(nakamoto([])).toBe(0);
  });
  it("computes shares and top-n share", () => {
    const s = shares(set.filter((x) => x.status === "active"));
    expect(s.get("0x1")).toBeCloseTo(0.5); expect(s.get("0x3")).toBeCloseTo(0.2);
    expect(topShare(set, 2)).toBeCloseTo(0.8);
  });
  it("flattens bans with the ongoing one first", () => {
    const b = v({ status: "banned", ban: { untilEpoch: "7", permanent: false },
      bans: [{ untilEpoch: "3", permanent: false, firstSeenAt: 1, lastSeenAt: 50 }, { untilEpoch: "7", permanent: false, firstSeenAt: 60, lastSeenAt: 10 }] });
    const rows = banRows([b]);
    expect(rows.map((r) => [r.untilEpoch, r.ongoing])).toEqual([["7", true], ["3", false]]);
  });
  it("searches by moniker or address, and formats compact numbers", () => {
    expect(searchValidators([v({ moniker: "Alpha" }), v({ moniker: "Beta", address: "0xBEEF" })], "beef")).toHaveLength(1);
    expect(searchValidators([v({})], "  ")).toHaveLength(1);
    expect(compact(6_803_267)).toBe("6.80M"); expect(compact(125_268)).toBe("125K"); expect(compact(950)).toBe("950");
  });
});
