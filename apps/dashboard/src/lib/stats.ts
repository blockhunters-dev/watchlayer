import type { Validator } from "./api";

export const stakeOf = (v: Validator) => BigInt(v.vStake) + BigInt(v.dStake);
/** Wei -> GEN as a float, for charts and shares only (display amounts use format.gen). */
export const genNum = (wei: string | bigint) => Number(BigInt(wei) / 10n ** 14n) / 1e4;

/** Stake share of each validator against the summed stake of the list (0..1). */
export function shares(vs: Validator[]): Map<string, number> {
  const total = vs.reduce((a, v) => a + stakeOf(v), 0n);
  const m = new Map<string, number>();
  for (const v of vs) m.set(v.address, total === 0n ? 0 : Number((stakeOf(v) * 1_000_000n) / total) / 1_000_000);
  return m;
}

/** Smallest number of active validators whose stake exceeds the given fraction (1/3 = can halt consensus). */
export function nakamoto(vs: Validator[], fraction = 1 / 3): number {
  const act = vs.filter((v) => v.status === "active").map(stakeOf).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  const total = act.reduce((a, s) => a + s, 0n);
  if (total === 0n) return 0;
  const need = (total * BigInt(Math.round(fraction * 1e6))) / 1_000_000n;
  let acc = 0n;
  for (let i = 0; i < act.length; i++) { acc += act[i]; if (acc > need) return i + 1; }
  return act.length;
}

/** Share of active stake held by the top n active validators (0..1). */
export function topShare(vs: Validator[], n: number): number {
  const act = vs.filter((v) => v.status === "active").map(stakeOf).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  const total = act.reduce((a, s) => a + s, 0n);
  if (total === 0n) return 0;
  return Number((act.slice(0, n).reduce((a, s) => a + s, 0n) * 1_000_000n) / total) / 1_000_000;
}

export interface BanRow { v: Validator; untilEpoch: string; permanent: boolean; firstSeenAt: number; lastSeenAt: number; ongoing: boolean }

/** Every observed ban window across validators, newest activity first. */
export function banRows(vs: Validator[]): BanRow[] {
  const rows: BanRow[] = [];
  for (const v of vs) for (const b of v.bans) {
    const ongoing = v.status === "banned" && !!v.ban && v.ban.untilEpoch === b.untilEpoch && v.ban.permanent === b.permanent;
    rows.push({ v, ...b, ongoing });
  }
  return rows.sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || b.lastSeenAt - a.lastSeenAt);
}

export const SORTS = ["default", "stake", "name", "runway"] as const;
export type SortKey = (typeof SORTS)[number];

export function searchValidators(vs: Validator[], q?: string): Validator[] {
  const s = (q ?? "").trim().toLowerCase();
  if (!s) return vs;
  return vs.filter((v) => (v.moniker ?? "").toLowerCase().includes(s) || v.address.toLowerCase().includes(s) || v.operator.toLowerCase().includes(s));
}

export function sortBy(vs: Validator[], key: SortKey, base: (vs: Validator[]) => Validator[]): Validator[] {
  if (key === "stake") return [...vs].sort((a, b) => { const d = stakeOf(b) - stakeOf(a); return d > 0n ? 1 : d < 0n ? -1 : 0; });
  if (key === "name") return [...vs].sort((a, b) => (a.moniker ?? a.address).localeCompare(b.moniker ?? b.address));
  if (key === "runway") return [...vs].sort((a, b) => (a.gasRunwayDays ?? Infinity) - (b.gasRunwayDays ?? Infinity));
  return base(vs);
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

/** Compact GEN for chart axes: 6.8M, 125.3K, 950. */
export function compact(n: number): string {
  const a = Math.abs(n);
  return a >= 1e6 ? `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : n.toFixed(a >= 100 ? 0 : 1);
}
