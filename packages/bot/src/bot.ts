import { Bot, type Context } from "grammy";
import type { Store } from "./store.js";
import { fetchValidators } from "./api.js";
import { describeStatus } from "./alerts.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function createBot(token: string, store: Store, apiBase: string) {
  const bot = new Bot(token);
  const arg = (text: string | undefined) => (text ?? "").split(/\s+/)[1] ?? "";

  const HELP = "WatchLayer alerts.\n/watch 0xValidator — subscribe\n/unwatch 0xValidator\n/list\n/status 0xValidator";
  const watch = async (c: Context, a: string) => {
    if (!ADDR.test(a)) return c.reply("Usage: /watch 0x<validator wallet address>");
    const v = (await fetchValidators(apiBase)).find((x) => x.address.toLowerCase() === a.toLowerCase());
    if (!v) return c.reply("Unknown validator (not in the latest snapshot).");
    if (!c.chat) return;
    store.watch(c.chat.id, a);
    return c.reply(`Watching ${v.moniker ?? v.address}.\n\n${describeStatus(v)}`);
  };
  // t.me/<bot>?start=0x… (the dashboard's bell links) subscribes straight away.
  bot.command("start", (c) => (ADDR.test(String(c.match ?? "").trim()) ? watch(c, String(c.match).trim()) : c.reply(HELP)));
  bot.command("watch", (c) => watch(c, arg(c.message?.text)));
  bot.command("unwatch", (c) => {
    const a = arg(c.message?.text);
    return c.reply(ADDR.test(a) && store.unwatch(c.chat.id, a) ? "Stopped watching." : "Not watching that address.");
  });
  bot.command("list", (c) => c.reply(store.list(c.chat.id).join("\n") || "No subscriptions."));
  bot.command("status", async (c) => {
    const a = arg(c.message?.text);
    if (!ADDR.test(a)) return c.reply("Usage: /status 0x<validator wallet address>");
    const v = (await fetchValidators(apiBase)).find((x) => x.address.toLowerCase() === a.toLowerCase());
    return c.reply(v ? describeStatus(v) : "Unknown validator.");
  });
  bot.catch((e) => console.error("bot error:", e.message));
  return bot;
}
