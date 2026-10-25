export type ValidatorStatus = "active" | "pending" | "banned" | "needs_priming";

/** Registered at staking time; normalized by normalizeIdentity (links are http(s) only, empty -> null). */
export interface Identity { moniker: string | null; logo: string | null; website: string | null; github: string | null }

/** From the Staking banned list (idleness/strike outcome). Strike counters themselves are not on-chain. */
export interface Ban { untilEpoch: bigint; permanent: boolean }

export interface PendingDeposit { epoch: bigint; stakeRaw: bigint }
export interface PendingWithdrawal { epoch: bigint; stakeRaw: bigint }

export interface ValidatorSnapshot {
  address: string;
  owner: string;
  operator: string;
  moniker: string | null;
  identity: Identity;
  vStakeRaw: bigint;
  dStakeRaw: bigint;
  pendingDeposits: PendingDeposit[];
  pendingWithdrawals: PendingWithdrawal[];
  banned: boolean;
  ban: Ban | null;
  needsPriming: boolean;
  active: boolean;
  operatorBalanceWei: bigint;
  operatorNonce: number;
}

export interface EpochSnapshot {
  currentEpoch: bigint;
  activeCount: number;
  nextEpochEstimate: Date | null;
  /** Transactions in blocks of the last hour; null if the scan failed. */
  txLastHour: number | null;
  /** Average seconds between blocks over the scanned hour; null if fewer than 2 blocks. */
  avgBlockSeconds?: number | null;
}

export interface ChainReader {
  getEpoch(): Promise<EpochSnapshot>;
  /** `epoch` is the snapshot's single epoch read: ban expiry must be evaluated against it, not a fresh read. */
  getValidators(epoch: bigint): Promise<ValidatorSnapshot[]>;
}
