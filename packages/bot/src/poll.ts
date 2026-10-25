import type { Store } from "./store.js";
import { fetchValidators } from "./api.js";
import { evaluateAlerts } from "./alerts.js";

// Telegram will never deliver to these chats again: bot blocked/kicked (403) or chat gone (400).
function isPermanentSendError(e: unknown): boolean {
  const err = e as { error_code?: number; description?: string };
  return err.error_code === 403 || (err.error_code === 400 && /chat not found|user is deactivated/i.test(err.description ?? ""));
}

export async function checkAlerts(store: Store, apiBase: string, send: (chat: number, text: string) => Promise<unknown>, silentHours?: number) {
  const byAddr = new Map((await fetchValidators(apiBase)).map((v) => [v.address.toLowerCase(), v]));
  const dead = new Set<number>();
  for (const sub of store.all()) {
    if (dead.has(sub.chat)) continue;
    const v = byAddr.get(sub.address);
    if (!v) continue;
    const { alerts, next } = evaluateAlerts(v, sub.state, silentHours);
    try {
      for (const text of alerts) await send(sub.chat, text);
      // Persist state only after sending, so a transient failure is retried on the next run.
      store.saveState(sub.chat, sub.address, next);
    } catch (e) {
      // One failing chat must not stop alerts for everyone else.
      if (isPermanentSendError(e)) { dead.add(sub.chat); store.dropChat(sub.chat); }
      else console.error(`alert send failed for chat ${sub.chat}:`, (e as Error).message);
    }
  }
}
