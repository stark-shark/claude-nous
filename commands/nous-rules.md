---
description: View or edit the save-rules (RULES.md) that govern what Nous remembers.
---

Manage Nous save-rules. Argument (optional): **$ARGUMENTS**

Invoke the `nous` skill, then:
- No argument, or "show"/"get" → call `nous_rules action:"get"` and display the current rules.
- The user describes a rule change → read the current rules, produce the full updated RULES.md, call `nous_rules action:"propose"` with `content` (full file) and a one-line `note`. Show the user the one-line diff and the returned proposal id, then on confirmation call `nous_rules action:"apply" id:"<id>"`.
- "rollback" → call `nous_rules action:"rollback"`.

Never edit RULES.md with raw file writes — always go through `nous_rules` so it's backed up and drift-guarded.
