# Nous — Compressed Memory Language Spec

**Date:** 2026-04-08
**Status:** Approved
**Purpose:** A symbol grammar for compressing Claude Code auto-memory files. Reduces token cost on every session load while preserving search/embedding quality. Used for both always-loaded memories (MEMORY.md system) and future vector DB retrieval results.

---

## 1. Symbol Grammar

Fixed set of 12 operators using ASCII-only symbols (no Unicode — avoids Windows console encoding issues). Never changes without a spec revision.

| Symbol | Meaning | Example |
|---|---|---|
| `->` | maps to / becomes / leads to | `FK->$emp.id` |
| `::` | because / reason | `:: cost too high` |
| `(+)` | apply when / trigger condition | `(+) new FK to $emp` |
| `!` | not / without / never | `!httpOnly on auth cookies` |
| `=` | equals / is defined as | `sonnet=$0.07/chat` |
| `!=` | is not / must not be | `public schema !=app data` |
| `&` | and (joining related items) | `auth & session mgmt` |
| `\|` | or / separator in headers | `T:fb \| name` |
| `@` | at / on / in context of | `UUID swap @invite` |
| `>>` | results in / therefore | `!CASCADE >> broken invite` |
| `~` | approximately / around | `~2027` |
| `...` | continuation / more exists | `tables: x, y, z ...` |

## 2. Drop & Preserve Rules

### Always drop
- Articles (a, an, the)
- Filler (just, basically, essentially, really)
- Hedging (might, could, perhaps, probably)
- Transitions (however, additionally, furthermore)
- Passive constructions -> rewrite as active

### Never compress
- Technical identifiers (table names, column names, function names)
- File paths
- SQL fragments
- Numbers, dates, version numbers
- Error messages or exact patterns

## 3. Header Format

Every memory file starts with:

```
---
T:<type_code> | <name>
D:<one-line description — used for relevance matching>
---
```

## 4. Memory Types & Density Rules

| Code | Type | Density | Description |
|---|---|---|---|
| `fb` | feedback | Aggressive | Compress to rule + reason + trigger |
| `proj` | project | Selective | Compress prose, preserve all technical identifiers |
| `ref` | reference | Light | Preserve paths, commands, SQL, steps verbatim |
| `usr` | user | Medium | Key facts about person, skills, preferences |

### fb (feedback) — aggressive

Three required fields, optional extras:

```
rule: <the rule>
:: <why>
(+) <when to apply>
refs: <optional code references>
ex: <optional examples>
```

### proj (project) — selective

Free-form compressed notes. Architecture details, column names, function names, known gaps stay verbatim. Only the prose connecting them gets compressed.

### ref (reference) — light

Paths, commands, SQL, and step sequences stay as-is. Only compress the explanatory prose around them.

### usr (user) — medium

Key facts, skills, preferences. Drop filler but keep enough context to inform behavior.

## 5. Entity Registry

Lives at `REGISTRY.md` in the memory directory. Loaded at session start alongside MEMORY.md.

Format:

```markdown
# Entity Registry

## Projects
$hub = midwest-apps-hub (Next.js 16, React 19)
$ac = midwest-admin-center (Next.js 15, React 18)
$itam = midwest-it-asset-manager
...

## Schemas
$emp = employees.employees
$pub = public
...

## People
$cs = Connor Stark

## Infra
$sb = Supabase
$vcel = Vercel
...
```

Rules:
- Codes are short but not cryptic (`$hub` not `$h`)
- New entities added as they come up
- Prefixed with `$` to distinguish from regular text

## 6. MEMORY.md Index Format

Compressed with shortcodes, still one-liners. Detailed info lives in individual memory files.

Before:
```
- [GP Integration](project_gp_integration.md) — GP -> Supabase sync. Multi-table wizard, filter builder, AI Assist (Haiku). Active 2026-04-03.
```

After:
```
- [GP Integration](project_gp_integration.md) — GP->$sb sync, wizard, filter builder, AI Assist. v2.9.0
```

200-line cap still applies.

## 7. Compression Examples

### Feedback (fb) — ~62% reduction

**Before (~120 tokens):**
> Any foreign key referencing `employees.employees.id` MUST include `ON UPDATE CASCADE`.
> **Why:** The `handle_new_user()` trigger on `auth.users` swaps an existing employee's UUID to match the new auth user when they're invited. Employee records often exist before auth accounts (bulk-loaded from HR). Without ON UPDATE CASCADE, the UUID swap fails and the invite flow breaks, creating duplicate orphaned rows.
> **How to apply:** Whenever creating a new table with a FK to `employees.employees.id`, always write `ON UPDATE CASCADE`. This applies to all schemas.

**After (~45 tokens):**
```
---
T:fb | FK CASCADE
D:FKs->$emp.id require ON UPDATE CASCADE or invite flow breaks
---
rule: FK->$emp.id REQ ON UPDATE CASCADE
:: handle_new_user()@auth.users swaps UUID@invite; !CASCADE >> blocked swap+orphan rows
(+) all schemas, any new FK->$emp.id
refs: $ita.profiles.employee_uuid, $ita.users.employee_uuid,
  $ovo.meetings.employee_id, $emp.app_roles.employee_id
```

### Project (proj) — ~62% reduction

**Before (~400 tokens):** Full GP integration memory with prose descriptions.

**After (~150 tokens):**
```
---
T:proj | GP Integration
D:GP->$sb sync w/ AI-assisted discovery, wizard, filter builder. v2.9.0
---
## arch
2 processes @GP server (C:\midwestSoftware\midwest-gp-agent\):
1. sync ($gpa run-sync.cmd) — 5min sched, SYSTEM. reads configs->queries GP->upserts data_sync_gp.*, change detection
2. watcher ($gpa run-watcher.cmd) — persistent@startup, SYSTEM. $sb Realtime for discovery events: tables|columns|preview|sync|sample_match

## tech
- custom JOINs: gp_source_query col; column_map uses alias->alias identity mapping
- composite PKs: pipe-sep (title|line_seq), concat for gp_pk_value
- active(10xxx)<->history(30xxx): identical cols, wizard toggle, TABLE_EQUIVALENTS map swaps
- GP ref: lib/gp-reference.ts — 200+ tables, 130+ cols, 25 enums. compact mode for Sonnet->avoid 504
- col conflicts: built-in names->prefixed gp_
- Realtime: subscribe !row-level filters; metadata=JSONB, already parsed, !JSON.parse()

## ai-assist
1. table select (Haiku) — pre-filter keywords, chunk 250/batch, GP ref+chat history
2. sample CSV match — paste data->agent searches candidates->matched rows w/ full data
3. col verify (Sonnet, compact ref) — maps user fields->GP cols, flags active/history, confidence+unmapped
4. create from match — JOIN query w/ table set swap, composite PK, identity column_map

## gaps
- AI Assist in col editor for existing integrations
- active/history dual creation w/ auto-cleanup
- UNION "Both" !implemented
- preview before create-from-match
- col editor !update gp_source_query (warning only)
```

### Reference (ref) — ~37% reduction

**Before (~350 tokens):** Full GP agent deployment with prose explanations.

**After (~220 tokens):**
```
---
T:ref | GP Agent Deployment
D:deployment, task scheduler, .cmd wrappers, update process for $gpa on GP server
---
## location
C:\midwestSoftware\midwest-gp-agent\ @GPSQL2019

## creds
.env (never committed): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  GP_SQL_SERVER=localhost, GP_SQL_USER=gp_reader, GP_SQL_PASSWORD, GP_SQL_PORT=1433
gp_reader has db_datareader on GP company DBs

## tasks (folder: \GP to Supabase Agent\)
both use .cmd wrappers :: SYSTEM acct !resolve npm/tsx via PowerShell

1. **Sync** — every 5min
   prog: C:\midwestSoftware\midwest-gp-agent\run-sync.cmd
   cmd: node.exe node_modules\tsx\dist\cli.mjs src\index.ts
   timeout: 4min

2. **Watcher** — persistent @startup, SYSTEM
   prog: C:\midwestSoftware\midwest-gp-agent\run-watcher.cmd
   cmd: node.exe node_modules\tsx\dist\cli.mjs src\watcher.ts
   "stop if running longer than" MUST be UNCHECKED

## update process
1. edit src/ @C:\Users\ConnorStark\appDevelopment\midwest-gp-agent\src\
2. copy changed src/ files->GP server
3. restart watcher: schtasks /end /tn "\GP to Supabase Agent\Watcher Agent" && schtasks /run /tn "..."
4. sync picks up changes @next 5min run

## why .cmd
as of 2026-04-02, powershell.exe -NoExit -Command "npm run watch" showed RUNNING but !functional.
direct node.exe via .cmd fixed it. SYSTEM has nodejs on PATH but npm/tsx resolution via PS=unreliable

## realtime req
integration_gp_discovery MUST be in supabase_realtime publication:
ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_gp_discovery;
```

## 8. Decoder

Two forms:

### CLI (Python, no dependencies)

Interactive mode — lists memory files with type badges, user selects one, decoder expands it.

```
$ python nous/decode.py

  Nous Memory Decoder
  ─────────────────────
  1. [fb]   FK CASCADE
  2. [fb]   Token & Cost Discipline
  3. [proj] GP Integration
  4. [ref]  GP Agent Deployment
  5. [usr]  User Profile
  a. Decode all

  Select: _
```

Decoder operations:
- Symbol expansion (`::` -> "Because:", `(+)` -> "Apply when:", `->` -> "maps to", `>>` -> "results in", etc.)
- Registry lookup (`$hub` -> "midwest-apps-hub", `$emp` -> "employees.employees", etc.)
- Type-aware formatting (restore section headers, add prose connectors for readability)

Lossy decode is acceptable — the compressed version is the source of truth. The decoder produces a human-scannable approximation, not a perfect reconstruction.

### In-conversation

User asks to decode a memory, Claude reads the file and translates inline. No tooling needed — Claude knows the grammar natively.

## 9. File Layout

```
nous/
  docs/
    specs/
      2026-04-08-nous-language-design.md   ← this file
  decode.py                                   ← CLI decoder
  README.md                                   ← (only if needed)
```

The registry and compressed memories live in the existing memory directory:
```
memory/
  MEMORY.md        ← compressed index
  REGISTRY.md      ← entity shortcodes
  *.md             ← compressed memory files
```

## 10. Target Compression Ratios

| Type | Target reduction | Rationale |
|---|---|---|
| `fb` | 55-65% | Rules are pure prose, compress hard |
| `proj` | 55-65% | Narrative compresses well, tech identifiers stay |
| `ref` | 30-40% | Most content is paths/commands/SQL that must stay verbatim |
| `usr` | 40-50% | Medium prose density |

## 11. Mid-Session Write Triggers

Memories should be written/updated at natural checkpoints during a session, not deferred to session end. The following triggers indicate that project state has meaningfully changed:

| Trigger | When | What to capture |
|---|---|---|
| Version bump | Every `npm version` call | Features added, bugs fixed, architectural changes since last bump |
| Plan completion | Multi-step plan (5+ tasks) finishes | Outcomes, decisions made, gaps discovered |
| Architecture decision | Choosing approach A over B | The decision, alternatives considered, and reasoning |
| Batch of fixes/features | 3+ related changes completed | Collective shift in project state |
| Project switch | Switching to a different project mid-session | Where you left off, open questions, next steps |

Mechanical triggers (timers, per-commit) produce low-signal memories. Only write when something notable happened.

## 12. MCP Server

The Nous MCP server (`~/.claude/nous/`) provides runtime tooling for memory operations. Design spec: `_plans/superpowers/specs/2026-04-14-nous-mcp-server-design.md`.

Tools: `nous_save`, `nous_load`, `nous_search`, `nous_check`, `nous_decode`, `nous_registry`, `nous_export`, `nous_import`.

The server enforces notation at write time, tracks access counts, maintains bidirectional links, and provides cross-project memory search. The Python decoder (`decode.py`) remains as a standalone fallback.

## 13. Scope Boundaries

**In scope:**
- Language spec (grammar, types, density rules)
- Entity registry format
- CLI decoder (interactive, Python)
- In-conversation decoding by Claude

**Out of scope (future work):**
- Vector DB integration (ChromaDB)
- MCP server
- Auto-save hooks
- Conversation ingestion
- Tiered retrieval (T1/T2/T3)

This spec covers the compression language only. The broader memory system is a separate spec.
