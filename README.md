# Nous

[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/stark_shark)

A local-first memory system for Claude Code that answers the three questions every memory system must — **storage**, **injection**, and **recall** — entirely on your existing Claude plan, with no external server, VPS, or second subscription. It's just files and a local SQLite DB you own and can port anywhere.

> **v1.0 — renamed from Recall to Nous.** Upgrading? See [Migrating from Recall](#migrating-from-recall). Your data copies over automatically on first run.

## What it does

- **Storage** — distilled memories in a compressed symbol grammar (`->`, `::`, `(+)`, `!`, `@`, `>>`, ...) + entity shortcodes (`$hub`, `$sb`, ...), cutting token cost 30-65%. Hard per-type caps force consolidation instead of bloat.
- **Injection** — a frozen snapshot loaded at every session start: the `MEMORY.md` index, the always-loaded `user.md` profile, and recent **daily digests**.
- **Recall** — every past Claude Code session is captured into a local **SQLite FTS5** index. The recall ladder searches it by BM25 relevance fused with recency, returns each hit's **goal + resolution bookends**, and **cites the exact session + date** — the thing Claude Code's built-in keyword troll can't do.

Plus two things that make it feel like it grows with you:

- **Self-building** — editable save-rules (`RULES.md`) and agent-authored procedural skills. When you correct what it remembers, it proposes a rule change; when a workflow repeats, it proposes a skill. All approval-gated with versioned rollback (fixing the self-rewrite risk Hermes is known for).
- **Self-maintaining** — it consolidates, dedups, and ages out memories on its own; content rewrites and profile edits are staged for your approval, never silent.

The plugin ships with an MCP server (the `nous_*` tools), a skill governing their use, a `nous-worker` Haiku subagent for cheap mechanical work, and hooks for capture (`Stop`/`SessionEnd`), injection (`SessionStart`), and background review.

Everything is captured locally, secrets are **redacted at capture**, and uninstalling leaves all your files in place.

### Hermes-style memory

Nous borrows the mechanisms that make Nous Research's Hermes memory feel like it "grows with you", layered on top of Nous's compression notation (so a cap holds far more than the same cap of raw prose):

- **Hard caps + overflow loop** — each memory body has a character cap (`caps.*`). A save over cap returns a `Cap exceeded` error and writes nothing; the model must consolidate or split, then retry. No auto-truncation, no silent bloat.
- **Always-loaded global `user.md`** — a `usr`-type memory named `user`/`profile` is stored once at `~/.claude/nous/memory/` (scoped to the user, shared across projects) and injected into context at every session start — the Hermes USER.md — with its own tight cap.
- **Cold tier (SQLite FTS5)** — every session is captured into `~/.claude/nous/nous.db`; `nous_search scope:"sessions"` runs the recall ladder (BM25 + recency fusion, bookends, citations). Uses the built-in `node:sqlite` (Node ≥22.5); falls back to a dependency-free brute scan otherwise. Secrets are redacted before indexing.
- **Auto-curation scan** — on session start, low-risk lifecycle transitions (`active → stale → archived`) are applied automatically **to the current project only**; over-cap/duplicate memories are escalated in a scan report. Archived memories leave MEMORY.md but stay searchable. `nous_check` gained `lifecycle` and `caps` reports.
- **Resurrection-on-access** — loading a stale/archived memory revives it to `active` and re-adds it to MEMORY.md, so memories you actually use never stay buried.
- **Background review** — every N user turns, a detached Haiku pass reviews the recent transcript and stages memory proposals to a pending queue (surfaced at the next session start), approval-gated by default. A legacy in-context nudge mode is still available (`review.mode:"nudge"`).
- **Pre-turn recall (push)** — on every prompt, an LLM-free FTS+RRF pass over past sessions injects up to 3 one-line reminders ("[date] project — summary (session id)"). Recall stops depending on the model deciding to search. Zero tokens, milliseconds (`preturn.*`).
- **Semantic keywords** — the session summarizer also emits 5-10 topic/synonym keywords, indexed into FTS as a hidden row — so paraphrase queries hit sessions whose transcripts never used those words.
- **Anti-thrash + atomic batch** — repeated over-cap retries on the same memory return terminal guidance instead of looping; `nous_save batch` is all-or-nothing (every spec validated before anything is written).
- **Injection defense** — content is scanned on write (invisible/control unicode hard-rejected) and delimiter-fenced on load, since memories are injected into the system prompt. All memory/state writes are atomic (temp + rename), and out-of-format overwrites are backed up first.
- **Retention** — interval-gated `VACUUM` keeps `nous.db` compact; optional pruning (`retention.pruneSessions`, off by default) reduces old summarized sessions to one searchable summary row.

All of it is config-driven — see `nous.config.reference.md`. Set `caps.*` to `0`, or `scan.enabled` / `review.enabled` / `security.scanOnWrite` to `false`, to opt out of any piece.

## Tools

| Tool | Purpose |
|---|---|
| `nous_save` | Write/update a memory with notation enforcement and content-hash dedup |
| `nous_load` | Read a memory by name or filename; increments access count |
| `nous_search` | Query memories across all projects (`scope:"memories"`) **or** full-text search past session transcripts (`scope:"sessions"`, the cold tier) |
| `nous_check` | Health checks: staleness, registry drift, broken links, stats |
| `nous_decode` | Expand Nous notation to plain English |
| `nous_registry` | CRUD for entity shortcodes in REGISTRY.md |
| `nous_export` | Export memories to a JSON backup |
| `nous_import` | Restore memories from a JSON backup |

## Installation

Prerequisite: Node.js on PATH. **Node ≥22.5** enables the SQLite cold tier (the recall ladder); on older Node the cold tier degrades to a dependency-free brute scan and everything else works unchanged. The bundled `dist/index.js` has no other runtime dependencies.

Run these three slash commands in Claude Code:

```
/plugin marketplace add stark-shark/claude-nous
/plugin install nous@nous
/reload-plugins
```

That's it. The plugin self-registers its MCP server and hooks — no `~/.claude/settings.json` editing, no `.mcp.json` editing, no `npm install` or build step on your end (the bundled `dist/` ships with the repo).

Verify with `/plugin` (Nous should show enabled), `/mcp` (the `nous` server should show connected), and `/nous:help`.

### Migrating from Recall

Nous is the renamed successor to the Recall plugin. Remove the old one and install Nous:

```
/plugin uninstall recall@recall
/plugin marketplace remove recall
/plugin marketplace add stark-shark/claude-nous
/plugin install nous@nous
/reload-plugins
```

On first run Nous **copies** your data from `~/.claude/recall` to `~/.claude/nous` (global `user.md`, per-project state, config → `nous.config.jsonc`) — non-destructively, so the old dir is left intact until you delete it. Per-project memories under `~/.claude/projects/<hash>/memory/` don't move and keep working (the `metadata.recall.*` header is still read; new saves write `metadata.nous.*`).

### Upgrade

```
/plugin marketplace update nous
/plugin install nous@nous
/reload-plugins
```

### Uninstall

```
/plugin uninstall nous@nous
```

Memories are **not touched** — they live at `~/.claude/projects/<project-hash>/memory/` and the plugin never owns that directory. A `NOUS_NOTATION.md` cheatsheet sits alongside the memories so you can decode them by hand even with no plugin installed.

To also forget the marketplace source (full wipe):

```
/plugin marketplace remove nous
```

### `/nous:help`

Once installed, type `/nous:help` in Claude Code for an in-session overview — the tools, the symbol cheatsheet, the memory file format, install/upgrade/uninstall commands, and links to the deeper docs. Useful when you forget the notation or want to remind yourself what `nous_check --links` does without leaving the editor.

### Install from local clone (for development)

If you want to modify the plugin:

```bash
git clone https://github.com/stark-shark/claude-nous.git
cd claude-nous
npm install
npm run build      # esbuild bundle → dist/index.js
```

Then point the marketplace at the local directory instead of GitHub:

```
/plugin marketplace add <absolute-path-to-claude-nous>
/plugin install nous@nous
/reload-plugins
```

## Configuration

On first run, copy the default config:

```bash
cp nous.config.default.jsonc nous.config.jsonc
```

Edit `nous.config.jsonc` to customize. See `nous.config.reference.md` for all available settings.

Key settings:

- `notationEnforcement` — `strict` | `warn` | `off`
- `maintainIndex` — keep MEMORY.md updated on every save
- `headerFields.*` — toggle auto-populated fields (dates, access count, links)
- `healthChecks.*` — thresholds for staleness and compression ratio

## Memory Format (v0.5.0+)

Memories are markdown files with a YAML frontmatter header in Claude Code's native auto-memory format. Nous data lives under `metadata.nous.*`:

```yaml
---
name: my-memory-slug
description: "one-line summary"
metadata:
  node_type: memory
  type: fb                          # fb, proj, ref, usr
  nous:
    humanName: "Human Readable"     # optional — used when display name differs from slug
    created: 2026-05-29
    updated: 2026-05-29
    accessCount: 0
    links:
      - linked_a
      - linked_b
    state: stale                    # lifecycle (active|stale|archived); absent = active
---

<body content using Nous notation>
```

This format lets Claude Code's native auto-memory system and Nous co-exist on the same files. Claude Code touches `name`, `description`, and `metadata.type`; Nous owns `metadata.nous.*`. Neither overwrites the other.

**Legacy format compatibility:** older files using the pre-v1 `metadata.recall.*` sub-block or a `T:<type> | <name>` / `D:` / `C:` / `U:` / `A:` / `L:` header still parse. New saves rewrite them to the format above — no manual migration required.

## Nous Notation

12 ASCII operators (no Unicode):

| Symbol | Meaning | Example |
|---|---|---|
| `->` | maps to | `FK->$emp.id` |
| `::` | because | `:: cost too high` |
| `(+)` | apply when | `(+) new FK to $emp` |
| `!` | not / without | `!httpOnly on auth cookies` |
| `=` | equals | `node=v20` |
| `!=` | is not | `public schema !=app data` |
| `&` | and | `auth & session mgmt` |
| `\|` | or / separator | `T:fb \| name` |
| `@` | at / context of | `UUID swap @invite` |
| `>>` | results in | `!CASCADE >> broken invite` |
| `~` | approximately | `~2027` |
| `...` | continuation | `tables: x, y, z ...` |

Entity shortcodes like `$hub`, `$ac`, `$sb` are defined in `REGISTRY.md` and expanded at decode time.

Full spec: [`docs/specs/2026-04-08-nous-language-design.md`](docs/specs/2026-04-08-nous-language-design.md)

## Memory Location

Memories live in Claude Code's standard project memory directory:

```
~/.claude/projects/<project-hash>/memory/
  MEMORY.md        # index (auto-maintained)
  REGISTRY.md      # entity shortcodes
  *.md             # individual memory files
```

Nous never moves memories — it just reads and writes to the existing location. If the plugin isn't running, Claude Code still auto-loads MEMORY.md as usual.

## Development

```bash
npm run build      # esbuild bundle → dist/index.js (single self-contained file)
npm run typecheck  # tsc --noEmit
npm run dev        # tsc --watch (source-level type checking; does not produce a runnable bundle)
npm test           # vitest run
npm run test:watch # vitest watch mode
```

The MCP server entry is `src/index.ts`. The bundle is stamped with the version from `package.json` at build time via `scripts/build.mjs` — bump the version in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` together, run `npm run build`, commit. New slash commands go in `commands/<name>.md` and are picked up automatically.

## License

MIT — see [LICENSE](LICENSE).

## Support

If you find Nous useful, consider supporting development:

[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/stark_shark)
