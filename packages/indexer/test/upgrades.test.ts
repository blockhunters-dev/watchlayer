import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { createUpgradeWatcher, parseVerdict } from "../src/upgrades.js";
import { createApi } from "../src/api.js";
import { openDb } from "../src/db.js";

const raw = (version: string, mandatory = false) => new Map<string, unknown>([
  ["version", version], ["network", "bradbury-phase2"], ["mandatory", mandatory], ["breaking", false], ["deadline", null],
  ["config_changes", ["genvm.root_dir"]], ["env_changes", []], ["actions", ["restart the node"]], ["source_url", "https://docs.genlayer.com/validators/changelog"],
]);

describe("parseVerdict", () => {
  it("turns genlayer-js Maps into a plain verdict and rejects empty results", () => {
    expect(parseVerdict(raw("0.5.14"))).toMatchObject({ version: "0.5.14", mandatory: false, config_changes: ["genvm.root_dir"], deadline: null });
    expect(parseVerdict(new Map())).toBeNull();
    expect(parseVerdict(null)).toBeNull();
  });
});

describe("upgrade watcher", () => {
  it("records each version once with its first-seen time and follows what get_latest returns", async () => {
    let t = 1000, next: unknown = raw("0.5.14");
    const w = createUpgradeWatcher(new DatabaseSync(":memory:"), { contract: "0xC", network: "bradbury-phase2", read: async () => next, clock: () => t });
    await w.check();
    t = 2000; await w.check();
    expect(w.state().history).toHaveLength(1);
    expect(w.state().latest).toMatchObject({ version: "0.5.14", firstSeenAt: 1000 });
    next = raw("0.6.0", true); t = 3000; await w.check();
    const s = w.state();
    expect(s.latest).toMatchObject({ version: "0.6.0", mandatory: true, firstSeenAt: 3000 });
    expect(s.history.map((h) => h.version)).toEqual(["0.6.0", "0.5.14"]);
    expect(s.checkedAt).toBe(3000);
  });
  it("keeps the last good state and reports the error when a read fails", async () => {
    let fail = false;
    const w = createUpgradeWatcher(new DatabaseSync(":memory:"), { contract: "0xC", network: "n", read: async () => { if (fail) throw new Error("contract not found\nmore"); return raw("1.0.0"); }, clock: () => 5 });
    await w.check(); fail = true; await w.check();
    expect(w.state()).toMatchObject({ error: "contract not found", latest: { version: "1.0.0" } });
  });
  it("is disabled without a contract address", async () => {
    const w = createUpgradeWatcher(new DatabaseSync(":memory:"), { contract: null, network: "n", read: async () => { throw new Error("must not read"); } });
    await w.check();
    expect(w.state()).toMatchObject({ enabled: false, latest: null, error: null });
  });
});

describe("GET /upgrades", () => {
  it("serves the watcher state, or enabled:false when none is configured", async () => {
    const db = openDb(":memory:");
    const w = createUpgradeWatcher(db, { contract: "0xC", network: "bradbury-phase2", read: async () => raw("0.5.14"), clock: () => 7 });
    await w.check();
    for (const [server, expected] of [[createApi(db, undefined, w.state), { enabled: true, latest: { version: "0.5.14" } }], [createApi(db), { enabled: false }]] as const) {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const { port } = server.address() as AddressInfo;
      const body = await (await fetch(`http://127.0.0.1:${port}/upgrades`)).json();
      server.close();
      expect(body).toMatchObject(expected);
    }
  });
});
