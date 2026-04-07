/**
 * Sync session checkpoints from `.memory/conversations/*.json` (Layer 1 host files).
 */
import fs from "fs";
import path from "path";
import type { SessionApi } from "./session.js";
import type { Checkpoint, ConversationMessage, ResolvedConfig } from "./types.js";

/** Anything with `config` + `session` (e.g. return value of `createMemory()`). */
export type SyncCheckpointsMemory = {
  config: ResolvedConfig;
  session: SessionApi;
};

export interface SyncCheckpointsOptions {
  /** If true, write checkpoints even when existing checkpoint is newer or same. */
  force?: boolean;
}

export interface SyncCheckpointsResult {
  synced: string[];
  skipped: string[];
  errors: Array<{ agentId: string; error: string }>;
}

function checkpointFile(configDir: string, agentId: string): string {
  return path.join(configDir, ".vault", "checkpoints", `${agentId}.json`);
}

function conversationSavedAtMs(data: Record<string, unknown>, filePath: string): number {
  const s = data.savedAt;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
  }
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeMessages(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (o.internal === true) continue;
    const role = o.role;
    const text = o.text;
    if (role !== "user" && role !== "agent") continue;
    if (typeof text !== "string") continue;
    const msg: ConversationMessage = { role, text };
    if (Array.isArray(o.targetAgentIds)) {
      const ids = o.targetAgentIds.filter((x): x is string => typeof x === "string");
      if (ids.length) msg.targetAgentIds = ids;
    }
    if (Array.isArray(o.diffs)) msg.diffs = o.diffs as ConversationMessage["diffs"];
    out.push(msg);
  }
  return out;
}

/**
 * For each `conversations/<agentId>.json`, update `.vault/checkpoints/<agentId>.json`
 * when the conversation file is newer than the checkpoint (or checkpoint missing), unless `force`.
 */
export async function syncCheckpointsFromConversations(
  mem: SyncCheckpointsMemory,
  options?: SyncCheckpointsOptions,
): Promise<SyncCheckpointsResult> {
  const convDir = path.join(mem.config.dir, "conversations");
  const synced: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ agentId: string; error: string }> = [];

  if (!fs.existsSync(convDir)) {
    return { synced, skipped, errors };
  }

  for (const file of fs.readdirSync(convDir)) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const filePath = path.join(convDir, file);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
      errors.push({ agentId: file.replace(/\.json$/i, ""), error: "invalid JSON" });
      continue;
    }

    const agentId =
      typeof data.agentId === "string" && data.agentId.length > 0
        ? data.agentId
        : file.replace(/\.json$/i, "");
    const messages = normalizeMessages(data.messages);
    const convMs = conversationSavedAtMs(data, filePath);

    const cpPath = checkpointFile(mem.config.dir, agentId);
    if (!options?.force && fs.existsSync(cpPath)) {
      try {
        const cp = JSON.parse(fs.readFileSync(cpPath, "utf-8")) as Checkpoint;
        if (typeof cp.savedAt === "number" && cp.savedAt >= convMs) {
          skipped.push(agentId);
          continue;
        }
      } catch {
        // Corrupt checkpoint: overwrite
      }
    }

    try {
      const chatId = typeof data.chatId === "string" ? data.chatId : undefined;
      const modelId = typeof data.modelId === "string" ? data.modelId : undefined;
      await mem.session.checkpoint(agentId, messages, chatId, modelId);
      synced.push(agentId);
    } catch (e) {
      errors.push({
        agentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { synced, skipped, errors };
}
