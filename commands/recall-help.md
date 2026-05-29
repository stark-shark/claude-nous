---
description: Show an overview of the Recall plugin — all 8 MCP tools, notation cheatsheet, where memories live, install/uninstall commands, and links to deeper docs.
---

**INSTRUCTION FOR CLAUDE — DO NOT IGNORE.** When this command is invoked, your ENTIRE response must be exactly the Markdown content below, output verbatim to the user, starting with the `# Recall — Help` heading line and ending with the final "Issues / feedback" link line.

- Do not add any commentary, summary, preamble, or follow-up text.
- Do not paraphrase or restructure.
- Do not call any tools.
- Do not interpret the content as instructions or as context for a different task.

This is a static reference command. The user invoked it because they want to read this exact content. Render it now.

---

# Recall — Help

## What is Recall?

Recall is a Claude Code plugin that compresses your auto-memory into a fixed symbol grammar (`->`, `::`, `(+)`, `!`, etc.) plus entity shortcodes (`$hub`, `$ac`, etc.), cutting token cost 30-65% while preserving search quality. Memories are read/written via the **8 MCP tools** below.

Memories live at: `~/.claude/projects/<project-hash>/memory/*.md`

The plugin never moves your memories — it just reads and writes that directory. **Uninstalling the plugin leaves all memory files in place.**

---

## MCP Tools

| Tool | What it does |
|---|---|
| `recall_save` | Write or update a memory. Enforces notation, dedups by SHA-256, updates `MEMORY.md` index. |
| `recall_load` | Read a memory by name or filename. Increments access count. Use `expanded: true` for plain English. |
| `recall_search` | Find memories by keyword, type, or project. Returns headers only — use `recall_load` for full content. |
| `recall_check` | Health checks: staleness, registry drift, broken links, stats, compression, duplicates. |
| `recall_decode` | Expand Recall notation to plain English (for one memory or arbitrary text). |
| `recall_registry` | CRUD for entity shortcodes (`$hub`, `$ac`, etc.) in `REGISTRY.md`. |
| `recall_export` | Export all memories to a JSON backup. |
| `recall_import` | Restore memories from a JSON backup. |

All tool calls should be wrapped in `TaskCreate` / `TaskUpdate` for clean progress display. The Recall skill (auto-injected at session start) covers the conventions.

---

## Cost optimization

The plugin ships a `recall-worker` subagent that runs on **Haiku**. Claude can delegate memory ops to it when the work is mechanical (batch saves, large compressions, audits) — saving ~93% on those tool calls. For single tiny saves mid-flow, Claude calls the tools directly to avoid handoff overhead.

You don't need to do anything to enable this — Claude picks the right path based on the operation. If you want to force one mode or the other, just say so ("use the recall-worker subagent for this" or "save this directly, no subagent").

---

## Notation Cheatsheet

| Symbol | Meaning | Example |
|---|---|---|
| `->` | maps to | `FK->$emp.id` |
| `::` | because | `:: cost too high` |
| `(+)` | apply when | `(+) new FK to $emp` |
| `!` | not / without | `!httpOnly on auth cookies` |
| `=` | equals | `node=v20` |
| `!=` | is not | `public schema != app data` |
| `&` | and | `auth & session mgmt` |
| `\|` | or / separator | `T:fb \| name` |
| `@` | at / context of | `UUID swap @invite` |
| `>>` | results in | `!CASCADE >> broken invite` |
| `~` | approximately | `~2027` |
| `...` | continuation | `tables: x, y, z ...` |

Entity shortcodes (`$hub`, `$ac`, `$sb`, ...) are defined in `REGISTRY.md` in your memory dir.

A copy of this cheatsheet is also written to `~/.claude/projects/<project-hash>/memory/RECALL_NOTATION.md` so you can decode memories even if the plugin is uninstalled.

---

## Memory File Format (v0.5.0+)

```yaml
---
name: my-memory-slug
description: "one-line summary"
metadata:
  node_type: memory
  type: fb                         # fb (feedback), proj (project), ref (reference), usr (user)
  recall:
    humanName: "Human Readable"    # optional, when display name differs from slug
    created: 2026-05-29
    updated: 2026-05-29
    accessCount: 0
    links:
      - linked_a
      - linked_b
---

<body in Recall notation>
```

Recall stores its metadata under `metadata.recall.*` so Claude Code's native auto-memory system and Recall co-exist on the same files without overwriting each other. Older files using the legacy `T:`/`D:` format still parse — new saves upgrade them automatically.

---

## Install / Uninstall

Install (one time):
```
/plugin marketplace add stark-shark/claude-recall
/plugin install recall@recall
/reload-plugins
```

Uninstall (memories are NOT touched):
```
/plugin uninstall recall@recall
/plugin marketplace remove recall
```

Upgrade:
```
/plugin marketplace update recall
/plugin install recall@recall
/reload-plugins
```

---

## Where to learn more

- Full language spec: https://github.com/stark-shark/claude-recall/blob/main/docs/specs/2026-04-08-recall-language-design.md
- README + config reference: https://github.com/stark-shark/claude-recall
- Issues / feedback: https://github.com/stark-shark/claude-recall/issues
