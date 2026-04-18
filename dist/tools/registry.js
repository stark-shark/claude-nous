import * as path from "node:path";
import { loadRegistry, saveRegistry, addEntry, removeEntry, } from "../lib/registry.js";
export function handleRegistry(input, memoryDir, registryFile) {
    const registryPath = path.join(memoryDir, registryFile);
    const registry = loadRegistry(registryPath);
    switch (input.action) {
        case "list": {
            if (registry.size === 0) {
                return { text: "Registry is empty." };
            }
            const lines = [...registry.entries()].map(([code, exp]) => `${code} = ${exp}`);
            return { text: `${registry.size} entities:\n${lines.join("\n")}` };
        }
        case "add": {
            if (!input.code || !input.expansion) {
                return { text: "Provide 'code' and 'expansion' for add.", isError: true };
            }
            const result = addEntry(registry, input.code, input.expansion);
            if (!result.ok) {
                return { text: result.error, isError: true };
            }
            saveRegistry(registryPath, registry);
            return { text: `Added: ${input.code} = ${input.expansion}` };
        }
        case "update": {
            if (!input.code || !input.expansion) {
                return { text: "Provide 'code' and 'expansion' for update.", isError: true };
            }
            if (!registry.has(input.code)) {
                return { text: `Entity '${input.code}' not found.`, isError: true };
            }
            registry.set(input.code, input.expansion);
            saveRegistry(registryPath, registry);
            return { text: `Updated: ${input.code} = ${input.expansion}` };
        }
        case "remove": {
            if (!input.code) {
                return { text: "Provide 'code' for remove.", isError: true };
            }
            const result = removeEntry(registry, input.code);
            if (!result.ok) {
                return { text: result.error, isError: true };
            }
            saveRegistry(registryPath, registry);
            return { text: `Removed: ${input.code}` };
        }
        default:
            return { text: `Unknown action: ${input.action}`, isError: true };
    }
}
//# sourceMappingURL=registry.js.map