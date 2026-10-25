import type { Status, Validator } from "./api.js";

const ORDER: Record<Status, number> = { banned: 0, needs_priming: 1, pending: 2, active: 3 };

/** Problems first, then by gas runway ascending (unknown last), then by moniker. */
export function sortValidators(vs: Validator[]): Validator[] {
  return [...vs].sort((a, b) =>
    ORDER[a.status] - ORDER[b.status] ||
    (a.gasRunwayDays ?? Infinity) - (b.gasRunwayDays ?? Infinity) ||
    (a.moniker ?? a.address).localeCompare(b.moniker ?? b.address));
}

export function filterValidators(vs: Validator[], status?: string): Validator[] {
  return status ? vs.filter((v) => v.status === status) : vs;
}
