import { describe, it, expect, vi, afterEach } from "vitest";
import { startPolling } from "../src/poll.js";

afterEach(() => vi.useRealTimers());

describe("startPolling", () => {
  it("never overlaps runs and waits the interval after a slow run finishes", async () => {
    vi.useFakeTimers();
    let running = 0, maxRunning = 0, calls = 0;
    const tick = async () => {
      calls++; running++; maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 150)); // slower than the 60 interval
      running--;
    };
    const stop = startPolling(tick, 60);
    await vi.advanceTimersByTimeAsync(149);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + 59); // run 1 done at 150, next starts at 210
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(maxRunning).toBe(1);
    stop();
  });

  it("keeps polling after a failed run and stops on request", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const stop = startPolling(async () => { calls++; throw new Error("rpc down"); }, 10);
    await vi.advanceTimersByTimeAsync(35);
    expect(calls).toBe(4);
    stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(4);
  });
});
