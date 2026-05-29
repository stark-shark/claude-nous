import * as fs from "node:fs";
import * as path from "node:path";

export const DECODER_FILENAME = "RECALL_NOTATION.md";

const DECODER_CONTENT = `# Recall Notation Cheatsheet

Memories in this directory are written in Recall notation — a compressed symbol
grammar used by the [Recall](https://github.com/stark-shark/claude-recall) Claude
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

## Memory File Header

Every memory begins with a YAML-style header:

\`\`\`
---
T:<type>       # fb (feedback), proj (project), ref (reference), usr (user)
D:<one-line description>
C:<created date>          # YYYY-MM-DD (optional, set once)
U:<updated date>          # YYYY-MM-DD (optional, set on save)
A:<access count>          # incremented when memory is loaded
L:<linked memories>       # comma-separated filenames (no .md)
---

<body in Recall notation>
\`\`\`

## Index

[\`MEMORY.md\`](MEMORY.md) in this directory is the index of all memories — one
line per memory with a short description. Open that first to browse.

## More

- Plugin + reinstall: https://github.com/stark-shark/claude-recall
- Full language spec: https://github.com/stark-shark/claude-recall/blob/main/docs/specs/2026-04-08-recall-language-design.md

---

*This file is maintained by the Recall plugin. It is safe to delete — it will be
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
