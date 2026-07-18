---
description: Force-save a durable memory now (bypasses the review cadence).
---

The user wants to remember: **$ARGUMENTS**

Invoke the `nous` skill. Decide the memory `type` (fb/proj/ref/usr) and a concise `name`, compress the content into Nous notation (drop filler; keep identifiers/paths/numbers verbatim), then call `nous_save`. Search first (`nous_search`) to update an existing memory instead of duplicating.

If the content is large or spans multiple topics, delegate the compression to the `nous-worker` subagent. Respect the per-type character cap — consolidate if it rejects. Report the filename and cap usage.
