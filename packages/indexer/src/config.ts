// Default polling cadence: 120 s after each pass (the public RPC rate-limits parallel reads).
export const DEFAULT_POLL_SECONDS = 120;

export function loadConfig(env: Record<string, string | undefined>) {
  return {
    rpcUrl: env.RPC_URL ?? "https://rpc.testnet-chain.genlayer.com",
    chainId: Number(env.CHAIN_ID ?? 4221),
    dbPath: env.DB_PATH ?? "./watchlayer.db",
    port: Number(env.PORT ?? 20360),
    retentionDays: Number(env.RETENTION_DAYS ?? 14),
    pollMs: Number(env.POLL_SECONDS ?? DEFAULT_POLL_SECONDS) * 1000,
  };
}
