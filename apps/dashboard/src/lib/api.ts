export type Status = "active" | "pending" | "banned" | "needs_priming";

export interface Network {
  epoch: string; nextEpochEstimate: number | null; snapshotAt: number;
  totalStake: string; txPerHour: number | null; avgBlockSeconds: number | null;
  rpc: { uptime24h: number | null; runs24h: number; lastSuccessAt: number | null; snapshotDurationMs: number | null; avgSnapshotDurationMs: number | null };
  validators: { total: number; active: number; pending: number; banned: number; needsPriming: number };
}
export interface Identity { moniker: string | null; logo: string | null; website: string | null; github: string | null }
export interface Validator {
  address: string; operator: string; moniker: string | null; identity: Identity; status: Status;
  vStake: string; dStake: string; pendingDeposits: { epoch: string; stakeRaw: string; activatesAtEpoch: string; stillPending: boolean }[];
  operatorBalanceWei: string; gasRunwayDays: number | null; pendingWithdrawals: { epoch: string; stakeRaw: string }[]; firstSeenAt: number | null;
  bans: { untilEpoch: string; permanent: boolean; firstSeenAt: number; lastSeenAt: number }[]; lastBannedAt: number | null;
  strikes: null; ban: { untilEpoch: string; permanent: boolean } | null; snapshotAt: number;
  activity: { lastTxAt: number | null; txLast24h: number; silentHours: number };
}
export interface ValidatorPoint { t: number; status: Status; vStake: string; dStake: string; operatorBalanceWei: string; operatorNonce: number }
export interface NetworkPoint { t: number; epoch: string; activeCount: number; txPerHour: number | null }

const BASE = process.env.API_URL ?? "http://127.0.0.1:20360";

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}
export const getNetwork = () => get<Network>("/network");
export const getValidators = () => get<Validator[]>("/validators");
export const getValidator = (a: string) => get<Validator>(`/validators/${a}`);
export const getValidatorHistory = (a: string) => get<ValidatorPoint[]>(`/validators/${a}/history`);
export const getNetworkHistory = () => get<NetworkPoint[]>("/network/history");

export interface ValidatorEpoch { epoch: string; t: number; status: Status; vStake: string; dStake: string; operatorBalanceWei: string; operatorNonce: number; operatorTx: number | null }
export interface NetworkEpoch { epoch: string; t: number; txPerHour: number | null; totalStake: string; validators: Network["validators"] }
export const getValidatorEpochs = (a: string) => get<ValidatorEpoch[]>(`/validators/${a}/epochs`);
export const getNetworkEpochs = () => get<NetworkEpoch[]>("/network/epochs");

export interface UpgradeVerdict {
  version: string; network: string; mandatory: boolean; breaking: boolean; deadline: string | null;
  config_changes: string[]; env_changes: string[]; actions: string[]; source_url: string; firstSeenAt: number;
}
export interface Upgrades { enabled: boolean; contract: string | null; network: string | null; latest: UpgradeVerdict | null; history: UpgradeVerdict[]; checkedAt: number | null; error: string | null }
export const getUpgrades = () => get<Upgrades>("/upgrades");
