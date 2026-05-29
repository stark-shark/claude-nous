#!/usr/bin/env node
// Bundle the MCP server with esbuild, injecting the package version so it
// shows up in the MCP serverInfo handshake (visible in /plugin and /mcp UIs).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
);

const banner =
  "import { createRequire as ___createRequire } from 'module'; " +
  "const require = ___createRequire(import.meta.url);";

execSync(
  [
    "esbuild",
    "src/index.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--outfile=dist/index.js",
    `--banner:js=${JSON.stringify(banner)}`,
    `--define:__RECALL_VERSION__=${JSON.stringify(JSON.stringify(version))}`,
  ].join(" "),
  { cwd: ROOT, stdio: "inherit", shell: true },
);
