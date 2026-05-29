# Recall

[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/stark_shark)

Compressed memory notation system for Claude Code. A plugin that provides MCP tools for reading, writing, searching, and managing memories with notation enforcement, cross-project search, health checks, and access tracking.

## What it does

Claude Code's auto-memory system stores project context as markdown files. Recall compresses that content using a fixed symbol grammar (`->`, `::`, `(+)`, `!`, `@`, `>>`, etc.) and entity shortcodes (`$hub`, `$sb`, etc.), reducing token cost 30-65% while preserving search and embedding quality.

The plugin ships with:

- **MCP server** — 8 tools for memory operations
- **Skill** — governs how Claude uses the tools (task display, multi-topic retrieval)
- **SessionStart hook** — auto-injects the skill at every session start

## Tools

| Tool | Purpose |
|---|---|
| `recall_save` | Write/update a memory with notation enforcement and content-hash dedup |
| `recall_load` | Read a memory by name or filename; increments access count |
| `recall_search` | Query memories across all projects by keyword, type, or project |
| `recall_check` | Health checks: staleness, registry drift, broken links, stats |
| `recall_decode` | Expand Recall notation to plain English |
| `recall_registry` | CRUD for entity shortcodes in REGISTRY.md |
| `recall_export` | Export memories to a JSON backup |
| `recall_import` | Restore memories from a JSON backup |

## Installation

Prerequisite: Node.js 20+ on PATH (Claude Code launches the MCP server with it; the bundled `dist/index.js` has no other runtime dependencies).

Run these three slash commands in Claude Code:

```
/plugin marketplace add stark-shark/claude-recall
/plugin install recall@recall
/reload-plugins
```

That's it. The plugin self-registers its MCP server and SessionStart hook — no `~/.claude/settings.json` editing, no `.mcp.json` editing, no `npm install` or build step on your end (the bundled `dist/` ships with the repo).

Verify with `/plugin` (Recall should show enabled), `/mcp` (the recall server should show connected), and `/recall-help` (renders the in-plugin help — see [`/recall-help`](#recall-help) below).

### Upgrade

```
/plugin marketplace update recall
/plugin install recall@recall
/reload-plugins
```

### Uninstall

```
/plugin uninstall recall@recall
```

Memories are **not touched** — they live at `~/.claude/projects/<project-hash>/memory/` and the plugin never owns that directory. A `RECALL_NOTATION.md` cheatsheet sits alongside the memories so you can decode them by hand even with no plugin installed.

To also forget the marketplace source (full wipe):

```
/plugin marketplace remove recall
```

### `/recall-help`

Once installed, type `/recall-help` in Claude Code for an in-session overview — all 8 tools, the symbol cheatsheet, the memory file format, install/upgrade/uninstall commands, and links to the deeper docs. Useful when you forget the notation or want to remind yourself what `recall_check --links` does without leaving the editor.

### Install from local clone (for development)

If you want to modify the plugin:

```bash
git clone https://github.com/stark-shark/claude-recall.git
cd claude-recall
npm install
npm run build      # esbuild bundle → dist/index.js
```

Then point the marketplace at the local directory instead of GitHub:

```
/plugin marketplace add <absolute-path-to-claude-recall>
/plugin install recall@recall
/reload-plugins
```

## Configuration

On first run, copy the default config:

```bash
cp recall.config.default.jsonc recall.config.jsonc
```

Edit `recall.config.jsonc` to customize. See `recall.config.reference.md` for all available settings.

Key settings:

- `notationEnforcement` — `strict` | `warn` | `off`
- `maintainIndex` — keep MEMORY.md updated on every save
- `headerFields.*` — toggle auto-populated fields (dates, access count, links)
- `healthChecks.*` — thresholds for staleness and compression ratio

## Memory Format (v0.5.0+)

Memories are markdown files with a YAML frontmatter header in Claude Code's native auto-memory format. Recall data lives under `metadata.recall.*`:

```yaml
---
name: my-memory-slug
description: "one-line summary"
metadata:
  node_type: memory
  type: fb                          # fb, proj, ref, usr
  recall:
    humanName: "Human Readable"     # optional — used when display name differs from slug
    created: 2026-05-29
    updated: 2026-05-29
    accessCount: 0
    links:
      - linked_a
      - linked_b
---

<body content using Recall notation>
```

This format lets Claude Code's native auto-memory system and Recall co-exist on the same files. Claude Code touches `name`, `description`, and `metadata.type`; Recall owns `metadata.recall.*`. Neither overwrites the other.

**Legacy format compatibility:** older files using a `T:<type> | <name>` / `D:` / `C:` / `U:` / `A:` / `L:` header still parse. New saves rewrite them to the format above — no manual migration required.

## Recall Notation

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

Full spec: [`docs/specs/2026-04-08-recall-language-design.md`](docs/specs/2026-04-08-recall-language-design.md)

## Memory Location

Memories live in Claude Code's standard project memory directory:

```
~/.claude/projects/<project-hash>/memory/
  MEMORY.md        # index (auto-maintained)
  REGISTRY.md      # entity shortcodes
  *.md             # individual memory files
```

Recall never moves memories — it just reads and writes to the existing location. If the plugin isn't running, Claude Code still auto-loads MEMORY.md as usual.

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

If you find Recall useful, consider supporting development:

[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/stark_shark)
