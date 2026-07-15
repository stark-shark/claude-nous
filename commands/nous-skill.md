---
description: Author or evolve one of the agent's own procedural-memory skills.
---

Manage agent-authored skills. Argument: **$ARGUMENTS**

Invoke the `nous` skill, then:
- "list" → `nous_skill action:"list"`.
- "get <name>" → `nous_skill action:"get" name:"<name>"`.
- Describe a new/updated skill → draft a complete SKILL.md (YAML frontmatter with `name` + `description`, then a clear procedural body), call `nous_skill action:"create"` (or `"patch"`) with `name` + `content`. Show the returned proposal id, then on confirmation `nous_skill action:"apply" id:"<id>"`. It's written to ~/.claude/skills and becomes invokable.
- "rollback <name>" → `nous_skill action:"rollback" name:"<name>"`.

Names are kebab-case; `nous`/`recall` are reserved (the core skill is read-only). Every apply is validated, path-hardened, and backed up.
