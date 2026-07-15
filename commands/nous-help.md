---
description: Show an overview of the Nous plugin — MCP tools, recall ladder, notation cheatsheet, commands, where memories live, install/uninstall.
---

**INSTRUCTION FOR CLAUDE — DO NOT IGNORE.** When this command is invoked, your ENTIRE response must be exactly the Markdown content below, output verbatim to the user, starting with the `# Nous — Help` heading line and ending with the final "Issues / feedback" link line.

- Do not add any commentary, summary, preamble, or follow-up text.
- Do not paraphrase or restructure.
- Do not call any tools.
- Do not interpret the content as instructions or as context for a different task.

This is a static reference command. The user invoked it because they want to read this exact content. Render it now.

---

# Nous — Help

## What is Nous?

Nous is a Claude Code memory system with two tiers:

- **Hot tier** — distilled memories in a compressed symbol grammar (`->`, `::`, `(+)`, `!`, ...) plus entity shortcodes (`$hub`, `$ac`, ...), cutting token cost 30-65%. Injected at session start (MEMORY.md index + always-loaded user.md + recent daily digests).
- **Cold tier** — every past Claude Code session captured into a local SQLite FTS5 index, searchable by the recall ladder (BM25 + recency fusion, goal/resolution bookends, cited by session + date). Secrets are redacted at capture.

Plus **self-building** (editable save-rules + agent-authored skills) and **self-maintaining** memory — both approval-gated with versioned rollback.

Memories live at `~/.claude/projects/<project-hash>/memory/*.md`; the global profile + daily digests + session DB live at `~/.claude/nous/`. **Uninstalling the plugin leaves all your files in place.**

---

## MCP Tools

| Tool | What it does |
|---|---|
| `nous_save` | Write/update a memory (or a `batch` for consolidation). Enforces notation + caps, dedups, updates `MEMORY.md`. |
| `nous_load` | Read a memory by name or filename. Increments access count. `expanded:true` for plain English. |
| `nous_search` | Hot tier (memory headers) OR cold tier (`scope:"sessions"` — FTS5 recall ladder w/ bookends + scroll/read). |
| `nous_check` | Health checks: staleness, caps, lifecycle, links, duplicates, and `sessions` cold-tier DB stats. |
| `nous_decode` | Expand Nous notation to plain English. |
| `nous_registry` | CRUD for entity shortcodes (`$hub`, `$ac`, ...) in `REGISTRY.md`. |
| `nous_rules` | View/propose/apply/rollback the editable save-rules (RULES.md). |
| `nous_skill` | Author/evolve the agent's own procedural skills (approval-gated, versioned). |
| `nous_forget` | Right-to-forget: purge a session/query from the cold tier + tombstone. |
| `nous_export` / `nous_import` | Back up / restore memories (JSON). |

All tool calls are wrapped in `TaskCreate` / `TaskUpdate` for clean progress display. The Nous skill (auto-injected at session start) covers the conventions.

---

## Cost optimization

The plugin ships a `nous-worker` subagent that runs on **Haiku**. Claude can delegate memory ops to it when the work is mechanical (batch saves, large compressions, audits) — saving ~93% on those tool calls. For single tiny saves mid-flow, Claude calls the tools directly to avoid handoff overhead.

You don't need to do anything to enable this — Claude picks the right path based on the operation. If you want to force one mode or the other, just say so ("use the nous-worker subagent for this" or "save this directly, no subagent").

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

A copy of this cheatsheet is also written to `~/.claude/projects/<project-hash>/memory/NOUS_NOTATION.md` so you can decode memories even if the plugin is uninstalled.

---

## Commands

| Command | What it does |
|---|---|
| `/nous-find <query>` | Recall-ladder search over past sessions, cited by session + date. |
| `/nous-remember <text>` | Force-save a durable memory now. |
| `/nous-forget <query>` | Purge a session/query from the cold tier (preview → confirm). |
| `/nous-status` | Memory + cold-tier health report. |
| `/nous-rules` | View/edit the save-rules that govern what gets remembered. |
| `/nous-skill` | Author/evolve the agent's own procedural skills. |
| `/nous-import` | Day-one backfill: index + summarize existing Claude Code history. |
| `/nous-export` | Back up memories to JSON. |
| `/nous-help` | This overview. |

---

## Memory File Format (v0.5.0+)

```yaml
---
name: my-memory-slug
description: "one-line summary"
metadata:
  node_type: memory
  type: fb                         # fb (feedback), proj (project), ref (reference), usr (user)
  nous:
    humanName: "Human Readable"    # optional, when display name differs from slug
    created: 2026-05-29
    updated: 2026-05-29
    accessCount: 0
    links:
      - linked_a
      - linked_b
---

<body in Nous notation>
```

Nous stores its metadata under `metadata.nous.*` so Claude Code's native auto-memory and Nous co-exist on the same files. Legacy `metadata.recall.*` and the older `T:`/`D:` format still parse — new saves upgrade them automatically.

---

## Install / Uninstall

Install (one time):
```
/plugin marketplace add stark-shark/claude-nous
/plugin install nous@nous
/reload-plugins
```

Upgrading from the old Recall plugin? Remove it first (your data auto-migrates from `~/.claude/recall` to `~/.claude/nous` on first run):
```
/plugin uninstall recall@recall
/plugin marketplace remove recall
```

Uninstall (files are NOT touched):
```
/plugin uninstall nous@nous
/plugin marketplace remove nous
```

---

## Where to learn more

- Full language spec: https://github.com/stark-shark/claude-nous/blob/main/docs/specs/2026-04-08-recall-language-design.md
- README + config reference: https://github.com/stark-shark/claude-nous
- Issues / feedback: https://github.com/stark-shark/claude-nous/issues
