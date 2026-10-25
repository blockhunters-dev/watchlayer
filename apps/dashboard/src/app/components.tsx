import Link from "next/link";
import type { Status } from "../lib/api";
import { sparkPoints } from "../lib/format";
import { compact } from "../lib/stats";
import { Avatar } from "./avatar";

export { Avatar };

export const BOT = "genlayer_watchtower_bot";
/** Telegram deep link; with an address the bot subscribes the chat on /start. */
export const botLink = (address?: string) => `https://t.me/${BOT}${address ? `?start=${address}` : ""}`;

const LABEL: Record<Status, string> = { active: "Active", pending: "Pending", banned: "Banned", needs_priming: "Needs priming" };
export const statusLabel = (s: Status) => LABEL[s];

export function StatusBadge({ status, ban }: { status: Status; ban?: { untilEpoch: string; permanent: boolean } | null }) {
  const extra = status === "banned" && ban ? (ban.permanent ? " · permanent" : ` · until epoch ${ban.untilEpoch}`) : "";
  return <span className={`badge b-${status}`}>{LABEL[status]}{extra}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">{value}</div>
      {sub ? <div className="stat-s">{sub}</div> : null}
    </div>
  );
}

export function SectionHead({ idx, title, more }: { idx: string; title: string; more?: React.ReactNode }) {
  return (
    <div className="shead">
      <h2>{title}</h2>
      {more ? <span className="more">{more}</span> : <span className="idx">[{idx}]</span>}
    </div>
  );
}

export function PageHead({ title, lead, aside }: { title: string; lead?: string; aside?: React.ReactNode }) {
  return (
    <div className="phead">
      <div><h1>{title}</h1>{lead ? <p>{lead}</p> : null}</div>
      {aside}
    </div>
  );
}

export function Spark({ values, label }: { values: number[]; label: string }) {
  const W = 260, H = 56;
  if (values.length < 2) return <div><div className="label">{label}</div><p className="small faint">Collecting data · {values.length} sample{values.length === 1 ? "" : "s"}</p></div>;
  return (
    <figure className="spark">
      <figcaption className="label">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, ${values.length} samples`}>
        <polyline points={sparkPoints(values, W, H)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </figure>
  );
}

/** Area/line chart for a short series; shows a "collecting" state until there are two points. */
export function LineChart({ points, label, fmt = compact, wide = false }: { points: { x: string; y: number }[]; label: string; fmt?: (n: number) => string; wide?: boolean }) {
  if (points.length < 2) {
    return <div className="collecting"><div><b>{points.length ? fmt(points[points.length - 1].y) : "—"}</b>Collecting data · {points.length} sample{points.length === 1 ? "" : "s"} so far</div></div>;
  }
  const W = wide ? 1100 : 560, H = wide ? 210 : 190, L = 44, R = 8, T = 10, B = 26;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo = lo * 0.95; hi = hi * 1.05 || 1; }
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const area = `M${x(0)},${H - B} L${line.replace(/ /g, " L")} L${x(points.length - 1)},${H - B} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.length} points, latest ${fmt(points[points.length - 1].y)}`}>
        {ticks.map((t, i) => <g key={i}><line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="axis" x={L - 8} y={y(t) + 3} textAnchor="end">{fmt(t)}</text></g>)}
        <path className="ar" d={area} />
        <polyline className="ln" points={line} />
        {points.map((p, i) => <circle key={i} className="pt" cx={x(i)} cy={y(p.y)} r={points.length > 40 ? 0 : 3} />)}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) ? <text key={`x${i}`} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{p.x}</text> : null)}
      </svg>
    </figure>
  );
}

export function HBars({ rows }: { rows: { key: string; label: React.ReactNode; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.key}>
          <div className="nm">{r.label}</div>
          <div className="track"><div className="fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} /></div>
          <div className="v">{r.text}</div>
        </div>
      ))}
    </div>
  );
}

export function StatusSplit({ counts }: { counts: { active: number; pending: number; banned: number; needsPriming: number } }) {
  const parts: [Status, number][] = [["active", counts.active], ["banned", counts.banned], ["pending", counts.pending], ["needs_priming", counts.needsPriming]];
  const total = parts.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <>
      <div className="stack" role="img" aria-label={parts.map(([s, n]) => `${n} ${LABEL[s]}`).join(", ")}>
        {parts.filter(([, n]) => n > 0).map(([s, n]) => <span key={s} className={`k-${s}`} style={{ width: `${(n / total) * 100}%` }} />)}
      </div>
      <div className="legend">{parts.map(([s, n]) => <span key={s}><i className={`k-${s}`} />{LABEL[s]} <strong>{n}</strong></span>)}</div>
    </>
  );
}

export function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="muted">—</span>;
}

export function Bell({ address, name }: { address: string; name: string }) {
  return (
    <a className="bell" href={botLink(address)} target="_blank" rel="noopener noreferrer" title={`Get Telegram alerts for ${name}`} aria-label={`Get Telegram alerts for ${name}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
    </a>
  );
}

export function ValidatorCell({ address, moniker, logo }: { address: string; moniker: string | null; logo: string | null }) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <div className="who">
      <Avatar logo={logo} name={moniker ?? address} />
      <div style={{ minWidth: 0 }}><Link href={`/validators/${address}`}><strong>{moniker ?? short}</strong></Link><div className="addr">{short}</div></div>
    </div>
  );
}

export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor" />
      <path d="M8 11 L12 22 L16 14 L20 22 L24 11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
