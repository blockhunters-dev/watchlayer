// Pure decision logic for the operator-side consumer. No network, no docker.
// verdict: object returned by ChangelogGuard.get_latest(network) ({} if none).

const key = (v) => {
  const [core, pre] = String(v).trim().toLowerCase().replace(/^v/, "").split(/-(.+)/);
  const nums = (core.match(/\d+/g) || ["0"]).map(Number);
  return { nums, rank: pre ? 0 : 1, pre: (pre?.match(/\d+/g) || []).map(Number) };
};

export const compareVersions = (a, b) => {
  const x = key(a), y = key(b);
  const seqs = [[x.nums, y.nums], [[x.rank], [y.rank]], [x.pre, y.pre]];
  for (const [p, q] of seqs) {
    for (let i = 0; i < Math.max(p.length, q.length); i++) {
      const d = (p[i] ?? 0) - (q[i] ?? 0);
      if (d) return Math.sign(d);
    }
  }
  return 0;
};

/** @returns {{action: "none"|"alert"|"auto-upgrade"|"hold", reason: string}} */
export function decide(running, verdict, now = new Date()) {
  if (!verdict || !verdict.version) return { action: "none", reason: "no verdict on chain" };
  if (compareVersions(verdict.version, running) <= 0) return { action: "none", reason: "up to date" };
  if (verdict.breaking) return { action: "hold", reason: "breaking: manual upgrade, auto-upgrade blocked" };
  if (verdict.mandatory || (verdict.deadline && new Date(verdict.deadline) > now))
    return { action: "auto-upgrade", reason: "non-breaking upgrade available" };
  return { action: "alert", reason: "optional upgrade available" };
}
