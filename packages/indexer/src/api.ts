import { createServer, type Server } from "node:http";
import { balanceSamples, banHistory, firstSeenAt, latestEpoch, latestValidators, networkEpochs, networkHistory, nonceSamples, rpcHealth, validatorEpochs, validatorHistory, type Db } from "./db.js";
import { depositActivation, operatorActivity, runwayDays } from "./derive.js";

type Row = Record<string, unknown>;

// Every derived value is computed at the snapshot's own time (r.t), never the request time, so two readers
// of the same snapshot get identical responses (clients may read it from several nodes).
function shape(db: Db, r: Row) {
  const now = r.t as number;
  const address = r.address as string;
  const epoch = BigInt((latestEpoch(db) as Row).epoch as string);
  const bans = banHistory(db, address);
  return {
    address, operator: r.operator, moniker: r.moniker,
    identity: r.identity ? JSON.parse(r.identity as string) : { moniker: r.moniker, logo: null, website: null, github: null },
    status: r.status,
    vStake: r.v_stake, dStake: r.d_stake,
    pendingDeposits: (JSON.parse(r.pending_deposits as string) as { epoch: string; stakeRaw: string }[]).map((d) => {
      const a = depositActivation(BigInt(d.epoch), epoch);
      return { ...d, activatesAtEpoch: a.activatesAtEpoch.toString(), stillPending: a.stillPending };
    }),
    operatorBalanceWei: r.operator_balance,
    gasRunwayDays: runwayDays(balanceSamples(db, address, now - 86400)),
    pendingWithdrawals: r.pending_withdrawals ? JSON.parse(r.pending_withdrawals as string) : [],
    firstSeenAt: firstSeenAt(db, address),
    bans, lastBannedAt: bans.length ? Math.max(...bans.map((b) => b.lastSeenAt)) : null,
    activity: operatorActivity(nonceSamples(db, address), now),
    ban: r.ban ? JSON.parse(r.ban as string) : null,
    strikes: null, // not exposed by the Staking views
    snapshotAt: r.t,
  };
}

export function createApi(db: Db, clock: () => number = () => Math.floor(Date.now() / 1000)): Server {
  return createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/$/, "") || "/";
    const now = clock();
    if (path === "/health") return send(200, { ok: true, lastSnapshot: (latestEpoch(db) as Row | undefined)?.t ?? null });
    if (path === "/network") {
      const e = latestEpoch(db) as Row | undefined;
      if (!e) return send(503, { error: "no snapshot yet" });
      const vs = latestValidators(db) as Row[];
      const count = (s: string) => vs.filter((v) => v.status === s).length;
      return send(200, {
        epoch: e.epoch, nextEpochEstimate: e.next_epoch_estimate, snapshotAt: e.t,
        // Self + delegated stake of active validators only.
        totalStake: vs.filter((v) => v.status === "active").reduce((a, v) => a + BigInt(v.v_stake as string) + BigInt(v.d_stake as string), 0n).toString(),
        txPerHour: e.tx_last_hour,
        avgBlockSeconds: e.avg_block_seconds,
        rpc: rpcHealth(db, now),
        validators: { total: vs.length, active: count("active"), pending: count("pending"), banned: count("banned"), needsPriming: count("needs_priming") },
      });
    }
    if (path === "/validators") return send(200, (latestValidators(db) as Row[]).map((r) => shape(db, r)));
    if (path === "/network/history") return send(200, networkHistory(db).map((r) => ({ t: r.t, epoch: r.epoch, activeCount: r.active_count, txPerHour: r.tx_last_hour })));
    if (path === "/network/epochs") return send(200, networkEpochs(db));
    const ep = path.match(/^\/validators\/(0x[0-9a-fA-F]{40})\/epochs$/);
    if (ep) {
      const known = (latestValidators(db) as Row[]).find((v) => (v.address as string).toLowerCase() === ep[1].toLowerCase());
      return known ? send(200, validatorEpochs(db, known.address as string)) : send(404, { error: "unknown validator" });
    }
    const h = path.match(/^\/validators\/(0x[0-9a-fA-F]{40})\/history$/);
    if (h) {
      const rows = (latestValidators(db) as Row[]).find((v) => (v.address as string).toLowerCase() === h[1].toLowerCase());
      if (!rows) return send(404, { error: "unknown validator" });
      return send(200, validatorHistory(db, rows.address as string).map((r) => ({
        t: r.t, status: r.status, vStake: r.v_stake, dStake: r.d_stake, operatorBalanceWei: r.operator_balance, operatorNonce: r.operator_nonce })));
    }
    const m = path.match(/^\/validators\/(0x[0-9a-fA-F]{40})$/);
    if (m) {
      const r = (latestValidators(db) as Row[]).find((v) => (v.address as string).toLowerCase() === m[1].toLowerCase());
      return r ? send(200, shape(db, r)) : send(404, { error: "unknown validator" });
    }
    send(404, { error: "not found" });
  });
}
