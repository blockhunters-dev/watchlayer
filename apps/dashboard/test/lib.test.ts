import { describe, it, expect } from "vitest";
import { gen, relTime, runway, runwayLevel, shortAddr, sparkPoints } from "../src/lib/format";
import { filterValidators, sortValidators } from "../src/lib/sort";
import type { Validator } from "../src/lib/api";

const v = (o: Partial<Validator>): Validator => ({
  address: "0xA", operator: "0xB", moniker: "m", identity: { moniker: "m", logo: null, website: null, github: null }, status: "active", vStake: "0", dStake: "0", pendingDeposits: [],
  operatorBalanceWei: "0", gasRunwayDays: null, pendingWithdrawals: [], firstSeenAt: null, bans: [], lastBannedAt: null, strikes: null, ban: null, snapshotAt: 0,
  activity: { lastTxAt: null, txLast24h: 0, silentHours: 0 }, ...o });

describe("format", () => {
  it("formats GEN with grouping and truncation", () => {
    expect(gen((50_000n * 10n ** 18n).toString())).toBe("50,000.00 GEN");
    expect(gen("1999999999999999999")).toBe("1.99 GEN");
    expect(gen(null)).toBe("—");
  });
  it("formats runway, levels, addresses and times", () => {
    expect(runway(null)).toBe("unknown");
    expect(runway(0.5)).toBe("12 h");
    expect(runway(2.34)).toBe("2.3 d");
    expect(runway(730)).toBe("2.0 y");
    expect(runwayLevel(0.9)).toBe("crit");
    expect(runwayLevel(2.9)).toBe("warn");
    expect(runwayLevel(3)).toBe("ok");
    expect(runwayLevel(null)).toBe("unknown");
    expect(shortAddr("0x42b7bb7CDD228AeCEf96cbDaa5c94Ebc6A65635f")).toBe("0x42b7…635f");
    expect(relTime(1000 + 3700, 1000)).toBe("in 1h 1m");
    expect(relTime(1000 - 90000, 1000)).toBe("1d 1h ago");
    expect(relTime(null, 0)).toBe("never");
  });
  it("scales sparkline points", () => {
    expect(sparkPoints([], 100, 20)).toBe("");
    expect(sparkPoints([5], 100, 20)).toBe("50.0,10.0");
    expect(sparkPoints([1, 2], 100, 20)).toBe("2.0,18.0 98.0,2.0");
    expect(sparkPoints([3, 3, 3], 100, 20)).toBe("2.0,10.0 50.0,10.0 98.0,10.0");
  });
});

describe("sort/filter", () => {
  it("puts problems first, then lowest runway", () => {
    const out = sortValidators([
      v({ moniker: "a", status: "active", gasRunwayDays: 10 }), v({ moniker: "b", status: "banned" }),
      v({ moniker: "c", status: "active", gasRunwayDays: 1 }), v({ moniker: "d", status: "pending" }), v({ moniker: "e", status: "active" })]);
    expect(out.map((x) => x.moniker)).toEqual(["b", "d", "c", "a", "e"]);
  });
  it("filters by status", () => {
    const all = [v({ status: "active" }), v({ status: "pending" })];
    expect(filterValidators(all, "pending")).toHaveLength(1);
    expect(filterValidators(all)).toHaveLength(2);
  });
});
