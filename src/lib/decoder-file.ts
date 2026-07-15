import * as fs from "node:fs";
import * as path from "node:path";

export const DECODER_FILENAME = "RECALL_NOTATION.md";

const DECODER_CONTENT = `# Nous Notation Cheatsheet

Memories in this directory are written in Nous notation — a compressed symbol
grammar used by the [Nous](https://github.com/stark-shark/claude-nous) Claude
Code plugin. This file is regenerated on every save so you can always decode the
memories yourself, even without the plugin installed.

## Symbol Legend

| Symbol | Meaning             | Example                           |
|--------|---------------------|-----------------------------------|
| \`->\`   | maps to             | \`FK->employees.id\`                |
| \`::\`   | because             | \`:: cost too high\`                |
| \`(+)\`  | apply when          | \`(+) new FK to $emp\`              |
| \`!\`    | not / without       | \`!httpOnly on auth cookies\`       |
| \`=\`    | equals              | \`node=v20\`                        |
| \`!=\`   | is not              | \`public schema != app data\`       |
| \`&\`    | and                 | \`auth & session mgmt\`             |
| \`\\|\`    | or / separator      | \`T:fb \\| name\`                     |
| \`@\`    | at / context of     | \`UUID swap @invite\`               |
| \`>>\`   | results in          | \`!CASCADE >> broken invite\`       |
| \`~\`    | approximately       | \`~2027\`                           |
| \`...\`  | continuation        | \`tables: x, y, z ...\`             |

## Entity Shortcodes

Shortcodes like \`$hub\`, \`$ac\`, \`$sb\` are defined in [\`REGISTRY.md\`](REGISTRY.md)
in this same directory. Look there to see what each one expands to.

## Memory File Header (v0.5.0+)

Every memory begins with a YAML frontmatter block in Claude Code's native auto-memory format, with Nous-specific data nested under \`metadata.recall\`:

\`\`\`yaml
---
name: my-memory-slug              # kebab-case identifier
description: "one-line summary"
metadata:
  node_type: memory
  type: fb                        # fb (feedback), proj (project), ref (reference), usr (user)
  recall:
    humanName: "Human Readable Name"   # optional — only when it differs from the slug
    created: 2026-05-29                # YYYY-MM-DD (set once)
    updated: 2026-05-29                # YYYY-MM-DD (updated on save)
    accessCount: 0                     # incremented on each nous_load
    links:
      - linked_memory_a                # filenames without .md
      - linked_memory_b
---

<body in Nous notation>
\`\`\`

**Older files** (pre-v0.5.0) may use a legacy header with \`T:<type> | <name>\`, \`D:\`, \`C:\`, \`U:\`, \`A:\`, \`L:\` lines between two \`---\` markers. Nous reads both formats. New saves always use the newer format above.

## Index

[\`MEMORY.md\`](MEMORY.md) in this directory is the index of all memories — one
line per memory with a short description. Open that first to browse.

## More

- Plugin + reinstall: https://github.com/stark-shark/claude-nous
- Full language spec: https://github.com/stark-shark/claude-nous/blob/main/docs/specs/2026-04-08-recall-language-design.md

---

*This file is maintained by the Nous plugin. It is safe to delete — it will be
recreated the next time a memory is saved. Edit if you want a custom cheatsheet;
it will be overwritten only if the file is missing.*
`;

export function ensureDecoderFile(memoryDir: string): void {
  const target = path.join(memoryDir, DECODER_FILENAME);
  if (fs.existsSync(target)) return;
  try {
    fs.writeFileSync(target, DECODER_CONTENT, "utf8");
  } catch {
    // best-effort — never block a save on this
  }
}
