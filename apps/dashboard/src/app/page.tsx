import Link from "next/link";
import { getNetwork, getNetworkEpochs, getNetworkHistory, getValidators } from "../lib/api";
import { gen, relTime } from "../lib/format";
import { banRows, compact, genNum, nakamoto, pct, stakeOf, topShare } from "../lib/stats";
import { Avatar, botLink, HBars, LineChart, SectionHead, Stat, StatusBadge, StatusSplit, ValidatorCell } from "./components";

export const dynamic = "force-dynamic";

const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

export default async function Overview() {
  const [net, all, epochs, hist] = await Promise.all([getNetwork(), getValidators(), getNetworkEpochs(), getNetworkHistory()]);
  if (!net || !all) {
    return <section className="card"><h1>No data yet</h1><p className="muted">The indexer has not produced a snapshot. The first one takes 2–3 minutes after start.</p></section>;
  }
  const now = Math.floor(Date.now() / 1000);
  const c = net.validators;
  const active = all.filter((v) => v.status === "active");
  const top = [...active].sort((a, b) => { const d = stakeOf(b) - stakeOf(a); return d > 0n ? 1 : d < 0n ? -1 : 0; }).slice(0, 10);
  const nk = nakamoto(all);
  const banned = banRows(all).filter((b) => b.ongoing).slice(0, 6);
  const ep = epochs ?? [];

  return (
    <>
      <section className="hero">
        <p className="eyebrow">[ GenLayer Testnet · Bradbury Phase 2 ]</p>
        <h1 className="display">Every GenLayer validator, watched live.</h1>
        <p className="lead">Status, stake, bans and operator gas for all {c.total} validators on chain 4221, refreshed every few minutes, with alerts straight to Telegram.</p>
        <div className="cta">
          <Link className="btn primary" href="/validators">Explore validators →</Link>
          <a className="btn" href={botLink()} target="_blank" rel="noopener noreferrer">Get alerts on Telegram</a>
        </div>
      </section>

      <section className="stats six" aria-label="Network overview">
        <Stat label="Epoch" value={net.epoch} sub={net.nextEpochEstimate ? `next ${relTime(net.nextEpochEstimate, now)}` : undefined} />
        <Stat label="Validators" value={c.total} sub={`${c.active} active · ${c.pending} pending · ${c.banned} banned · ${c.needsPriming} need priming`} />
        <Stat label="Total stake (active)" value={gen(net.totalStake)} />
        <Stat label="Transactions / hour" value={net.txPerHour ?? "—"} sub="user transactions, last hour" />
        <Stat label="Block interval" value={net.avgBlockSeconds === null ? "—" : `${net.avgBlockSeconds.toFixed(0)} s`} sub="average over the last hour" />
        <Stat label="Data source uptime (24h)" value={net.rpc.uptime24h === null ? "—" : `${(net.rpc.uptime24h * 100).toFixed(1)}%`}
          sub={`${net.rpc.runs24h} collection runs · last ${net.rpc.snapshotDurationMs === null ? "—" : Math.round(net.rpc.snapshotDurationMs / 1000) + " s"}`} />
      </section>

      <SectionHead idx="01" title="Validator set" />
      <div className="grid2">
        <div className="card">
          <h3>Status</h3>
          <p className="sub">Current snapshot, {relTime(net.snapshotAt, now)}.</p>
          <StatusSplit counts={c} />
        </div>
        <div className="card">
          <h3>Stake concentration</h3>
          <p className="sub">Active validators only.</p>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div><div className="big">{nk}</div><div className="label" style={{ marginTop: 8 }}>validators hold &gt; 1/3 of stake</div></div>
            <div><div className="big">{pct(topShare(all, 10), 0)}</div><div className="label" style={{ marginTop: 8 }}>of stake in the top 10</div></div>
          </div>
        </div>
      </div>

      <SectionHead idx="02" title="Top 10 by stake" more={<Link href="/validators?sort=stake">All validators →</Link>} />
      <div className="card">
        <HBars rows={top.map((v) => ({
          key: v.address, value: genNum(stakeOf(v)), text: `${compact(genNum(stakeOf(v)))} GEN`,
          label: <><Avatar logo={v.identity.logo} name={v.moniker ?? v.address} size={22} /><Link href={`/validators/${v.address}`}>{v.moniker ?? `${v.address.slice(0, 6)}…${v.address.slice(-4)}`}</Link></>,
        }))} />
      </div>

      <SectionHead idx="03" title="Trends" more={<Link href="/epochs">By epoch →</Link>} />
      <div className="grid2">
        <div className="card"><h3>Total stake by epoch</h3><p className="sub">GEN, at the last snapshot of each epoch.</p>
          <LineChart label="Total stake by epoch" points={ep.map((e) => ({ x: `E${e.epoch}`, y: genNum(e.totalStake) }))} /></div>
        <div className="card"><h3>Active validators</h3><p className="sub">One point per indexer snapshot.</p>
          <LineChart label="Active validators" fmt={(n) => n.toFixed(0)} points={(hist ?? []).map((p) => ({ x: hhmm(p.t), y: p.activeCount }))} /></div>
      </div>

      <SectionHead idx="04" title="Currently banned" more={<Link href="/bans">Ban history →</Link>} />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Validator</th><th>Ban</th><th className="num">Stake</th><th className="hide-m">First seen banned</th></tr></thead>
          <tbody>
            {banned.map((b) => (
              <tr key={`${b.v.address}-${b.untilEpoch}`}>
                <td><ValidatorCell address={b.v.address} moniker={b.v.moniker} logo={b.v.identity.logo} /></td>
                <td><StatusBadge status="banned" ban={b} /></td>
                <td className="num">{gen(stakeOf(b.v).toString())}</td>
                <td className="hide-m muted">{relTime(b.firstSeenAt, now)}</td>
              </tr>
            ))}
            {banned.length === 0 ? <tr><td colSpan={4} className="empty">No validator is banned right now.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
