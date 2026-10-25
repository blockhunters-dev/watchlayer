import Link from "next/link";
import type { Metadata } from "next";
import { getValidators } from "../../lib/api";
import { gen, relTime, runway, runwayLevel } from "../../lib/format";
import { filterValidators, sortValidators } from "../../lib/sort";
import { SORTS, pct, searchValidators, shares, sortBy, stakeOf, type SortKey } from "../../lib/stats";
import { Bell, PageHead, StatusBadge, ValidatorCell } from "../components";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Validators" };

const FILTERS = [["", "All"], ["active", "Active"], ["pending", "Pending"], ["needs_priming", "Needs priming"], ["banned", "Banned"]] as const;
type Q = { status?: string; q?: string; sort?: string };

const qs = (p: Q) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `/validators?${s}` : "/validators";
};

export default async function Validators({ searchParams }: { searchParams: Promise<Q> }) {
  const { status, q, sort } = await searchParams;
  const all = await getValidators();
  if (!all) return <section className="card"><h1>No data yet</h1><p className="muted">The indexer has not produced a snapshot yet.</p></section>;
  const now = Math.floor(Date.now() / 1000);
  const key: SortKey = (SORTS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : "default";
  const share = shares(all.filter((v) => v.status === "active"));
  const byStake = [...all].sort((a, b) => { const d = stakeOf(b) - stakeOf(a); return d > 0n ? 1 : d < 0n ? -1 : 0; });
  const rank = new Map(byStake.map((v, i) => [v.address, i + 1]));
  const rows = sortBy(searchValidators(filterValidators(all, status), q), key, sortValidators);
  const count = (s: string) => (s ? all.filter((v) => v.status === s).length : all.length);
  const th = (k: SortKey, label: string, cls = "") => <th className={cls}><Link className={key === k ? "on" : ""} href={qs({ status, q, sort: k === "default" ? undefined : k })}>{label}{key === k ? " ↓" : ""}</Link></th>;

  return (
    <>
      <PageHead title="Validators" lead={`${all.length} validators on Bradbury. Problems are listed first; sort by any column or search by name or address.`} />
      <div className="toolbar">
        <nav className="chips" aria-label="Filter by status">
          {FILTERS.map(([k, l]) => <Link key={k} href={qs({ status: k || undefined, q, sort })} className={(status ?? "") === k ? "chip on" : "chip"}>{l}<span className="n">{count(k)}</span></Link>)}
        </nav>
        <form className="search" action="/validators" role="search">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {sort ? <input type="hidden" name="sort" value={sort} /> : null}
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search name or 0x address" aria-label="Search validators" />
          <button type="submit">Search</button>
        </form>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th className="rank">#</th>{th("name", "Validator")}{th("default", "Status")}{th("stake", "Stake", "num")}
            <th className="num hide-m">Share</th><th className="num hide-m">Pending</th>{th("runway", "Runway", "num")}<th className="hide-m">Last tx</th><th aria-label="Alerts" />
          </tr></thead>
          <tbody>
            {rows.map((v) => {
              const pending = v.pendingDeposits.filter((d) => d.stillPending).reduce((a, d) => a + BigInt(d.stakeRaw), 0n).toString();
              const sh = share.get(v.address) ?? 0;
              return (
                <tr key={v.address}>
                  <td className="rank">{rank.get(v.address)}</td>
                  <td><ValidatorCell address={v.address} moniker={v.moniker} logo={v.identity.logo} /></td>
                  <td><StatusBadge status={v.status} ban={v.ban} /></td>
                  <td className="num">{gen(stakeOf(v).toString())}</td>
                  <td className="num hide-m">{v.status === "active" ? <span className="share">{pct(sh, 2)}<span className="mini"><span style={{ width: `${Math.min(100, sh * 100 * 8)}%` }} /></span></span> : <span className="faint">—</span>}</td>
                  <td className="num hide-m">{pending === "0" ? <span className="faint">—</span> : gen(pending)}</td>
                  <td className={`num rw-${runwayLevel(v.gasRunwayDays)}`}>{runway(v.gasRunwayDays)}</td>
                  <td className="hide-m muted">{relTime(v.activity.lastTxAt, now)}</td>
                  <td className="num"><Bell address={v.address} name={v.moniker ?? v.address} /></td>
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={9} className="empty">No validators match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="small faint" style={{ marginTop: 12 }}>Share is each active validator&apos;s part of the total active stake. Gas runway is the operator balance divided by its 24 h burn; it needs two snapshots with a burn before it shows.</p>
    </>
  );
}
