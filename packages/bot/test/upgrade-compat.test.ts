import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { openStore } from "../src/store.js";
import { checkUpgrade, loadConsumer } from "../src/upgrade.js";

// Compatibility with Changelog Guard's consumer: runs against a checked-in copy pinned by content hash,
// so it never skips. See test/fixtures/changelog-guard-consumer/manifest.json for the exact pinned source.
const FIX = new URL("./fixtures/changelog-guard-consumer/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", FIX), "utf8")) as { files: Record<string, string> };
const sha = (u: URL) => createHash("sha256").update(readFileSync(u)).digest("hex");
const addr = (n: number) => "0x" + String(n).repeat(40);

async function run(verdict: unknown, running: string) {
  const consumer = await loadConsumer(new URL("index.mjs", FIX).pathname);
  const store = openStore(":memory:"); store.watch(1, addr(1));
  const sent: string[] = [];
  const client = { readContract: async (a: { address: string; functionName: string; args: unknown[] }) => { calls.push(a); return verdict; } };
  const calls: { address: string; functionName: string; args: unknown[] }[] = [];
  await checkUpgrade(store, { consumer, client, address: "0xabc", network: "bradbury-phase2", running }, async (_, t) => void sent.push(t));
  return { sent, calls };
}

describe("pinned Changelog Guard consumer fixture", () => {
  it("matches the hashes in manifest.json (an edited fixture must be re-pinned deliberately)", () => {
    for (const [name, hash] of Object.entries(manifest.files)) expect(sha(new URL(name, FIX)), name).toBe(hash);
  });
  it("exports what the bot imports", async () => {
    const c = await loadConsumer(new URL("index.mjs", FIX).pathname);
    expect(typeof c.readLatest).toBe("function");
    expect(typeof c.buildAlert).toBe("function");
  });
  it("reads get_latest(network) from the given address through the real readLatest and alerts on a mandatory verdict", async () => {
    const verdict = new Map<string, unknown>([["version", "v0.7.0"], ["mandatory", true], ["breaking", false], ["deadline", null], ["source_url", "https://example.org/r"]]);
    const { sent, calls } = await run(verdict, "v0.6.0");
    expect(calls).toEqual([{ address: "0xabc", functionName: "get_latest", args: ["bradbury-phase2"] }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Mandatory upgrade v0.6.0 -> v0.7.0");
    expect(sent[0]).toContain("https://example.org/r");
    expect(sent[0].startsWith("⬆️")).toBe(true);
  });
  it("converts bigint fields in the verdict (genlayer-js returns ints as bigint)", async () => {
    const { sent } = await run(new Map<string, unknown>([["version", "v0.7.0"], ["mandatory", true], ["breaking", true], ["deadline", null], ["config_changes", ["a"]], ["n", 3n]]), "v0.6.0");
    expect(sent).toHaveLength(1);
    expect(sent[0].startsWith("🚨")).toBe(true); // breaking -> critical
    expect(sent[0]).toContain("BREAKING");
  });
  it("sends nothing when up to date, not mandatory, or no verdict is on chain", async () => {
    expect((await run({ version: "v0.6.0", mandatory: true }, "v0.6.0")).sent).toEqual([]);
    expect((await run({ version: "v0.7.0", mandatory: false }, "v0.6.0")).sent).toEqual([]);
    expect((await run({}, "v0.6.0")).sent).toEqual([]);
  });
});

// When C is checked out next to this repo, fail loudly if its consumer drifted from the pinned copy.
const SIBLING = new URL("../../../../genlayer-changelog-guard/consumer/", import.meta.url);
describe.skipIf(!existsSync(new URL("index.mjs", SIBLING)))("drift against the sibling Changelog Guard checkout", () => {
  it("has the same consumer files as the pinned fixture (otherwise re-verify and re-pin)", () => {
    for (const [name, hash] of Object.entries(manifest.files)) expect(sha(new URL(name, SIBLING)), `C's ${name} changed`).toBe(hash);
  });
});
