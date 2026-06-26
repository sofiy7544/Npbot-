/**
 * In-memory store of order drafts.
 * Key = `<chatId>:<messageId>` of the bot's preview reply.
 * Auto-expires after DRAFT_TTL_MS to prevent memory leak.
 */
import type { OrderDraft } from "./parser.js";

const TTL_MS = parseInt(process.env.DRAFT_TTL_MS ?? "600000", 10);

type Entry = {
  draft: OrderDraft;
  sourceChatId: number;
  sourceMessageId: number;   // original user message
  authorId: number;           // who sent the order
  authorName: string;
  createdAt: number;
};

const store = new Map<string, Entry>();

export function saveDraft(key: string, entry: Omit<Entry, "createdAt">) {
  store.set(key, { ...entry, createdAt: Date.now() });
  cleanup();
}

export function getDraft(key: string): Entry | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return e;
}

export function deleteDraft(key: string) {
  store.delete(key);
}

export function size(): number {
  return store.size;
}

function cleanup() {
  const now = Date.now();
  if (store.size < 50) return; // skip when small
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

export function makeKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}
