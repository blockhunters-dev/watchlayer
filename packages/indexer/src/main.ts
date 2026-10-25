import { genlayerReader } from "./chain.js";
import { runCollection } from "./collect.js";
import { openDb, pruneSnapshots } from "./db.js";
import { createApi } from "./api.js";
import { startPolling } from "./poll.js";
import { loadConfig } from "./config.js";
import { createUpgradeWatcher } from "./upgrades.js";
import { createClient, chains } from "genlayer-js";

const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);
const reader = genlayerReader(cfg.rpcUrl, cfg.chainId);

const tick = () => runCollection(db, reader).then(
  (r) => {
    const pruned = pruneSnapshots(db, Math.floor(Date.now() / 1000), cfg.retentionDays);
    console.log("snapshot", r, pruned ? `pruned ${pruned} rows` : "");
  },
  (e) => console.error("collect failed:", e.message));
// Sequential: next run starts pollMs after the previous one finishes.
startPolling(tick, cfg.pollMs);
// Changelog Guard verdicts: read-only gen_call through a GenLayer node RPC, checked on its own slower cadence.
const glClient = createClient({ chain: { ...chains.testnetBradbury, id: cfg.chainId, rpcUrls: { default: { http: [cfg.genlayerRpcUrl] } } } });
const upgrades = createUpgradeWatcher(db, {
  contract: cfg.guardAddress, network: cfg.guardNetwork,
  read: () => glClient.readContract({ address: cfg.guardAddress as `0x${string}`, functionName: "get_latest", args: [cfg.guardNetwork] }),
});
if (cfg.guardAddress) startPolling(() => upgrades.check(), cfg.upgradeCheckMs);
else console.log("upgrades page disabled (set CHANGELOG_GUARD_ADDRESS)");
createApi(db, undefined, upgrades.state).listen(cfg.port, "0.0.0.0", () => console.log(`api on :${cfg.port}`));
