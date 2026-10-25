import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getValidator, getValidatorEpochs, getValidatorHistory } from "../../../lib/api";
import { gen, relTime, runway, runwayLevel } from "../../../lib/format";
import { genNum } from "../../../lib/stats";
import { Avatar, botLink, ExtLink, LineChart, SectionHead, Spark, Stat, StatusBadge } from "../../components";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Validator ${address.slice(0, 6)}…${address.slice(-4)}` };
}

const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

export default async function ValidatorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  const [v, hist, epochs] = await Promise.all([getValidator(address), getValidatorHistory(address), getValidatorEpochs(address)]);
  if (!v) notFound();
  const now = Math.floor(Date.now() / 1000);
  const h = hist ?? [];
  const waiting = v.pendingDeposits.filter((d) => d.stillPending);
  const total = (BigInt(v.vStake) + BigInt(v.dStake)).toString();

  return (
    <>
      <Link className="back" href="/validators">← All validators</Link>
      <header className="vhead">
        <div className="vname">
          <Avatar logo={v.identity.logo} name={v.moniker ?? v.address} size={64} />
          <div style={{ minWidth: 0 }}>
            <h1>{v.moniker ?? "Validator"} <StatusBadge status={v.status} ban={v.ban} /></h1>
            <div className="links">
              <span><span className="muted">Website</span> <ExtLink href={v.identity.website}>{v.identity.website ? new URL(v.identity.website).host : ""}</ExtLink></span>
              <span><span className="muted">GitHub</span> <ExtLink href={v.identity.github}>{v.identity.github ? new URL(v.identity.github).pathname.slice(1) : ""}</ExtLink></span>
            </div>
            <dl className="ids">
              <div><dt>Validator</dt><dd className="addr">{v.address}</dd></div>
              <div><dt>Operator</dt><dd className="addr">{v.operator}</dd></div>
            </dl>
          </div>
        </div>
        <a className="btn primary" href={botLink(v.address)} target="_blank" rel="noopener noreferrer">🔔 Alert me on Telegram</a>
      </header>

      <nav className="subnav" aria-label="Validator sections">
        <a href="#overview">Overview</a><a href="#stake">Stake</a><a href="#operator">Operator</a><a href="#bans">Bans</a><a href="#epochs">By epoch</a>
      </nav>

      <section id="overview">
        <SectionHead idx="01" title="Overview" />
        <section className="stats" aria-label="Summary">
          <Stat label="Total stake" value={gen(total)} />
          <Stat label="Operator gas" value={gen(v.operatorBalanceWei)} />
          <Stat label="Gas runway" value={<span className={`rw-${runwayLevel(v.gasRunwayDays)}`}>{runway(v.gasRunwayDays)}</span>} sub="at the 24 h burn rate" />
          <Stat label="Strikes" value="Unavailable" sub={v.ban ? (v.ban.permanent ? "banned permanently" : `banned until epoch ${v.ban.untilEpoch}`) : "no strike counter on-chain; ban status shown instead"} />
        </section>
      </section>

      <section id="stake">
        <SectionHead idx="02" title="Stake" />
        <section className="stats" aria-label="Stake">
          <Stat label="Active self stake" value={gen(v.vStake)} />
          <Stat label="Delegated stake" value={gen(v.dStake)} />
          <Stat label="Pending withdrawals" value={v.pendingWithdrawals.length ? v.pendingWithdrawals.map((w) => <div key={w.epoch}>{gen(w.stakeRaw)}<span className="muted small"> · requested epoch {w.epoch}</span></div>) : "—"} />
          <Stat label="Pending deposits" value={waiting.length ? waiting.map((d) => <div key={d.epoch}>{gen(d.stakeRaw)}<span className="muted small"> · active from epoch {d.activatesAtEpoch}</span></div>) : "—"} />
        </section>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Active stake over time</h3><p className="sub">GEN, per snapshot.</p>
          <LineChart wide label="Active stake" points={h.map((p) => ({ x: hhmm(p.t), y: genNum((BigInt(p.vStake) + BigInt(p.dStake)).toString()) }))} />
        </div>
      </section>

      <section id="operator">
        <SectionHead idx="03" title="Operator" />
        <section className="stats" aria-label="Operator">
          <Stat label="Operator gas" value={gen(v.operatorBalanceWei)} />
          <Stat label="Last operator tx" value={relTime(v.activity.lastTxAt, now)} sub={`${v.activity.txLast24h} tx in 24 h · silent ${v.activity.silentHours.toFixed(1)} h`} />
          <Stat label="First seen" value={relTime(v.firstSeenAt, now)} sub="by the WatchLayer indexer" />
        </section>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>History</h3><p className="sub">Per snapshot since the indexer first saw this validator.</p>
          <div className="sparks">
            <Spark label="Operator gas (GEN)" values={h.map((p) => Number(BigInt(p.operatorBalanceWei) / 10n ** 14n) / 1e4)} />
            <Spark label="Active stake (GEN)" values={h.map((p) => Number((BigInt(p.vStake) + BigInt(p.dStake)) / 10n ** 14n) / 1e4)} />
            <Spark label="Operator transactions (nonce)" values={h.map((p) => p.operatorNonce)} />
          </div>
        </div>
      </section>

      <section id="bans">
        <SectionHead idx="04" title="Ban history" />
        <div className="card">
          {v.bans.length === 0
            ? <p className="muted" style={{ margin: 0 }}>No ban observed since {relTime(v.firstSeenAt, now)} (first seen). Observation starts when the indexer first saw the validator.</p>
            : <ul className="timeline">{v.bans.map((b) => {
                const ongoing = v.status === "banned" && v.ban?.untilEpoch === b.untilEpoch && v.ban?.permanent === b.permanent;
                return (
                  <li key={`${b.untilEpoch}-${b.permanent}-${b.firstSeenAt}`} className={ongoing ? "" : "ended"}>
                    <strong>{b.permanent ? "Permanent ban" : `Banned until epoch ${b.untilEpoch}`}</strong> {ongoing ? <span className="badge b-banned">Ongoing</span> : <span className="badge b-ended">Ended</span>}
                    <div className="muted small">first seen {relTime(b.firstSeenAt, now)}, last seen {relTime(b.lastSeenAt, now)}</div>
                  </li>);
              })}</ul>}
        </div>
      </section>

      <section id="epochs">
        <SectionHead idx="05" title="By epoch" />
        <div className="tablewrap">
          <table>
            <thead><tr><th>Epoch</th><th>Status</th><th className="num">Active stake</th><th className="num">Operator gas</th><th className="num">Operator tx</th></tr></thead>
            <tbody>
              {[...(epochs ?? [])].reverse().map((e) => (
                <tr key={e.epoch}>
                  <td>{e.epoch}</td><td><StatusBadge status={e.status} /></td>
                  <td className="num">{gen((BigInt(e.vStake) + BigInt(e.dStake)).toString())}</td>
                  <td className="num">{gen(e.operatorBalanceWei)}</td>
                  <td className="num">{e.operatorTx ?? "—"}</td>
                </tr>
              ))}
              {!epochs?.length ? <tr><td colSpan={5} className="empty">No epoch data yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
