// Read-only: fetches the latest verdict from a deployed ChangelogGuard and runs decide().
// Usage: CHANGELOG_GUARD_ADDRESS=0x... [COMPOSE_DIR=...] node read-verdict.mjs <network> <running-version> [--apply]
// No private key is used or needed. genlayer-js is imported lazily so tests run without it.
import { decide } from "./decide.mjs";
import { buildAlert } from "./alert.mjs";

/** genlayer-js may return dicts as Map and ints as bigint; make it plain JSON. */
export function toPlain(v) {
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, toPlain(x)]));
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "bigint") return Number(v);
  return v;
}

export async function readLatest(client, address, network) {
  const raw = await client.readContract({ address, functionName: "get_latest", args: [network] });
  return toPlain(raw);
}

export async function run({ client, address, network, running }) {
  const verdict = await readLatest(client, address, network);
  return { verdict, ...decide(running, verdict), alert: buildAlert(running, verdict) };
}

/**
 * Optional auto-upgrade: `docker compose pull && up -d`, only when decide() said "auto-upgrade"
 * (which decide() never says for a breaking verdict). Off unless the caller passes exec + composeDir.
 */
export async function applyUpgrade(decision, { exec, composeDir }) {
  if (decision.action !== "auto-upgrade" || decision.verdict?.breaking !== false) return { applied: false };
  if (!exec || !composeDir) return { applied: false };
  await exec("docker", ["compose", "pull"], { cwd: composeDir });
  await exec("docker", ["compose", "up", "-d"], { cwd: composeDir });
  return { applied: true };
}

async function main() {
  // --apply is opt-in; it also requires COMPOSE_DIR (the node's compose directory).
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [network, running] = args.filter((a) => a !== "--apply");
  const address = process.env.CHANGELOG_GUARD_ADDRESS;
  if (!network || !running || !address) {
    console.error("usage: CHANGELOG_GUARD_ADDRESS=0x... node read-verdict.mjs <network> <running-version>");
    process.exit(2);
  }
  const { createClient } = await import("genlayer-js");
  const { testnetBradbury } = await import("genlayer-js/chains");
  const out = await run({ client: createClient({ chain: testnetBradbury }), address, network, running });
  console.log(JSON.stringify(out, null, 2));
  if (apply) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    console.log(JSON.stringify(await applyUpgrade(out, { exec: promisify(execFile), composeDir: process.env.COMPOSE_DIR })));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
