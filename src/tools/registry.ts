import * as path from "node:path";
import {
  loadRegistry,
  saveRegistry,
  addEntry,
  removeEntry,
  isValidCode,
} from "../lib/registry.js";

export interface RegistryInput {
  action: "list" | "add" | "update" | "remove";
  code?: string;
  expansion?: string;
}

export interface RegistryResult {
  text: string;
  isError?: boolean;
}

export function handleRegistry(
  input: RegistryInput,
  memoryDir: string,
  registryFile: string
): RegistryResult {
  const registryPath = path.join(memoryDir, registryFile);
  const registry = loadRegistry(registryPath);

  switch (input.action) {
    case "list": {
      if (registry.size === 0) {
        return { text: "Registry is empty." };
      }
      const lines = [...registry.entries()].map(
        ([code, exp]) => `${code} = ${exp}`
      );
      return { text: `${registry.size} entities:\n${lines.join("\n")}` };
    }

    case "add": {
      if (!input.code || !input.expansion) {
        return { text: "Provide 'code' and 'expansion' for add.", isError: true };
      }
      const result = addEntry(registry, input.code, input.expansion);
      if (!result.ok) {
        return { text: result.error!, isError: true };
      }
      saveRegistry(registryPath, registry);
      return { text: `Added: ${input.code} = ${input.expansion}` };
    }

    case "update": {
      if (!input.code || !input.expansion) {
        return { text: "Provide 'code' and 'expansion' for update.", isError: true };
      }
      if (!isValidCode(input.code)) {
        return {
          text: `Invalid entity code '${input.code}'. Codes must match $[\\w-]+ (e.g., $emp, $auth-flow).`,
          isError: true,
        };
      }
      const trimmed = input.expansion.trim();
      if (!trimmed) {
        return { text: "Expansion cannot be empty.", isError: true };
      }
      if (!registry.has(input.code)) {
        return { text: `Entity '${input.code}' not found.`, isError: true };
      }
      registry.set(input.code, trimmed);
      saveRegistry(registryPath, registry);
      return { text: `Updated: ${input.code} = ${trimmed}` };
    }

    case "remove": {
      if (!input.code) {
        return { text: "Provide 'code' for remove.", isError: true };
      }
      const result = removeEntry(registry, input.code);
      if (!result.ok) {
        return { text: result.error!, isError: true };
      }
      saveRegistry(registryPath, registry);
      return { text: `Removed: ${input.code}` };
    }

    default:
      return { text: `Unknown action: ${input.action}`, isError: true };
  }
}
