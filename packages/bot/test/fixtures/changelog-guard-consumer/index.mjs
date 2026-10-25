// Library entry for the Watchtower bot (project A): import these, do not shell out.
// The bot supplies its own genlayer-js client and the running node version; the
// Watchtower API (docs/WATCHTOWER_API.md) has no field for either, so nothing is read from it here.
export { decide, compareVersions } from "./decide.mjs";
export { readLatest, run, toPlain, applyUpgrade } from "./read-verdict.mjs";
export { buildAlert } from "./alert.mjs";
