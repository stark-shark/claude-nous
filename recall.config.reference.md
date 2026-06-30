# Recall Configuration Reference

## Settings

### maintainIndex
- **Type:** boolean
- **Default:** true
- **Description:** When true, recall_save updates MEMORY.md index after every write. Disable if you rely solely on recall_search and don't want the index file.

### indexFile
- **Type:** string
- **Default:** "MEMORY.md"
- **Description:** Name of the index file in each project's memory directory.

### indexMaxLines
- **Type:** number
- **Default:** 200
- **Description:** Maximum number of index ENTRIES (`- [name](file) — desc` lines). Headers, section titles, and blank lines are not counted. When exceeded, the oldest (topmost) entries are moved to `MEMORY_ARCHIVE.md` in the same directory — never deleted. Restore an entry by moving its line back to the index.

### registryFile
- **Type:** string
- **Default:** "REGISTRY.md"
- **Description:** Name of the entity registry file in each project's memory directory.

### notationEnforcement
- **Type:** "strict" | "warn" | "off"
- **Default:** "warn"
- **Values:**
  - `strict` — Rejects saves that don't pass Recall notation validation. Returns error with specific failures.
  - `warn` — Saves the memory but returns warnings about notation issues.
  - `off` — No validation. Raw passthrough.

### headerFields.dates
- **Type:** boolean
- **Default:** true
- **Description:** Auto-populate C: (created) and U: (updated) fields in memory headers on save.

### headerFields.accessCount
- **Type:** boolean
- **Default:** true
- **Description:** Increment A: (access count) field in memory headers on recall_load.

### headerFields.links
- **Type:** boolean
- **Default:** true
- **Description:** Maintain bidirectional L: (links) references. When memory A links to B, automatically add A to B's L: field.

### healthChecks.staleDays
- **Type:** number
- **Default:** 30
- **Description:** Number of days since U: (last updated) before a memory is flagged as stale by recall_check.

### healthChecks.staleMinAccess
- **Type:** number
- **Default:** 2
- **Description:** Memories with A: (access count) below this threshold AND older than staleDays are flagged as stale.

### healthChecks.compressionTolerancePct
- **Type:** number
- **Default:** 10
- **Description:** Allowed percentage above target compression ratio before recall_check flags a memory as verbose.

## Hermes-style mechanics (v0.6)

### caps
- **Type:** object — `{ fb, proj, ref, usr, user }`, each a number (characters; 0 = unlimited)
- **Default:** `{ fb: 1200, proj: 2200, ref: 2200, usr: 1375, user: 1375 }`
- **Description:** Hard cap on each memory's notation body. A `recall_save` over the cap returns a `Cap exceeded` error and writes **nothing** — the model must consolidate, split, or remove content and retry in the same turn. Recall never auto-truncates. Because the body is already compressed notation, a cap holds far more knowledge than the same cap of raw prose. `user` is the cap for the special `user.md` profile; the others are by memory type.

### security.scanOnWrite
- **Type:** boolean
- **Default:** true
- **Description:** Scan content before save. Invisible/control/bidi unicode is hard-rejected (see `rejectInvisible`); role-impersonation and instruction-override phrasing produce warnings but still save.

### security.scanOnLoad
- **Type:** boolean
- **Default:** true
- **Description:** On `recall_load`, scan the content and wrap it in `<<RECALL …>>` delimiter fences so a memory cannot impersonate system/agent framing (Hermes' "Brainworm" defense). A warning banner is prepended if the memory trips any rule.

### security.rejectInvisible
- **Type:** boolean
- **Default:** true
- **Description:** When true, a write containing invisible/control unicode is rejected outright. Set false to downgrade it to a warning.

### scan.enabled
- **Type:** boolean
- **Default:** true
- **Description:** Master switch for the auto-apply curation scan that runs on SessionStart (via the plugin hook → `node dist/index.js --scan`).

### scan.autoArchiveStale
- **Type:** boolean
- **Default:** true
- **Description:** When true, the scan writes lifecycle transitions automatically: `active → stale` (older than `healthChecks.staleDays`, access below `staleMinAccess`) and `stale → archived` (older than `staleDays + archiveAfterStaleDays`). Archived memories are removed from MEMORY.md (leave hot context) but remain searchable. Over-cap and duplicate memories are escalated in the scan report, never auto-modified.

### scan.archiveAfterStaleDays
- **Type:** number
- **Default:** 30
- **Description:** Extra days past the stale threshold before a memory is archived.

### scan (scope)
The auto-apply scan only mutates the **current project** (the cwd the session was launched in) — it never silently changes other projects' memories. The always-loaded `user.md` profile is exempt from lifecycle archiving.

### review.enabled
- **Type:** boolean
- **Default:** true
- **Description:** Master switch for the active mid-session review nudge (a `UserPromptSubmit` hook). When on, every `everyNTurns` user turns a `<RECALL_REVIEW>` block is injected so the agent delegates a memory review to the recall-worker subagent.

### review.everyNTurns
- **Type:** number
- **Default:** 10
- **Description:** Number of user turns between review nudges (per project). Hermes uses ~10.

### review.approvalGate
- **Type:** boolean
- **Default:** true
- **Description:** When true, the review proposes memories as one-line diffs and the user confirms before anything is written. Set false to let the review save directly (higher risk of recording a wrong fact — keep it on until you trust it).

### userMemory.filename
- **Type:** string
- **Default:** "user.md"
- **Description:** The reserved file a `usr`-type memory named `user` or `profile` is written to. This file is the always-loaded user profile, stored globally at `~/.claude/recall/memory/`.

### userMemory.alwaysLoad
- **Type:** boolean
- **Default:** true
- **Description:** When true, the SessionStart hook injects `user.md`'s body (fenced) into context at the start of every session — the Hermes USER.md behavior. The profile is scoped to the USER (global), shared across all projects.
