import { describe, it, expect } from "vitest";
import { openStore } from "../src/store.js";
import { checkUpgrade, loadConsumer, upgradeMessage, validateAlert, type Consumer, type UpgradeAlert } from "../src/upgrade.js";

const alert = (o: Partial<UpgradeAlert> = {}): UpgradeAlert => ({
  kind: "mandatory-upgrade", severity: "warning", version: "v0.6.1", running: "v0.6.0", breaking: false, overdue: false, deadline: null,
  text: "Mandatory upgrade v0.6.0 -> v0.6.1", ...o });
const deps = (consumer: Consumer) => ({ consumer, client: {}, address: "0xabc", network: "bradbury-phase2", running: "v0.6.0" });
const fake = (get: () => UpgradeAlert | null): Consumer => ({ readLatest: async () => ({}), buildAlert: () => get() });
const addr = (n: number) => "0x" + String(n).repeat(40);

describe("checkUpgrade (through C's consumer)", () => {
  it("passes address, network and running version to the consumer", async () => {
    const store = openStore(":memory:"); store.watch(1, addr(1));
    const calls: unknown[] = [];
    const consumer: Consumer = {
      readLatest: async (c, a, n) => { calls.push(["read", a, n]); return { version: "v0.6.1" }; },
      buildAlert: (running, verdict) => { calls.push(["build", running, verdict]); return alert(); },
    };
    await checkUpgrade(store, deps(consumer), async () => {});
    expect(calls).toEqual([["read", "0xabc", "bradbury-phase2"], ["build", "v0.6.0", { version: "v0.6.1" }]]);
  });
  it("sends once per chat, re-alerts when severity escalates, and for a new version", async () => {
    const store = openStore(":memory:");
    store.watch(1, addr(1)); store.watch(2, addr(2)); store.watch(2, addr(3));
    let cur = alert();
    const sent: [number, string][] = [];
    const send = async (c: number, t: string) => void sent.push([c, t]);
    const d = deps(fake(() => cur));
    await checkUpgrade(store, d, send); await checkUpgrade(store, d, send);
    expect(sent.map((s) => s[0]).sort()).toEqual([1, 2]);
    cur = alert({ severity: "critical", overdue: true });
    await checkUpgrade(store, d, send);
    expect(sent).toHaveLength(4);
    expect(sent[2][1]).toContain("🚨");
    cur = alert({ version: "v0.6.2", severity: "critical" });
    await checkUpgrade(store, d, send);
    expect(sent).toHaveLength(6);
  });
  it("sends nothing when the consumer has no alert", async () => {
    const store = openStore(":memory:"); store.watch(1, addr(1));
    const sent: number[] = [];
    await checkUpgrade(store, deps(fake(() => null)), async (c) => void sent.push(c));
    expect(sent).toEqual([]);
  });
  it("propagates a chain read failure so the caller logs it", async () => {
    const store = openStore(":memory:"); store.watch(1, addr(1));
    const bad: Consumer = { readLatest: async () => { throw new Error("rpc down"); }, buildAlert: () => null };
    await expect(checkUpgrade(store, deps(bad), async () => {})).rejects.toThrow("rpc down");
  });
  it("isolates failures: others notified, failed chat retried, blocked chat dropped", async () => {
    const store = openStore(":memory:");
    for (const c of [1, 2, 3]) store.watch(c, addr(c));
    const d = deps(fake(() => alert()));
    const got: number[] = [];
    await checkUpgrade(store, d, async (c) => {
      if (c === 1) throw Object.assign(new Error("blocked"), { error_code: 403 });
      if (c === 2) throw new Error("timeout");
      got.push(c);
    });
    expect(got).toEqual([3]);
    expect(store.chats().sort()).toEqual([2, 3]);
    const retry: number[] = [];
    await checkUpgrade(store, d, async (c) => void retry.push(c));
    expect(retry).toEqual([2]);
  });
  it("prefixes critical alerts", () => {
    expect(upgradeMessage(alert({ severity: "critical", text: "X" }))).toBe("🚨 X");
    expect(upgradeMessage(alert({ text: "X" }))).toBe("⬆️ X");
  });
});

describe("loadConsumer", () => {
  it("rejects a module without the expected exports", async () => {
    await expect(loadConsumer(new URL("../src/format.ts", import.meta.url).pathname)).rejects.toThrow("does not export");
  });
});

describe("validateAlert", () => {
  it("accepts a normal alert unchanged", () => {
    expect(validateAlert(alert())).toEqual(alert());
  });
  it("rejects malformed alerts", () => {
    for (const bad of [null, "x", {}, alert({ version: "v 1 !" }), alert({ version: "x".repeat(100) }), alert({ severity: "info" as never }), alert({ text: "" }), { ...alert(), text: 5 }])
      expect(validateAlert(bad)).toBeNull();
  });
  it("caps text below Telegram's limit", () => {
    const out = validateAlert(alert({ text: "x".repeat(10_000) }))!;
    expect(out.text.length).toBeLessThanOrEqual(3500);
    expect(out.text.endsWith("…")).toBe(true);
  });
  it("drops the source line when the source link is not http(s)", () => {
    const bad = validateAlert({ ...alert({ text: "Mandatory upgrade\nsource: javascript:alert(1)" }), source_url: "javascript:alert(1)" })!;
    expect(bad.text).toBe("Mandatory upgrade");
    const ok = validateAlert({ ...alert({ text: "Mandatory upgrade\nsource: https://example.org/r" }), source_url: "https://example.org/r" })!;
    expect(ok.text).toContain("source: https://example.org/r");
  });
});

describe("checkUpgrade with a malformed consumer alert", () => {
  it("throws instead of broadcasting, and stores nothing", async () => {
    const store = openStore(":memory:"); store.watch(1, "0x" + "1".repeat(40));
    const sent: string[] = [];
    const c = { readLatest: async () => ({}), buildAlert: () => ({ kind: "mandatory-upgrade", version: "v1", severity: "bogus", text: "x" }) as never } as Consumer;
    await expect(checkUpgrade(store, { consumer: c, client: {}, address: "0x", network: "n", running: "v0" }, async (_, t) => void sent.push(t))).rejects.toThrow("malformed");
    expect(sent).toEqual([]);
    expect(store.getMeta("upgrade:1")).toBeUndefined();
  });
});
