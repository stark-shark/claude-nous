---
description: Show an overview of the Recall plugin — all 8 MCP tools, notation cheatsheet, where memories live, install/uninstall commands, and links to deeper docs.
---

# Recall — Help

Render the following help text to the user as-is. Do not paraphrase. Do not run any tools — this command is informational.

---

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

## Memory File Format

```
---
T:<type>      # fb (feedback), proj (project), ref (reference), usr (user)
D:<one-line description>
C:<created date>        # optional
U:<updated date>        # optional, set on save
A:<access count>        # optional, incremented on load
L:<linked memories>     # optional, comma-separated filenames
---

<body in Recall notation>
```

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
