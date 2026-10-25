export interface Validator {
  address: string; operator: string; moniker: string | null;
  status: "active" | "pending" | "banned" | "needs_priming";
  vStake: string; dStake: string;
  pendingDeposits: { epoch: string; stakeRaw: string; activatesAtEpoch: string; stillPending: boolean }[];
  operatorBalanceWei: string; gasRunwayDays: number | null; snapshotAt: number;
  ban: { untilEpoch: string; permanent: boolean } | null;
  activity: { lastTxAt: number | null; txLast24h: number; silentHours: number };
}

export async function fetchValidators(base: string): Promise<Validator[]> {
  const r = await fetch(`${base}/validators`);
  if (!r.ok) throw new Error(`indexer API ${r.status}`);
  return r.json() as Promise<Validator[]>;
}
