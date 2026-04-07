import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createMemory } from "../src/index.js";
import { syncCheckpointsFromConversations } from "../src/sync-checkpoints.js";
import type { Checkpoint } from "../src/types.js";

describe("syncCheckpointsFromConversations", () => {
  it("returns empty when conversations dir missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-sync-"));
    const mem = createMemory({ dir });
    const r = await syncCheckpointsFromConversations(mem);
    expect(r.synced).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("writes checkpoint when missing and skips when checkpoint is newer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-sync-"));
    const convDir = path.join(dir, "conversations");
    fs.mkdirSync(convDir, { recursive: true });
    const t0 = Date.now() - 60_000;
    const payload = {
      agentId: "agent-a",
      savedAt: new Date(t0).toISOString(),
      messages: [
        { role: "user" as const, text: "hi" },
        { role: "agent" as const, text: "hello" },
      ],
      chatId: "chat-1",
    };
    fs.writeFileSync(path.join(convDir, "agent-a.json"), JSON.stringify(payload), "utf-8");

    const mem = createMemory({ dir });
    const r1 = await syncCheckpointsFromConversations(mem);
    expect(r1.synced).toEqual(["agent-a"]);
    expect(r1.skipped).toEqual([]);

    const cpPath = path.join(dir, ".vault", "checkpoints", "agent-a.json");
    const cp = JSON.parse(fs.readFileSync(cpPath, "utf-8")) as Checkpoint;
    expect(cp.agentId).toBe("agent-a");
    expect(cp.chatId).toBe("chat-1");
    expect(cp.messages).toHaveLength(2);
    expect(cp.savedAt).toBeGreaterThanOrEqual(t0);

    const r2 = await syncCheckpointsFromConversations(mem);
    expect(r2.synced).toEqual([]);
    expect(r2.skipped).toEqual(["agent-a"]);
  });

  it("filters internal messages", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-sync-"));
    const convDir = path.join(dir, "conversations");
    fs.mkdirSync(convDir, { recursive: true });
    fs.writeFileSync(
      path.join(convDir, "x.json"),
      JSON.stringify({
        agentId: "x",
        savedAt: Date.now(),
        messages: [
          { role: "user", text: "u" },
          { role: "agent", text: "internal", internal: true },
          { role: "agent", text: "visible" },
        ],
      }),
      "utf-8",
    );
    const mem = createMemory({ dir });
    await syncCheckpointsFromConversations(mem);
    const cp = JSON.parse(
      fs.readFileSync(path.join(dir, ".vault", "checkpoints", "x.json"), "utf-8"),
    ) as Checkpoint;
    expect(cp.messages.map((m) => m.text)).toEqual(["u", "visible"]);
  });

  it("force overwrites up-to-date checkpoint", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-sync-"));
    const convDir = path.join(dir, "conversations");
    fs.mkdirSync(convDir, { recursive: true });
    fs.writeFileSync(
      path.join(convDir, "b.json"),
      JSON.stringify({
        agentId: "b",
        savedAt: new Date(Date.now() - 120_000).toISOString(),
        messages: [{ role: "user", text: "one" }],
      }),
      "utf-8",
    );
    const mem = createMemory({ dir });
    await syncCheckpointsFromConversations(mem);
    await syncCheckpointsFromConversations(mem, { force: true });
    const cpPath = path.join(dir, ".vault", "checkpoints", "b.json");
    const cp = JSON.parse(fs.readFileSync(cpPath, "utf-8")) as Checkpoint;
    expect(cp.messages).toHaveLength(1);
  });
});
