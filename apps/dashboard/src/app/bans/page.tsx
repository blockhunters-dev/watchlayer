import type { Metadata } from "next";
import { getNetwork, getValidators } from "../../lib/api";
import { gen, relTime } from "../../lib/format";
import { banRows, stakeOf } from "../../lib/stats";
import { HBars, PageHead, SectionHead, Stat, StatusBadge, ValidatorCell } from "../components";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bans" };

export default async function Bans() {
  const [net, all] = await Promise.all([getNetwork(), getValidators()]);
  if (!all) return <section className="card"><h1>No data yet</h1><p className="muted">The indexer has not produced a snapshot yet.</p></section>;
  const now = Math.floor(Date.now() / 1000);
  const rows = banRows(all);
  const ongoing = rows.filter((r) => r.ongoing);
  const stakeBanned = ongoing.reduce((a, r) => a + stakeOf(r.v), 0n);
  const repeat = all.filter((v) => v.bans.length > 1).sort((a, b) => b.bans.length - a.bans.length).slice(0, 8);
  const firstSeen = Math.min(...all.map((v) => v.firstSeenAt ?? now));

  return (
    <>
      <PageHead title="Bans" lead="Validators banned by the protocol, as observed by the indexer. Strike counters are not exposed on-chain, so a ban is the first visible signal." />
      <section className="stats">
        <Stat label="Banned now" value={ongoing.length} sub={net ? `of ${net.validators.total} validators` : undefined} />
        <Stat label="Stake behind banned validators" value={gen(stakeBanned.toString())} />
        <Stat label="Ban windows observed" value={rows.length} sub={`since ${relTime(firstSeen, now)}`} />
        <Stat label="Repeat offenders" value={repeat.length} sub="more than one ban window" />
      </section>

      <SectionHead idx="01" title="Banned now" />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Validator</th><th>Ban</th><th className="num">Stake</th><th className="hide-m">First seen banned</th><th className="hide-m">Bans observed</th></tr></thead>
          <tbody>
            {ongoing.map((r) => (
              <tr key={`${r.v.address}-${r.untilEpoch}`}>
                <td><ValidatorCell address={r.v.address} moniker={r.v.moniker} logo={r.v.identity.logo} /></td>
                <td><StatusBadge status="banned" ban={r} /></td>
                <td className="num">{gen(stakeOf(r.v).toString())}</td>
                <td className="hide-m muted">{relTime(r.firstSeenAt, now)}</td>
                <td className="hide-m">{r.v.bans.length}</td>
              </tr>
            ))}
            {ongoing.length === 0 ? <tr><td colSpan={5} className="empty">No validator is banned right now.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <SectionHead idx="02" title="Ban history" />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Validator</th><th>Window</th><th>State</th><th className="hide-m">First seen</th><th className="hide-m">Last seen</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.v.address}-${r.untilEpoch}-${r.firstSeenAt}`}>
                <td><ValidatorCell address={r.v.address} moniker={r.v.moniker} logo={r.v.identity.logo} /></td>
                <td>{r.permanent ? "Permanent" : `Until epoch ${r.untilEpoch}`}</td>
                <td>{r.ongoing ? <span className="badge b-banned">Ongoing</span> : <span className="badge b-ended">Ended</span>}</td>
                <td className="hide-m muted">{relTime(r.firstSeenAt, now)}</td>
                <td className="hide-m muted">{relTime(r.lastSeenAt, now)}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="empty">No ban observed yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {repeat.length ? <>
        <SectionHead idx="03" title="Banned more than once" />
        <div className="card"><HBars rows={repeat.map((v) => ({ key: v.address, value: v.bans.length, text: `${v.bans.length} bans`, label: <span className="t">{v.moniker ?? v.address}</span> }))} /></div>
      </> : null}
      <p className="small faint" style={{ marginTop: 16 }}>History starts when the indexer first saw each validator; bans that ended before that are not visible.</p>
    </>
  );
}
