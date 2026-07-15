---
description: Back up the Nous memory set to a JSON file (portable).
---

Export Nous memories for backup / portability. Argument (optional output path): **$ARGUMENTS**

Invoke the `nous` skill, then call `nous_export` (pass the path if the user gave one). Report where the backup was written and how many memories it contains.

Note: this exports the distilled memory files. The full session cold-tier DB lives at `~/.claude/nous/nous.db` — to move your whole "brain" to another machine, copy that file alongside the `~/.claude/nous/memory/` dir and `RULES.md`.
