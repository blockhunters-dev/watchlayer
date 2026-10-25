import type { Validator } from "./api.js";
import { gen } from "./format.js";

// What we remember per (chat, validator) so the same condition is not re-announced every poll.
export interface AlertState {
  status?: Validator["status"];
  runwayLevel?: 0 | 3 | 1; // 0 = fine, 3 = below 3 days notified, 1 = below 1 day notified
  silent?: boolean; // operator-silent alert already sent for the current silence
}

export const DEFAULT_SILENT_HOURS = 6;

const name = (v: Validator) => v.moniker ?? v.address;
const banText = (v: Validator) => (v.ban ? (v.ban.permanent ? "permanently" : `until epoch ${v.ban.untilEpoch}`) : "");

/**
 * Edge-triggered alerts: fire when a condition starts, stay quiet while it persists,
 * re-arm when it clears. The first observation only records state (no alert storm on /watch).
 */
export function evaluateAlerts(v: Validator, prev: AlertState | undefined, silentHours = DEFAULT_SILENT_HOURS): { alerts: string[]; next: AlertState } {
  const alerts: string[] = [];
  const next: AlertState = { status: v.status, runwayLevel: prev?.runwayLevel ?? 0, silent: false };

  const level: 0 | 3 | 1 = v.gasRunwayDays === null ? (prev?.runwayLevel ?? 0) : v.gasRunwayDays < 1 ? 1 : v.gasRunwayDays < 3 ? 3 : 0;
  if (v.gasRunwayDays !== null) {
    if (level === 1 && prev?.runwayLevel !== 1) alerts.push(`⛽ ${name(v)}: operator gas runway under 1 day (${v.gasRunwayDays.toFixed(1)}d, ${gen(v.operatorBalanceWei)}). Top up now.`);
    else if (level === 3 && (prev?.runwayLevel ?? 0) === 0) alerts.push(`⛽ ${name(v)}: operator gas runway under 3 days (${v.gasRunwayDays.toFixed(1)}d, ${gen(v.operatorBalanceWei)}).`);
    next.runwayLevel = level;
  }

  // Only an active validator is expected to transact; a silent operator usually means a stopped node.
  const silent = v.status === "active" && v.activity.silentHours >= silentHours;
  if (silent && !prev?.silent) alerts.push(`🔇 ${name(v)}: operator has sent no transaction for ${Math.floor(v.activity.silentHours)} h (node may be down).`);
  next.silent = silent;

  if (prev?.status) {
    if (v.status === "banned" && prev.status !== "banned") alerts.push(`🚫 ${name(v)} is banned ${banText(v)}`.trim() + ". Strike counts are not on-chain; check that the node is up and primed.");
    if (prev.status === "banned" && v.status !== "banned") alerts.push(`🟢 ${name(v)}: ban ended, now ${v.status}.`);
    if (v.status === "needs_priming" && prev.status !== "needs_priming") alerts.push(`🔧 ${name(v)} needs priming.`);
    if (v.status === "active" && prev.status === "pending") alerts.push(`✅ ${name(v)}: pending stake is now active (${gen(v.vStake)}).`);
  }
  return { alerts, next };
}

export function describeStatus(v: Validator): string {
  // The contract keeps activated deposits in the list; only stillPending ones are waiting (docs/API.md).
  const pending = v.pendingDeposits.filter((d) => d.stillPending)
    .map((d) => `${gen(d.stakeRaw)} (active from epoch ${d.activatesAtEpoch})`).join(", ") || "none";
  return [
    `${name(v)} — ${v.status}`,
    `Stake: self ${gen(v.vStake)}, delegated ${gen(v.dStake)}, pending ${pending}`,
    `Operator gas: ${gen(v.operatorBalanceWei)}, runway ${v.gasRunwayDays === null ? "unknown" : v.gasRunwayDays.toFixed(1) + " days"}`,
    `Operator activity: ${v.activity.txLast24h} tx in 24 h, silent ${v.activity.silentHours.toFixed(1)} h`,
    v.ban ? `Ban: ${banText(v)}` : "Ban: none",
    "Strikes: counter not exposed on-chain",
  ].join("\n");
}
