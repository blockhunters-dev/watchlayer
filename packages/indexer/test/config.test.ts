import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults to a 120s poll and port 20360", () => {
    const c = loadConfig({});
    expect(c.pollMs).toBe(120_000);
    expect(c.port).toBe(20360);
    expect(c.chainId).toBe(4221);
  });
  it("honours POLL_SECONDS", () => {
    expect(loadConfig({ POLL_SECONDS: "30" }).pollMs).toBe(30_000);
  });
  it(".env.example documents the same default", () => {
    const ex = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    expect(ex).toMatch(/^POLL_SECONDS=120\b/m);
  });
});
