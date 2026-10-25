import type { DatabaseSync } from "node:sqlite";

/** A Changelog Guard verdict as stored on-chain by `submit` and returned by `get_latest(network)`. */
export interface Verdict {
  version: string; network: string; mandatory: boolean; breaking: boolean; deadline: string | null;
  config_changes: string[]; env_changes: string[]; actions: string[]; source_url: string;
}

export interface UpgradeState {
  enabled: boolean;
  contract: string | null;
  network: string;
  latest: (Verdict & { firstSeenAt: number }) | null;
  history: (Verdict & { firstSeenAt: number })[];
  checkedAt: number | null;
  error: string | null;
}

/** genlayer-js may return dicts as Map and ints as bigint; make it plain JSON (same as the consumer's toPlain). */
export function toPlain(v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, toPlain(x)]));
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** Accepts only a well-formed verdict; anything else is treated as "no verdict yet". */
export function parseVerdict(raw: unknown): Verdict | null {
  const v = toPlain(raw) as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.version !== "string" || !v.version) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return {
    version: v.version, network: String(v.network ?? ""), mandatory: v.mandatory === true, breaking: v.breaking === true,
    deadline: typeof v.deadline === "string" && v.deadline ? v.deadline : null,
    config_changes: list(v.config_changes), env_changes: list(v.env_changes), actions: list(v.actions),
    source_url: typeof v.source_url === "string" ? v.source_url : "",
  };
}

/**
 * Polls the Changelog Guard contract and remembers every distinct version it has published (first time seen).
 * Read-only: uses gen_call through a GenLayer RPC, no key.
 */
export function createUpgradeWatcher(db: DatabaseSync, opts: {
  contract: string | null; network: string; read: () => Promise<unknown>; clock?: () => number;
}) {
  const clock = opts.clock ?? (() => Math.floor(Date.now() / 1000));
  db.exec(`CREATE TABLE IF NOT EXISTS upgrade_verdicts (
    network TEXT NOT NULL, version TEXT NOT NULL, verdict TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (network, version))`);
  let checkedAt: number | null = null;
  let error: string | null = null;
  let current: string | null = null; // version get_latest returned on the last successful read

  const rows = () => (db.prepare("SELECT verdict, first_seen FROM upgrade_verdicts WHERE network = ? ORDER BY first_seen DESC, rowid DESC")
    .all(opts.network) as { verdict: string; first_seen: number }[])
    .map((r) => ({ ...(JSON.parse(r.verdict) as Verdict), firstSeenAt: r.first_seen }));

  async function check(): Promise<void> {
    if (!opts.contract) return;
    try {
      const v = parseVerdict(await opts.read());
      const now = clock();
      if (v) {
        const prev = db.prepare("SELECT verdict FROM upgrade_verdicts WHERE network = ? AND version = ?").get(opts.network, v.version) as { verdict: string } | undefined;
        if (!prev) db.prepare("INSERT INTO upgrade_verdicts (network, version, verdict, first_seen) VALUES (?, ?, ?, ?)").run(opts.network, v.version, JSON.stringify(v), now);
        else if (prev.verdict !== JSON.stringify(v)) db.prepare("UPDATE upgrade_verdicts SET verdict = ? WHERE network = ? AND version = ?").run(JSON.stringify(v), opts.network, v.version);
      }
      current = v?.version ?? null;
      checkedAt = now; error = null;
    } catch (e) {
      error = (e as Error).message.split("\n")[0].slice(0, 200);
    }
  }

  function state(): UpgradeState {
    const history = rows();
    // "latest" is what get_latest returned on the last read; before the first read, the most recently seen version.
    const latest = (current ? history.find((h) => h.version === current) : history[0]) ?? null;
    return { enabled: !!opts.contract, contract: opts.contract, network: opts.network, latest, history, checkedAt, error };
  }

  return { check, state };
}
