import { createClient, chains } from "genlayer-js";
import { isBannedNow, normalizeIdentity } from "./derive.js";
import type { ChainReader, ValidatorSnapshot } from "./types.js";

// The public RPC rate-limits eth_call ("Rate Limit Exceeded"), so reads are low-concurrency with backoff.
const CONCURRENCY = 1;
async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

export interface HourScan { txCount: number | null; avgBlockSeconds: number | null }

/**
 * Walks blocks back over the last hour: user transactions and average block interval.
 * Bradbury is an Arbitrum Orbit chain: every block starts with one ArbitrumInternal (type 0x6a) system transaction,
 * which is not user throughput, so it is not counted.
 * With ~2 s blocks an hour is ~1,800 blocks; when the cap is hit first, the hourly rate is extrapolated from the
 * covered window if it spans at least MIN_WINDOW seconds, else it is null (unknown) rather than a silent undercount.
 */
const MIN_WINDOW = 300;
export async function scanLastHour(
  getBlock: (n: bigint) => Promise<{ timestamp: bigint; transactions: unknown[] }>,
  latest: bigint, now: number, maxBlocks = 600,
): Promise<HourScan> {
  let txCount = 0, blocks = 0, newest = 0, oldest = 0, complete = false;
  for (let i = 0n; i < BigInt(maxBlocks) && latest - i >= 0n; i++) {
    const b = await getBlock(latest - i);
    const ts = Number(b.timestamp);
    if (ts < now - 3600) { complete = true; break; }
    if (blocks === 0) newest = ts;
    oldest = ts; blocks++; txCount += Math.max(0, b.transactions.length - 1);
  }
  if (latest + 1n <= BigInt(blocks)) complete = true; // reached genesis
  const covered = now - oldest;
  const rate = complete ? txCount : blocks > 0 && covered >= MIN_WINDOW ? Math.round((txCount * 3600) / covered) : null;
  return { txCount: rate, avgBlockSeconds: blocks >= 2 ? (newest - oldest) / (blocks - 1) : null };
}

/** Reads every page of a (startIndex, size) paginated list; stops on a short page. */
export async function fetchAllPages<T>(fetchPage: (start: bigint, size: bigint) => Promise<T[]>, pageSize = 100n, maxPages = 1000): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(BigInt(i) * pageSize, pageSize);
    all.push(...page);
    if (BigInt(page.length) < pageSize) return all;
  }
  throw new Error(`paginated list exceeded ${maxPages} pages`);
}

// HTTP polling only: the Conduit WebSocket key is shared between validators and must not live here.
export function genlayerReader(rpcUrl: string, chainId = 4221): ChainReader {
  const base = chains.testnetBradbury;
  const client = createClient({
    chain: { ...base, id: chainId, rpcUrls: { default: { http: [rpcUrl] } } },
  });

  return {
    async getEpoch() {
      const e = await retry(() => client.getEpochInfo());
      return {
        currentEpoch: e.currentEpoch,
        activeCount: Number(e.activeValidatorsCount),
        nextEpochEstimate: e.nextEpochEstimate,
        ...(await retry(async () => scanLastHour(
          (n) => client.getBlock({ blockNumber: n, includeTransactions: false }) as never,
          await client.getBlockNumber(), Math.floor(Date.now() / 1000))).then(
            (h) => ({ txLastHour: h.txCount, avgBlockSeconds: h.avgBlockSeconds }),
            (err) => { console.error("block scan failed:", (err as Error).message); return { txLastHour: null, avgBlockSeconds: null }; })),
      };
    },
    async getValidators(epoch) {
      const [joined, active] = await Promise.all([retry(() => client.getJoinedValidators()), retry(() => client.getActiveValidators())]);
      const activeSet = new Set(active.map((a) => a.toLowerCase()));
      const bans = new Map((await fetchAllPages((start, size) => retry(() => client.getBannedValidators(start, size))))
        .map((b) => [b.validator.toLowerCase(), { untilEpoch: b.untilEpoch, permanent: b.permanentlyBanned }]));
      const read = async (addr: (typeof joined)[number]): Promise<ValidatorSnapshot> => {
        const v = await retry(() => client.getValidatorInfo(addr));
        const balance = await retry(() => client.getBalance({ address: v.operator }));
        const nonce = await retry(() => client.getTransactionCount({ address: v.operator }));
        const identity = normalizeIdentity(v.identity);
        const ban = bans.get(v.address.toLowerCase()) ?? null;
        return {
          address: v.address,
          owner: v.owner,
          operator: v.operator,
          moniker: identity.moniker,
          identity,
          vStakeRaw: v.vStakeRaw,
          dStakeRaw: v.dStakeRaw,
          pendingDeposits: v.pendingDeposits.map((d) => ({ epoch: d.epoch, stakeRaw: d.stakeRaw })),
          pendingWithdrawals: v.pendingWithdrawals.map((w) => ({ epoch: w.epoch, stakeRaw: w.stakeRaw })),
          banned: v.banned || isBannedNow(ban, epoch),
          ban,
          needsPriming: v.needsPriming,
          active: activeSet.has(v.address.toLowerCase()),
          operatorBalanceWei: balance,
          operatorNonce: nonce,
        };
      };
      const out: ValidatorSnapshot[] = [];
      for (let i = 0; i < joined.length; i += CONCURRENCY) out.push(...(await Promise.all(joined.slice(i, i + CONCURRENCY).map(read))));
      return out;
    },
  };
}
