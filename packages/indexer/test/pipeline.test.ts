import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { openDb } from "../src/db.js";
import { collectOnce, runCollection } from "../src/collect.js";
import { createApi } from "../src/api.js";
import type { ChainReader, ValidatorSnapshot } from "../src/types.js";

const ADDR = "0x42b7bb7CDD228AeCEf96cbDaa5c94Ebc6A65635f";
const v = (wei: bigint, nonce = 0): ValidatorSnapshot => ({
  address: ADDR, owner: "0x1", operator: "0x2", moniker: "BlockHunters",
  identity: { moniker: "BlockHunters", logo: "https://ipfs.io/ipfs/bafyX", website: "https://blockhunters.org/", github: "https://github.com/blockhunters" },
  vStakeRaw: 0n, dStakeRaw: 0n, pendingDeposits: [{ epoch: 4n, stakeRaw: 50_000n * 10n ** 18n }],
  banned: false, ban: null, pendingWithdrawals: [], needsPriming: false, active: false, operatorBalanceWei: wei, operatorNonce: nonce,
});
const OTHER = "0x1111111111111111111111111111111111111111";
const BANNED = "0x2222222222222222222222222222222222222222";
const reader = (wei: bigint, nonce = 0): ChainReader => ({
  getEpoch: async () => ({ currentEpoch: 2n, activeCount: 47, nextEpochEstimate: new Date(2e12), txLastHour: 7, avgBlockSeconds: 118.5 }),
  getValidators: async () => [v(wei, nonce), { ...v(0n), address: OTHER, active: true, vStakeRaw: 5n * 10n ** 18n, dStakeRaw: 2n * 10n ** 18n },
    { ...v(0n), address: BANNED, banned: true, ban: { untilEpoch: 4n, permanent: false } }],
});

let server: ReturnType<typeof createApi>;
afterEach(() => server?.close());

describe("collect -> api", () => {
  it("serves pending stake, status and gas runway from snapshots", async () => {
    const db = openDb(":memory:");
    const D = 86400;
    await runCollection(db, reader(100n * 10n ** 18n, 3), 1_000_000);
    await runCollection(db, reader(90n * 10n ** 18n, 5), 1_000_000 + D);
    await runCollection(db, { getEpoch: async () => { throw new Error("rpc down"); }, getValidators: async () => [] }, 1_000_000 + D).catch(() => {});
    server = createApi(db, () => 1_000_000 + D).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const one = await (await fetch(`${base}/validators/${ADDR.toLowerCase()}`)).json();
    expect(one.identity).toEqual({ moniker: "BlockHunters", logo: "https://ipfs.io/ipfs/bafyX", website: "https://blockhunters.org/", github: "https://github.com/blockhunters" });
    expect(one.status).toBe("pending");
    expect(one.vStake).toBe("0");
    expect(one.pendingDeposits[0]).toEqual({ epoch: "4", stakeRaw: (50_000n * 10n ** 18n).toString(), activatesAtEpoch: "6", stillPending: true });
    expect(one.gasRunwayDays).toBeCloseTo(9);
    expect(one.strikes).toBeNull();
    expect(one.ban).toBeNull();

    const net = await (await fetch(`${base}/network`)).json();
    expect(net.epoch).toBe("2");
    expect(net.validators).toMatchObject({ total: 3, pending: 1, active: 1, banned: 1 });
    const b = await (await fetch(`${base}/validators/${BANNED}`)).json();
    expect(b.status).toBe("banned");
    expect(b.ban).toEqual({ untilEpoch: "4", permanent: false });
    expect(b.strikes).toBeNull();
    expect(net.totalStake).toBe((7n * 10n ** 18n).toString());
    expect(net.txPerHour).toBe(7);
    expect(net.avgBlockSeconds).toBe(118.5);
    expect(net.rpc).toMatchObject({ runs24h: 3, lastSuccessAt: 1_000_000 + D });
    expect(net.rpc.uptime24h).toBeCloseTo(2 / 3);
    expect(net.rpc.snapshotDurationMs).toBeGreaterThanOrEqual(0);
    expect(one.activity).toEqual({ lastTxAt: 1_000_000 + D, txLast24h: 2, silentHours: 0 });

    const hist = await (await fetch(`${base}/validators/${ADDR}/history`)).json();
    expect(hist.map((r: { operatorNonce: number }) => r.operatorNonce)).toEqual([3, 5]);
    // epoch roll-over: a third snapshot in epoch 3 must not change epoch 2's end state
    const roll: ChainReader = { ...reader(80n * 10n ** 18n, 9), getEpoch: async () => ({ currentEpoch: 3n, activeCount: 48, nextEpochEstimate: null, txLastHour: 11 }) };
    await collectOnce(db, roll, 1_000_000 + 2 * D);
    const eps = await (await fetch(`${base}/validators/${ADDR}/epochs`)).json();
    expect(eps.map((e: { epoch: string }) => e.epoch)).toEqual(["2", "3"]);
    expect(eps[0]).toMatchObject({ epoch: "2", operatorNonce: 5, operatorTx: null, operatorBalanceWei: (90n * 10n ** 18n).toString() });
    expect(eps[1]).toMatchObject({ epoch: "3", operatorNonce: 9, operatorTx: 4 });
    const ne = await (await fetch(`${base}/network/epochs`)).json();
    expect(ne.map((e: { epoch: string }) => e.epoch)).toEqual(["2", "3"]);
    expect(ne[0]).toMatchObject({ txPerHour: 7, totalStake: (7n * 10n ** 18n).toString(), validators: { total: 3, active: 1, pending: 1, banned: 1 } });
    expect((await fetch(`${base}/validators/0x3333333333333333333333333333333333333333/epochs`)).status).toBe(404);
    const nh = await (await fetch(`${base}/network/history`)).json();
    expect(nh).toHaveLength(3);
    expect(nh[0]).toMatchObject({ epoch: "2", txPerHour: 7 });
    expect((await fetch(`${base}/validators/${OTHER}/history`)).status).toBe(200);
    expect((await fetch(`${base}/validators/0xnope`)).status).toBe(404);
  });
});
