export interface RecallConfig {
    maintainIndex: boolean;
    indexFile: string;
    indexMaxLines: number;
    registryFile: string;
    notationEnforcement: "strict" | "warn" | "off";
    headerFields: {
        dates: boolean;
        accessCount: boolean;
        links: boolean;
    };
    healthChecks: {
        staleDays: number;
        staleMinAccess: number;
        compressionTolerancePct: number;
    };
}
export declare const DEFAULT_CONFIG: RecallConfig;
export declare function loadConfig(configPath: string): RecallConfig;
