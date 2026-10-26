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
    // Changelog Guard (mandatory node upgrades). gen_call reads need a GenLayer node RPC, not the EVM-only RPC_URL.
    genlayerRpcUrl: env.GENLAYER_RPC_URL ?? "https://rpc-bradbury.genlayer.com",
    guardAddress: env.CHANGELOG_GUARD_ADDRESS || null,
    guardNetwork: env.CHANGELOG_GUARD_NETWORK ?? "bradbury-phase2",
    upgradeCheckMs: Number(env.UPGRADE_CHECK_SECONDS ?? 600) * 1000,
  };
}
