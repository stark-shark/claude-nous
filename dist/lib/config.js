import * as fs from "node:fs";
export const DEFAULT_CONFIG = {
    maintainIndex: true,
    indexFile: "MEMORY.md",
    indexMaxLines: 200,
    registryFile: "REGISTRY.md",
    notationEnforcement: "warn",
    headerFields: {
        dates: true,
        accessCount: true,
        links: true,
    },
    healthChecks: {
        staleDays: 30,
        staleMinAccess: 2,
        compressionTolerancePct: 10,
    },
};
function stripJsoncComments(text) {
    return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
export function loadConfig(configPath) {
    if (!fs.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const stripped = stripJsoncComments(raw);
    const userConfig = JSON.parse(stripped);
    return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        headerFields: {
            ...DEFAULT_CONFIG.headerFields,
            ...(userConfig.headerFields ?? {}),
        },
        healthChecks: {
            ...DEFAULT_CONFIG.healthChecks,
            ...(userConfig.healthChecks ?? {}),
        },
    };
}
//# sourceMappingURL=config.js.map