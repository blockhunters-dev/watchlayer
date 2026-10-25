import { describe, it, expect } from "vitest";
import { depositActivation, isBannedNow, operatorActivity } from "../src/derive.js";
import { scanLastHour } from "../src/chain.js";

describe("operatorActivity", () => {
  it("tracks last tx, 24h count and silence", () => {
    const a = operatorActivity([{ t: 0, nonce: 1 }, { t: 100, nonce: 1 }, { t: 200, nonce: 4 }, { t: 300, nonce: 4 }], 200 + 7200);
    expect(a.lastTxAt).toBe(200);
    expect(a.txLast24h).toBe(3);
    expect(a.silentHours).toBeCloseTo(2);
  });
  it("counts silence from first snapshot when no tx was ever seen", () => {
    const a = operatorActivity([{ t: 0, nonce: 0 }, { t: 100, nonce: 0 }], 3600);
    expect(a).toEqual({ lastTxAt: null, txLast24h: 0, silentHours: 1 });
  });
  it("handles no samples", () => {
    expect(operatorActivity([], 10)).toEqual({ lastTxAt: null, txLast24h: 0, silentHours: 0 });
  });
});

describe("scanLastHour", () => {
  const blocks: Record<string, { timestamp: bigint; transactions: unknown[] }> = {
    "10": { timestamp: 10_000n, transactions: [1, 2] },
    "9": { timestamp: 9_900n, transactions: [1] },
    "8": { timestamp: 5_000n, transactions: [1, 2, 3] }, // older than 1h -> stop
  };
  it("sums user txs (not the per-block system tx) within the last hour, stops at the first older one", async () => {
    expect(await scanLastHour(async (n) => blocks[n.toString()], 10n, 10_000)).toEqual({ txCount: 1, avgBlockSeconds: 100 });
  });
  it("respects maxBlocks", async () => {
    expect(await scanLastHour(async (n) => blocks[n.toString()], 10n, 10_000, 1)).toEqual({ txCount: null, avgBlockSeconds: null });
  });
  it("reports unknown when the cap is hit and the covered window is too short to extrapolate", async () => {
    const dense = async (n: bigint) => ({ timestamp: 10_000n - (10n - n), transactions: [1] }); // all blocks within the hour
    expect(await scanLastHour(dense, 10n, 10_000, 3)).toEqual({ txCount: null, avgBlockSeconds: 1 });
  });
  it("is complete when the chain is shorter than the hour", async () => {
    const dense = async (n: bigint) => ({ timestamp: 10_000n - (3n - n), transactions: [1, 2] });
    expect(await scanLastHour(dense, 3n, 10_000)).toEqual({ txCount: 4, avgBlockSeconds: 1 });
  });
  it("extrapolates the hourly rate from at least 5 minutes of blocks when the cap is hit", async () => {
    // 2 s blocks, each with the system tx plus one user tx; 300 blocks cover 598 s
    const fast = async (n: bigint) => ({ timestamp: 10_000n - 2n * (1000n - n), transactions: [0, 1] });
    expect(await scanLastHour(fast, 1000n, 10_000, 300)).toEqual({ txCount: Math.round((300 * 3600) / 598), avgBlockSeconds: 2 });
  });
});

describe("depositActivation", () => {
  it("activates two epochs after the deposit epoch", () => {
    expect(depositActivation(2n, 2n)).toEqual({ activatesAtEpoch: 4n, stillPending: true });
    expect(depositActivation(2n, 3n).stillPending).toBe(true);
    expect(depositActivation(2n, 4n).stillPending).toBe(false);
    expect(depositActivation(0n, 2n).stillPending).toBe(false); // genesis deposits listed on active validators
  });
});

describe("isBannedNow", () => {
  it("is banned until the ban epoch passes, or forever if permanent", () => {
    expect(isBannedNow(null, 2n)).toBe(false);
    expect(isBannedNow({ untilEpoch: 4n, permanent: false }, 2n)).toBe(true);
    expect(isBannedNow({ untilEpoch: 4n, permanent: false }, 4n)).toBe(false);
    expect(isBannedNow({ untilEpoch: 0n, permanent: true }, 9n)).toBe(true);
  });
});
