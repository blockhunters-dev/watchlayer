import type { Identity, ValidatorSnapshot, ValidatorStatus } from "./types.js";

export function validatorStatus(v: Pick<ValidatorSnapshot, "banned" | "needsPriming" | "active">): ValidatorStatus {
  if (v.banned) return "banned";
  if (v.needsPriming) return "needs_priming";
  return v.active ? "active" : "pending";
}

export interface BalanceSample { t: number; wei: bigint } // t in unix seconds, ascending

/**
 * Days until the operator runs out of gas at the recent burn rate.
 * Only balance decreases count as consumption, so a top-up does not hide the burn.
 * Returns null when there is no measurable burn (not enough samples, or flat/rising balance).
 */
export function runwayDays(samples: BalanceSample[]): number | null {
  if (samples.length < 2) return null;
  let burned = 0n;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i - 1].wei - samples[i].wei;
    if (d > 0n) burned += d;
  }
  const elapsed = samples[samples.length - 1].t - samples[0].t;
  if (burned === 0n || elapsed <= 0) return null;
  const perSecond = Number(burned) / elapsed;
  return Number(samples[samples.length - 1].wei) / perSecond / 86400;
}

export interface Activity {
  /** Snapshot time at which the operator nonce was first seen to increase; null if never seen. */
  lastTxAt: number | null;
  /** Operator transactions observed in the last 24h (nonce delta). */
  txLast24h: number;
  /** Time the operator has been observed without sending, in hours (since last tx, or since first snapshot). */
  silentHours: number;
}

export function operatorActivity(samples: { t: number; nonce: number }[], now: number): Activity {
  let lastTxAt: number | null = null;
  for (let i = 1; i < samples.length; i++) if (samples[i].nonce > samples[i - 1].nonce) lastTxAt = samples[i].t;
  const recent = samples.filter((s) => s.t >= now - 86400);
  const txLast24h = recent.length ? Math.max(0, recent[recent.length - 1].nonce - recent[0].nonce) : 0;
  const since = lastTxAt ?? samples[0]?.t ?? now;
  return { lastTxAt, txLast24h, silentHours: Math.max(0, (now - since) / 3600) };
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 300) : "");

/** Only absolute http(s) URLs pass; ipfs://<cid>[/path] becomes a public gateway URL. Anything else -> null. */
export function safeUrl(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  const ipfs = s.match(/^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]+(?:\/[\w.\-\/]*)?)$/);
  if (ipfs) return `https://ipfs.io/ipfs/${ipfs[1]}`;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}

/** GitHub field may be a profile URL or a bare handle ("@name" or "name"). */
export function githubUrl(raw: unknown): string | null {
  const s = clean(raw);
  const handle = s.replace(/^@/, "");
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle)) return `https://github.com/${handle}`;
  return safeUrl(s);
}

export function normalizeIdentity(raw: { moniker?: unknown; logoUri?: unknown; website?: unknown; github?: unknown } | undefined): Identity {
  return {
    moniker: clean(raw?.moniker).slice(0, 80) || null,
    logo: safeUrl(raw?.logoUri),
    website: safeUrl(raw?.website),
    github: githubUrl(raw?.github),
  };
}

/**
 * Deposits activate this many epochs after the deposit epoch. Observed on Phase 2 (our deposit in epoch 2 is
 * active from epoch 4; validators with epoch-0 deposits are active at epoch 2) and matches the Staking contract behaviour.
 * Not read from the contract: revisit if the protocol changes.
 */
export const DEPOSIT_ACTIVATION_DELAY_EPOCHS = 2n;

export function depositActivation(depositEpoch: bigint, currentEpoch: bigint) {
  const activatesAtEpoch = depositEpoch + DEPOSIT_ACTIVATION_DELAY_EPOCHS;
  return { activatesAtEpoch, stillPending: activatesAtEpoch > currentEpoch };
}

/** A validator is banned now if it is on the banned list and the ban has not expired (or is permanent). */
export function isBannedNow(ban: { untilEpoch: bigint; permanent: boolean } | null, currentEpoch: bigint): boolean {
  return ban !== null && (ban.permanent || ban.untilEpoch > currentEpoch);
}
