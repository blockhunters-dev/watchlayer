import { openStore } from "./store.js";
import { createBot } from "./bot.js";
import { checkAlerts } from "./poll.js";
import { checkUpgrade, loadConsumer, type UpgradeDeps } from "./upgrade.js";

const env = process.env;
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Put it in .env (see .env.example); never commit it.");
  process.exit(1);
}
const api = env.API_URL ?? "http://127.0.0.1:20360";
const store = openStore(env.BOT_DB_PATH ?? "./bot.db");
const bot = createBot(token, store, api);

// Mandatory-upgrade alerts come from Changelog Guard via its consumer library; all four settings are needed.
let upgrade: UpgradeDeps | undefined;
// The consumer is vendored (same files as the pinned test fixture); CHANGELOG_GUARD_CONSUMER may point elsewhere.
const vendored = new URL("../test/fixtures/changelog-guard-consumer/index.mjs", import.meta.url).pathname;
const guard = { path: env.CHANGELOG_GUARD_CONSUMER || vendored, address: env.CHANGELOG_GUARD_ADDRESS, running: env.NODE_VERSION };
if (guard.path && guard.address && guard.running) {
  const { createClient, chains } = await import("genlayer-js");
  const rpc = env.GENLAYER_RPC_URL ?? "https://rpc-bradbury.genlayer.com"; // gen_call needs a GenLayer node RPC
  upgrade = {
    consumer: await loadConsumer(guard.path),
    client: createClient({ chain: { ...chains.testnetBradbury, id: Number(env.CHAIN_ID ?? 4221), rpcUrls: { default: { http: [rpc] } } } }),
    address: guard.address, network: env.CHANGELOG_GUARD_NETWORK ?? "bradbury-phase2", running: guard.running,
  };
} else console.log("mandatory-upgrade alerts disabled (set CHANGELOG_GUARD_CONSUMER, CHANGELOG_GUARD_ADDRESS, NODE_VERSION)");

// Sequential loop: next check starts after the previous finished.
const loop = async () => {
  try { await checkAlerts(store, api, (chat, text) => bot.api.sendMessage(chat, text), Number(env.SILENT_HOURS ?? 6)); }
  catch (e) { console.error("alert check failed:", (e as Error).message); }
  if (upgrade) {
    try { await checkUpgrade(store, upgrade, (chat, text) => bot.api.sendMessage(chat, text)); }
    catch (e) { console.error("upgrade check failed:", (e as Error).message); }
  }
  setTimeout(loop, Number(env.ALERT_CHECK_SECONDS ?? 120) * 1000);
};
void loop();
bot.start({ onStart: (me) => console.log(`bot @${me.username} started`) });
