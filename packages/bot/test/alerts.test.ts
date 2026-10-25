import { describe, it, expect } from "vitest";
import { describeStatus, evaluateAlerts, type AlertState } from "../src/alerts.js";
import type { Validator } from "../src/api.js";

const v = (o: Partial<Validator> = {}): Validator => ({
  address: "0x1", operator: "0x2", moniker: "BH", status: "active", vStake: "0", dStake: "0",
  pendingDeposits: [], operatorBalanceWei: (5n * 10n ** 18n).toString(), gasRunwayDays: 10, snapshotAt: 1, ban: null, activity: { lastTxAt: 1, txLast24h: 5, silentHours: 0 }, ...o });

describe("evaluateAlerts", () => {
  it("is quiet on first observation, only records state", () => {
    const r = evaluateAlerts(v({ status: "banned", gasRunwayDays: 0.5 }), undefined);
    expect(r.alerts.filter((a) => a.includes("banned"))).toEqual([]);
  });
  it("alerts once per runway level and re-arms after recovery", () => {
    let s: AlertState | undefined = evaluateAlerts(v(), undefined).next;
    let r = evaluateAlerts(v({ gasRunwayDays: 2.5 }), s); expect(r.alerts).toHaveLength(1); s = r.next;
    r = evaluateAlerts(v({ gasRunwayDays: 2.0 }), s); expect(r.alerts).toHaveLength(0); s = r.next;
    r = evaluateAlerts(v({ gasRunwayDays: 0.8 }), s); expect(r.alerts[0]).toContain("under 1 day"); s = r.next;
    r = evaluateAlerts(v({ gasRunwayDays: 0.7 }), s); expect(r.alerts).toHaveLength(0); s = r.next;
    r = evaluateAlerts(v({ gasRunwayDays: 20 }), s); expect(r.alerts).toHaveLength(0); s = r.next;
    r = evaluateAlerts(v({ gasRunwayDays: 2 }), s); expect(r.alerts).toHaveLength(1);
  });
  it("keeps runway state when runway is unknown", () => {
    const r = evaluateAlerts(v({ gasRunwayDays: null }), { status: "active", runwayLevel: 1 });
    expect(r.next.runwayLevel).toBe(1);
    expect(r.alerts).toEqual([]);
  });
  it("alerts on ban, priming and pending->active transitions", () => {
    expect(evaluateAlerts(v({ status: "banned" }), { status: "active" }).alerts[0]).toContain("banned");
    expect(evaluateAlerts(v({ status: "needs_priming" }), { status: "active" }).alerts[0]).toContain("priming");
    expect(evaluateAlerts(v({ status: "active", vStake: (50n * 10n ** 18n).toString() }), { status: "pending" }).alerts[0]).toContain("now active");
    expect(evaluateAlerts(v({ status: "banned" }), { status: "banned" }).alerts).toEqual([]);
  });

  it("alerts once when an active operator goes silent, re-arms after it transacts again", () => {
    const quiet = (h: number) => v({ activity: { lastTxAt: 1, txLast24h: 0, silentHours: h } });
    let r = evaluateAlerts(quiet(3), { status: "active" }); expect(r.alerts).toEqual([]);
    r = evaluateAlerts(quiet(7), r.next); expect(r.alerts[0]).toContain("no transaction for 7 h");
    r = evaluateAlerts(quiet(8), r.next); expect(r.alerts).toEqual([]);
    r = evaluateAlerts(quiet(0.1), r.next); expect(r.alerts).toEqual([]);
    r = evaluateAlerts(quiet(9), r.next); expect(r.alerts).toHaveLength(1);
  });
  it("honours a custom threshold and ignores non-active validators", () => {
    const a = (h: number, status: Validator["status"] = "active") => v({ status, activity: { lastTxAt: null, txLast24h: 0, silentHours: h } });
    expect(evaluateAlerts(a(2), { status: "active" }, 1).alerts).toHaveLength(1);
    expect(evaluateAlerts(a(50, "pending"), { status: "pending" }).alerts).toEqual([]);
  });
});

describe("describeStatus", () => {
  it("reports only still-pending deposits, not activated ones kept in the contract list", () => {
    const text = describeStatus(v({ pendingDeposits: [
      { epoch: "2", stakeRaw: (50_000n * 10n ** 18n).toString(), activatesAtEpoch: "4", stillPending: true },
      { epoch: "0", stakeRaw: (7n * 10n ** 18n).toString(), activatesAtEpoch: "2", stillPending: false },
    ] }));
    expect(text).toContain("pending 50000.00 GEN (active from epoch 4)");
    expect(text).not.toContain("7.00 GEN");
  });
  it("says none when every deposit is already activated", () => {
    const text = describeStatus(v({ pendingDeposits: [{ epoch: "0", stakeRaw: "1", activatesAtEpoch: "2", stillPending: false }] }));
    expect(text).toContain("pending none");
  });
});

describe("ban alerts", () => {
  it("reports the ban window and a lifted ban", () => {
    const ban = v({ status: "banned", ban: { untilEpoch: "4", permanent: false } });
    const start = evaluateAlerts(ban, { status: "active" });
    expect(start.alerts[0]).toContain("banned until epoch 4");
    expect(evaluateAlerts(ban, start.next).alerts).toEqual([]);
    expect(evaluateAlerts(v({ status: "active" }), start.next).alerts[0]).toContain("ban ended");
    expect(evaluateAlerts(v({ status: "banned", ban: { untilEpoch: "0", permanent: true } }), { status: "active" }).alerts[0]).toContain("permanently");
  });
  it("shows ban and the strike caveat in /status", () => {
    const t = describeStatus(v({ status: "banned", ban: { untilEpoch: "4", permanent: false } }));
    expect(t).toContain("Ban: until epoch 4");
    expect(t).toContain("Strikes: counter not exposed on-chain");
  });
});
