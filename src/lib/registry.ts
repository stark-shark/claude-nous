import * as fs from "node:fs";

export type Registry = Map<string, string>;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CODE_PATTERN = /^\$[\w-]+$/;

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export interface RegistryResult {
  ok: boolean;
  error?: string;
}

export function loadRegistry(registryPath: string): Registry {
  const registry: Registry = new Map();

  if (!fs.existsSync(registryPath)) {
    return registry;
  }

  const content = fs.readFileSync(registryPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^(\$[\w-]+)\s*=\s*(.+)$/);
    if (match) {
      registry.set(match[1], match[2].trim());
    }
  }

  return registry;
}

export function saveRegistry(registryPath: string, registry: Registry): void {
  if (fs.existsSync(registryPath)) {
    let content = fs.readFileSync(registryPath, "utf-8");
    const existingEntries = new Set<string>();

    for (const line of content.split("\n")) {
      const match = line.match(/^(\$[\w-]+)\s*=/);
      if (match) existingEntries.add(match[1]);
    }

    // Update existing entries
    for (const [code, expansion] of registry) {
      if (existingEntries.has(code)) {
        content = content.replace(
          new RegExp(`^${escapeRegex(code)}\\s*=.*$`, "m"),
          `${code} = ${expansion}`
        );
      }
    }

    // Append new entries at end
    const newEntries: string[] = [];
    for (const [code, expansion] of registry) {
      if (!existingEntries.has(code)) {
        newEntries.push(`${code} = ${expansion}`);
      }
    }

    if (newEntries.length > 0) {
      content = content.trimEnd() + "\n" + newEntries.join("\n") + "\n";
    }

    fs.writeFileSync(registryPath, content, "utf-8");
  } else {
    const lines = ["# Entity Registry\n"];
    for (const [code, expansion] of registry) {
      lines.push(`${code} = ${expansion}`);
    }
    fs.writeFileSync(registryPath, lines.join("\n") + "\n", "utf-8");
  }
}

export function addEntry(
  registry: Registry,
  code: string,
  expansion: string
): RegistryResult {
  if (!isValidCode(code)) {
    return {
      ok: false,
      error: `Invalid entity code '${code}'. Codes must match $[\\w-]+ (e.g., $emp, $auth-flow).`,
    };
  }
  const trimmed = expansion.trim();
  if (!trimmed) {
    return { ok: false, error: "Expansion cannot be empty." };
  }
  if (registry.has(code)) {
    return { ok: false, error: `Entity '${code}' already exists: ${registry.get(code)}` };
  }
  registry.set(code, trimmed);
  return { ok: true };
}

export function removeEntry(
  registry: Registry,
  code: string
): RegistryResult {
  if (!registry.has(code)) {
    return { ok: false, error: `Entity '${code}' not found` };
  }
  registry.delete(code);
  return { ok: true };
}

export function findUnknownEntities(
  content: string,
  registry: Registry
): string[] {
  const matches = content.match(/\$[\w-]+/g) ?? [];
  const unique = [...new Set(matches)];
  return unique.filter((code) => !registry.has(code));
}
