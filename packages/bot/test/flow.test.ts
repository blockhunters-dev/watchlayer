import { describe, it, expect, vi, afterEach } from "vitest";
import { openStore } from "../src/store.js";
import { checkAlerts } from "../src/poll.js";

const A = "0x42b7bb7CDD228AeCEf96cbDaa5c94Ebc6A65635f";
const serve = (status: string, runway: number | null) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{
  address: A, operator: "0x2", moniker: "BlockHunters", status, vStake: "0", dStake: "0", pendingDeposits: [],
  operatorBalanceWei: "1000000000000000000", gasRunwayDays: runway, snapshotAt: 1, ban: null, activity: { lastTxAt: 1, txLast24h: 1, silentHours: 0 } }])));
afterEach(() => vi.unstubAllGlobals());

describe("store + checkAlerts", () => {
  it("subscribes case-insensitively, alerts once, persists state", async () => {
    const store = openStore(":memory:");
    store.watch(7, A);
    store.watch(7, A.toLowerCase());
    expect(store.list(7)).toHaveLength(1);
    const sent: string[] = [];
    const send = async (_: number, t: string) => void sent.push(t);

    serve("pending", 10); await checkAlerts(store, "http://x", send);
    serve("active", 2);   await checkAlerts(store, "http://x", send);
    serve("active", 2);   await checkAlerts(store, "http://x", send);
    expect(sent).toHaveLength(2); // runway<3d + pending->active, not repeated
    expect(store.unwatch(7, A)).toBe(true);
    expect(store.unwatch(7, A)).toBe(false);
  });
  it("does not save state when sending fails, so the alert is retried", async () => {
    const store = openStore(":memory:");
    store.watch(1, A);
    serve("active", 10); await checkAlerts(store, "http://x", async () => {});
    serve("banned", 10);
    await checkAlerts(store, "http://x", async () => { throw new Error("tg down"); }); // does not throw
    const sent: string[] = [];
    await checkAlerts(store, "http://x", async (_, t) => void sent.push(t));
    expect(sent[0]).toContain("banned");
  });

  it("isolates failing chats: others still get alerts, blocked chats are unsubscribed", async () => {
    const store = openStore(":memory:");
    store.watch(1, A); store.watch(2, A); store.watch(3, A);
    serve("active", 10); await checkAlerts(store, "http://x", async () => {});
    serve("banned", 10);
    const got: number[] = [];
    await checkAlerts(store, "http://x", async (chat) => {
      if (chat === 1) throw Object.assign(new Error("Forbidden: bot was blocked"), { error_code: 403 });
      if (chat === 2) throw new Error("timeout");
      got.push(chat);
    });
    expect(got).toEqual([3]);
    expect(store.list(1)).toEqual([]);      // permanent: dropped
    expect(store.list(2)).toHaveLength(1);  // transient: kept, retried next run
    const retry: number[] = [];
    await checkAlerts(store, "http://x", async (chat) => void retry.push(chat));
    expect(retry).toEqual([2]);
  });
});
