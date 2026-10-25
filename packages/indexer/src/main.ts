import { genlayerReader } from "./chain.js";
import { runCollection } from "./collect.js";
import { openDb, pruneSnapshots } from "./db.js";
import { createApi } from "./api.js";
import { startPolling } from "./poll.js";
import { loadConfig } from "./config.js";

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
createApi(db).listen(cfg.port, "0.0.0.0", () => console.log(`api on :${cfg.port}`));
