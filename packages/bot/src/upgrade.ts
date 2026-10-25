import { pathToFileURL } from "node:url";
import type { Store } from "./store.js";

/** The alert object produced by Changelog Guard's consumer `buildAlert` (consumer/alert.mjs). */
export interface UpgradeAlert {
  kind: "mandatory-upgrade"; severity: "critical" | "warning"; version: string; running: string;
  breaking: boolean; overdue: boolean; deadline: string | null; text: string;
}

/** The parts of C's consumer library (consumer/index.mjs) the bot uses. `applyUpgrade` is deliberately not used. */
export interface Consumer {
  readLatest(client: unknown, address: string, network: string): Promise<unknown>;
  buildAlert(running: string, verdict: unknown, now?: Date): UpgradeAlert | null;
}

export interface UpgradeDeps {
  consumer: Consumer;
  client: unknown;      // read-only genlayer-js client (no key)
  address: string;      // deployed ChangelogGuard address
  network: string;      // e.g. "bradbury-phase2"
  running: string;      // node version the operator is running
}

/** Loads C's consumer library from a file path (it is not published as a package). */
export async function loadConsumer(path: string): Promise<Consumer> {
  const m = (await import(pathToFileURL(path).href)) as Partial<Consumer>;
  if (typeof m.readLatest !== "function" || typeof m.buildAlert !== "function") throw new Error(`${path} does not export readLatest/buildAlert`);
  return { readLatest: m.readLatest, buildAlert: m.buildAlert };
}

const MAX_TEXT = 3500; // Telegram messages are limited to 4096 characters
const isHttp = (u: unknown) => { try { return typeof u === "string" && /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

/**
 * The alert comes from an external library and chain data, so it is checked before it is stored or broadcast:
 * version shape, known severity, string text capped for Telegram, and no non-http(s) source link.
 */
export function validateAlert(raw: unknown): UpgradeAlert | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.version !== "string" || !/^[A-Za-z0-9][\w.+-]{0,63}$/.test(a.version)) return null;
  if (a.severity !== "critical" && a.severity !== "warning") return null;
  if (typeof a.text !== "string" || a.text.length === 0) return null;
  const sourceOk = a.source_url == null || isHttp(a.source_url);
  const lines = a.text.split("\n").filter((l) => sourceOk || !/^source:/i.test(l));
  let text = lines.join("\n");
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1) + "…";
  return { ...(a as unknown as UpgradeAlert), version: a.version, severity: a.severity, text };
}

export const upgradeMessage = (a: UpgradeAlert) => `${a.severity === "critical" ? "🚨" : "⬆️"} ${a.text}`;

/**
 * Reads the on-chain verdict through C's consumer and sends its alert once per chat per (version, severity),
 * so going overdue/breaking re-alerts once. Progress is per chat: failed sends are retried next run without
 * duplicating to chats that already got it, and one bad chat never blocks the rest.
 */
export async function checkUpgrade(
  store: Store, deps: UpgradeDeps, send: (chat: number, text: string) => Promise<unknown>, now = new Date(),
) {
  const verdict = await deps.consumer.readLatest(deps.client, deps.address, deps.network);
  const built = deps.consumer.buildAlert(deps.running, verdict, now);
  if (!built) return;
  const alert = validateAlert(built);
  if (!alert) throw new Error("consumer returned a malformed upgrade alert; not sent");
  const text = upgradeMessage(alert);
  const stamp = `${alert.version}:${alert.severity}`;
  for (const chat of store.chats()) {
    const key = `upgrade:${chat}`;
    if (store.getMeta(key) === stamp) continue;
    try {
      await send(chat, text);
      store.setMeta(key, stamp);
    } catch (e) {
      const err = e as { error_code?: number; message?: string };
      if (err.error_code === 403) store.dropChat(chat);
      else console.error(`upgrade alert failed for chat ${chat}:`, err.message);
    }
  }
}
