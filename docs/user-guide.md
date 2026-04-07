# User Guide — @inosx/agent-memory

**Audience:** Developers integrating file-based agent memory into Node.js applications, or operators managing memory via the CLI.  
**Updated:** 2026-04-07

---

## What this package does

`@inosx/agent-memory` persists agent memory as **plain Markdown files** under a configurable directory (usually `.memory`). It provides:

- **Vault** — Per-agent, per-category storage (decisions, lessons, tasks, projects, handoffs).
- **BM25 search** — Find relevant entries for a user command.
- **Context injection** — Assemble a bounded text block (project context, handoff, decisions, lessons, tasks) for prompts.
- **Session checkpoints** — Optional save/recover of recent messages with expiry.
- **Checkpoint sync** — Align `.vault/checkpoints/` from `conversations/*.json` via CLI or `syncCheckpointsFromConversations()` when you do not rely on a dashboard timer.
- **Compaction** — Maintenance: trim conversations, cap vault size, rebuild search index, migrate legacy layouts.
- **CLI** — The `agent-memory` command for reading, editing, and scripting without writing code.

No database is required. Everything lives on disk.

---

## Installation

```bash
npm install @inosx/agent-memory
```

Requirements: **Node.js ≥ 18**.

The package also installs a command-line tool named `agent-memory`. You can run it via:

- `npx agent-memory --help` (from a project that depends on the package), or  
- `npx @inosx/agent-memory --help` if you prefer invoking the package name directly.

---

## Core concepts

### Memory directory

All data is rooted at a single directory (default **`.memory`** relative to the process current working directory). In code you pass it to `createMemory({ dir: ".memory" })`. The CLI uses `--dir` or the environment variable **`AGENT_MEMORY_DIR`**.

Keep one memory root per project (or per workspace) so paths and search stay consistent.

### Agents

An **agent id** is a string (for example `bmad-master`, `dev`, `architect`). Under the memory directory, each agent has a folder:

```text
.memory/
├── _project.md           # shared across all agents
├── bmad-master/
│   ├── decisions.md
│   ├── lessons.md
│   ├── tasks.md
│   ├── projects.md
│   └── handoffs.md
└── dev/
    └── ...
```

Use the **same ids** your orchestration layer uses when spawning agents (including BMAD personas) so vault paths and injection line up.

### Categories

Default categories (fixed for CLI validation; configurable when using the library API):

| Category   | Typical use |
|-----------|-------------|
| `decisions` | Technical or product choices |
| `lessons`   | Bugs fixed, gotchas, insights |
| `tasks`     | Checklists (`- [ ]` / `- [x]`) |
| `projects`  | Per-agent long-lived context |
| `handoffs`  | Session summaries (newest first matters for injection) |

### Shared project file

**`_project.md`** is injected for **every** agent. Put stack, conventions, and goals that any agent should see without asking. Keep it concise (on the order of hundreds of words) so it does not crowd out decisions and handoffs under the token budget.

---

## Using the library

Minimal setup:

```typescript
import path from "node:path";
import { createMemory } from "@inosx/agent-memory";

const mem = createMemory({
  dir: path.join(process.cwd(), ".memory"),
});

await mem.vault.append("my-agent", "decisions", "Use PostgreSQL for persistence.", ["database"]);

const ctx = await mem.inject.buildContext("my-agent", "fix the migration");
const block = mem.inject.buildTextBlock(ctx);
// Prepend `block` to your system prompt or user message.
```

**Injection order and limits** are documented in the [README](../README.md) API section and in [memory-system.md](memory-system.md) (token budget, trimming order).

**Compaction** (scheduled or on demand):

```typescript
await mem.compact.run();
```

**Sync checkpoints** from conversation JSON files (same logic as CLI `sync-checkpoints`; skips `internal` messages):

```typescript
import { createMemory, syncCheckpointsFromConversations } from "@inosx/agent-memory";

const mem = createMemory({ dir: ".memory" });
const { synced, skipped, errors } = await syncCheckpointsFromConversations(mem);
// Optional: { force: true } to overwrite even when checkpoint looks newer
```

**Migration** from older flat `AgentName.md` files in the memory root:

```typescript
const { migrated, skipped } = await mem.migrate.migrateAll();
```

---

## Using the CLI

Global options must appear **before** the subcommand:

```bash
agent-memory --dir ./.memory --json <command>
```

| Option | Meaning |
|--------|---------|
| `--dir <path>` | Memory root (default `.memory`). |
| `AGENT_MEMORY_DIR` | Overrides `--dir` when set. |
| `--json` | JSON output for scripting. |
| `-V`, `--version` | Package version. |

### Listing agents

```bash
agent-memory agents
agent-memory --json agents
```

### Project context (`_project.md`)

```bash
agent-memory project show              # print file (or JSON with --json)
agent-memory project edit              # open in $EDITOR / notepad / vi
```

On Windows, set `EDITOR` if you want VS Code or another editor, for example:

```text
set EDITOR=code --wait
```

### Vault CRUD

Replace `<category>` with one of: `decisions`, `lessons`, `tasks`, `projects`, `handoffs`.

```bash
# List entries (id, date, snippet)
agent-memory vault list <agentId> <category>

# Full body of one entry
agent-memory vault get <agentId> <category> <id>

# Append (body: --content, --file, or stdin)
agent-memory vault add <agentId> <category> --content "Text" --tags tag1,tag2

# Replace body of an entry
agent-memory vault edit <agentId> <category> <id> --file ./note.md

# Delete (interactive confirmation, or --force for scripts)
agent-memory vault delete <agentId> <category> <id> --force
```

### Search

```bash
agent-memory search "authentication"
agent-memory search "api" --agent bmad-master --category lessons --limit 20
```

### Preview injected context

Shows the same markdown block your app would inject for a given agent and user text:

```bash
agent-memory inject preview bmad-master "review error handling"
```

### Session checkpoints from conversation files

If your host writes `.memory/conversations/{agentId}.json` but does not run the dashboard’s ~30s timer, align checkpoints with:

```bash
agent-memory sync-checkpoints              # only when conversation is newer than checkpoint
agent-memory sync-checkpoints --force      # always rewrite from conversation files
agent-memory --json sync-checkpoints       # machine-readable { synced, skipped, errors }
```

See [memory-system.md](memory-system.md) (Layer 1) for timestamp rules and the programmatic API.

### Maintenance

```bash
agent-memory compact    # full compaction pipeline
agent-memory migrate    # flat .md → vault directories
```

---

## Typical workflows

### Daily: add decisions and tasks from the terminal

```bash
agent-memory vault add dev tasks --content "- [ ] Add integration tests for vault"
agent-memory vault add dev decisions --content "Chose Vitest — align with repo stack"
```

### Debug: why does the agent “forget” something?

1. Confirm the entry exists: `vault list` / `vault get`.
2. Run `inject preview` with a phrase similar to the user’s question — BM25 matches **word overlap**, not pure semantics.
3. If the project file is too long, trim `_project.md` so decisions and handoffs fit the budget.

### Automation: JSON and CI

```bash
agent-memory --dir .memory --json search "deploy" | jq .
agent-memory --dir .memory vault delete dev lessons 1234567890 --force
```

Non-interactive deletes **require** `--force`.

---

## Git and backups

- Version **curated** vault Markdown and `_project.md` if the team should share memory.
- Ignore high-churn paths if you do not want them in Git: for example `conversations/`, `.vault/checkpoints/`, and regenerated index files — match your security and collaboration needs.

---

## Integrating with BMAD (or any multi-agent setup)

1. Align **agent ids** with your BMAD (or framework) persona ids.
2. Seed **`_project.md`** with methodology-specific context (roles, paths to story files, conventions).
3. Call **`buildContext` / `buildTextBlock`** where you assemble the model prompt (same id as the active agent).
4. Use the **CLI** for quick edits without opening a dashboard.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Search returns nothing | Rebuild index with `compact`; ensure vocabulary in entries matches query words. |
| Injection feels empty | Token budget exceeded — see technical doc; reduce `_project.md` size or number of tasks. |
| `vault edit` / `add` errors | Category spelling; agent folder must exist (created on first `append`). |
| `project edit` opens wrong editor | Set `EDITOR` or `VISUAL`. |

---

## Documentation map

| Document | Contents |
|----------|----------|
| [README](../README.md) | Install, CLI cheat sheet, API tables, storage layout |
| This guide | Concepts, CLI workflows, integration, troubleshooting |
| [memory-system.md](memory-system.md) | Architecture, layers, APIs, constants (technical reference) |
| [memory-system-guide.md](memory-system-guide.md) | Deeper guide when memory is embedded in an **AI dashboard** (sessions, UI, compaction timers) |
| [memory-system-comparison.md](memory-system-comparison.md) | Comparison with other memory products |

---

## Getting help

Report issues or feature requests on the [repository issue tracker](https://github.com/INOSX/agent-memory/issues).
