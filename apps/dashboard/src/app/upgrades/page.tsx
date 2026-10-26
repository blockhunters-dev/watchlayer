import type { Metadata } from "next";
import { getUpgrades, type UpgradeVerdict } from "../../lib/api";
import { relTime } from "../../lib/format";
import { botLink, PageHead, SectionHead, Stat } from "../components";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Node upgrades" };

const GUARD_REPO = "https://github.com/blockhunters-dev/genlayer-changelog-guard";
const explorer = (a: string) => `https://explorer-bradbury.genlayer.com/address/${a}`;

function Flag({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return <span className={on ? "badge b-banned" : "badge b-active"}>{on ? yes : no}</span>;
}

function Keys({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div>
      <div className="label">{label}</div>
      {keys.length ? <div className="keys">{keys.map((k) => <code key={k} className="key">{k}</code>)}</div> : <p className="small faint" style={{ margin: "8px 0 0" }}>None in this release.</p>}
    </div>
  );
}

function VerdictCard({ v, now }: { v: UpgradeVerdict; now: number }) {
  return (
    <div className="card verdict">
      <div className="vtop">
        <div>
          <div className="label">Latest release · {v.network}</div>
          <div className="big" style={{ marginTop: 8 }}>v{v.version.replace(/^v/, "")}</div>
        </div>
        <div className="flags">
          <Flag on={v.mandatory} yes="Mandatory upgrade" no="Not mandatory" />
          <Flag on={v.breaking} yes="Breaking" no="Not breaking" />
          {v.deadline ? <span className="badge b-pending">Deadline {v.deadline}</span> : null}
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 22 }}>
        <Keys label="config.yaml changes" keys={v.config_changes} />
        <Keys label="Environment variable changes" keys={v.env_changes} />
      </div>
      {v.actions.length ? (
        <div style={{ marginTop: 18 }}>
          <div className="label">Actions for operators</div>
          <ul className="actions">{v.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      ) : null}
      <p className="small muted" style={{ margin: "18px 0 0" }}>
        Source: <a href={v.source_url} target="_blank" rel="noopener noreferrer nofollow">{v.source_url.replace(/^https?:\/\//, "")}</a> · first seen by WatchLayer {relTime(v.firstSeenAt, now)}
      </p>
    </div>
  );
}

export default async function Upgrades() {
  const u = await getUpgrades();
  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <PageHead title="Node upgrades" lead="Release verdicts for GenLayer nodes, published on-chain by the Changelog Guard intelligent contract: validators read the release notes and must agree on what an operator has to do."
        aside={<a className="btn primary" href={botLink()} target="_blank" rel="noopener noreferrer">Get upgrade alerts</a>} />

      {!u || !u.enabled ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Upgrade verdicts are not configured on this instance.</p></div>
      ) : (
        <>
          <section className="stats">
            <Stat label="Contract" value={<a href={explorer(u.contract ?? "")} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 15 }}>{(u.contract ?? "").slice(0, 8)}…{(u.contract ?? "").slice(-6)}</a>} sub="Changelog Guard on Bradbury" />
            <Stat label="Network" value={u.network ?? "—"} />
            <Stat label="Last checked" value={relTime(u.checkedAt, now)} sub={u.error ? `last read failed: ${u.error}` : "read with gen_call, no key"} />
            <Stat label="Releases recorded" value={u.history.length} />
          </section>

          <SectionHead idx="01" title="Current verdict" />
          {u.latest ? <VerdictCard v={u.latest} now={now} /> : <div className="card"><p className="muted" style={{ margin: 0 }}>No verdict has been published for {u.network} yet.</p></div>}

          <SectionHead idx="02" title="Release history" />
          <div className="tablewrap">
            <table>
              <thead><tr><th>Version</th><th>Mandatory</th><th>Breaking</th><th className="hide-m">Deadline</th><th className="num hide-m">Config / env changes</th><th>First seen</th></tr></thead>
              <tbody>
                {u.history.map((h) => (
                  <tr key={h.version}>
                    <td className="mono">v{h.version.replace(/^v/, "")}</td>
                    <td>{h.mandatory ? <span className="badge b-banned">Yes</span> : <span className="badge b-ended">No</span>}</td>
                    <td>{h.breaking ? <span className="badge b-banned">Yes</span> : <span className="badge b-ended">No</span>}</td>
                    <td className="hide-m muted">{h.deadline ?? "—"}</td>
                    <td className="num hide-m">{h.config_changes.length} / {h.env_changes.length}</td>
                    <td className="muted">{relTime(h.firstSeenAt, now)}</td>
                  </tr>
                ))}
                {u.history.length === 0 ? <tr><td colSpan={6} className="empty">No releases recorded yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SectionHead idx="03" title="How a verdict is produced" />
      <div className="alist">
        <div className="panel"><h3>1 · Submit</h3><p>Anyone calls <span className="cmd">submit(network, version, url)</span> with a release page from docs.genlayer.com or a genlayerlabs release tag.</p></div>
        <div className="panel"><h3>2 · Read and extract</h3><p>The leader fetches the page, keeps only that version&apos;s section and asks an LLM for a strict JSON verdict.</p></div>
        <div className="panel"><h3>3 · Validators agree</h3><p>Every validator repeats the extraction and compares: exact on version, mandatory, breaking and deadline; at least 80% overlap on config and env keys.</p></div>
        <div className="panel"><h3>4 · Alert</h3><p>WatchLayer reads the stored verdict and the Telegram bot alerts subscribers when a mandatory release is newer than the tracked version.</p></div>
      </div>
      <p className="small faint" style={{ marginTop: 16 }}>Contract source and tutorial: <a href={GUARD_REPO} target="_blank" rel="noopener noreferrer">{GUARD_REPO.replace("https://", "")}</a></p>
    </>
  );
}
