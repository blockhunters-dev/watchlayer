import { DatabaseSync } from "node:sqlite";
import type { AlertState } from "./alerts.js";

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS subs (chat_id INTEGER NOT NULL, address TEXT NOT NULL, state TEXT, PRIMARY KEY (chat_id, address))`);
  db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  const key = (a: string) => a.toLowerCase();
  return {
    watch: (chat: number, addr: string) => void db.prepare("INSERT OR IGNORE INTO subs (chat_id, address) VALUES (?,?)").run(chat, key(addr)),
    unwatch: (chat: number, addr: string) => Number(db.prepare("DELETE FROM subs WHERE chat_id=? AND address=?").run(chat, key(addr)).changes) > 0,
    list: (chat: number) => db.prepare("SELECT address FROM subs WHERE chat_id=?").all(chat).map((r) => r.address as string),
    all: () => db.prepare("SELECT chat_id, address, state FROM subs").all().map((r) => ({
      chat: Number(r.chat_id), address: r.address as string, state: r.state ? (JSON.parse(r.state as string) as AlertState) : undefined })),
    chats: () => db.prepare("SELECT DISTINCT chat_id FROM subs").all().map((r) => Number(r.chat_id)),
    getMeta: (k: string) => (db.prepare("SELECT v FROM meta WHERE k=?").get(k)?.v as string | undefined),
    setMeta: (k: string, v: string) => void db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v),
    dropChat: (chat: number) => void db.prepare("DELETE FROM subs WHERE chat_id=?").run(chat),
    saveState: (chat: number, addr: string, s: AlertState) => void db.prepare("UPDATE subs SET state=? WHERE chat_id=? AND address=?").run(JSON.stringify(s), chat, key(addr)),
  };
}
export type Store = ReturnType<typeof openStore>;
