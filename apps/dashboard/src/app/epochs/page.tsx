import type { Metadata } from "next";
import { getNetwork, getNetworkEpochs } from "../../lib/api";
import { gen, relTime } from "../../lib/format";
import { genNum } from "../../lib/stats";
import { LineChart, PageHead, SectionHead, Stat } from "../components";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Epochs" };

export default async function Epochs() {
  const [net, epochs] = await Promise.all([getNetwork(), getNetworkEpochs()]);
  const now = Math.floor(Date.now() / 1000);
  const ep = epochs ?? [];
  return (
    <>
      <PageHead title="Epochs" lead="Network state at the last snapshot of each epoch: stake, validator counts and throughput." />
      {net ? (
        <section className="stats">
          <Stat label="Current epoch" value={net.epoch} sub={net.nextEpochEstimate ? `next ${relTime(net.nextEpochEstimate, now)}` : undefined} />
          <Stat label="Epochs recorded" value={ep.length} />
          <Stat label="Total stake now" value={gen(net.totalStake)} />
        </section>
      ) : null}

      <SectionHead idx="01" title="Charts" />
      <div className="grid2">
        <div className="card"><h3>Total stake</h3><p className="sub">GEN per epoch.</p>
          <LineChart label="Total stake per epoch" points={ep.map((e) => ({ x: `E${e.epoch}`, y: genNum(e.totalStake) }))} /></div>
        <div className="card"><h3>Active validators</h3><p className="sub">Count at the end of each epoch.</p>
          <LineChart label="Active validators per epoch" fmt={(n) => n.toFixed(0)} points={ep.map((e) => ({ x: `E${e.epoch}`, y: e.validators.active }))} /></div>
      </div>

      <SectionHead idx="02" title="Network by epoch" />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Epoch</th><th className="num">Active</th><th className="num hide-m">Pending</th><th className="num hide-m">Banned</th><th className="num">Total stake</th><th className="num hide-m">Tx / hour</th></tr></thead>
          <tbody>
            {[...ep].reverse().map((e) => (
              <tr key={e.epoch}>
                <td>{e.epoch}</td><td className="num">{e.validators.active}</td>
                <td className="num hide-m">{e.validators.pending}</td><td className="num hide-m">{e.validators.banned}</td>
                <td className="num">{gen(e.totalStake)}</td><td className="num hide-m">{e.txPerHour ?? "—"}</td>
              </tr>
            ))}
            {!ep.length ? <tr><td colSpan={6} className="empty">No epoch data yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
