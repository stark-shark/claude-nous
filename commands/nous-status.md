---
description: Show Nous memory + cold-tier health (stats, caps, lifecycle, session DB).
---

Report Nous system status. Invoke the `nous` skill, then call `nous_check` with `checks:["all"]` (which includes the `sessions` cold-tier DB stats: sessions, messages, unsummarized count, redacted-hit count, DB size, FTS5 status, last index time).

Present the result as a short health summary. Flag anything actionable: over-cap memories to consolidate, many unsummarized sessions, or FTS5 unavailable (cold tier degraded to brute scan).
