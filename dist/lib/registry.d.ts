export type Registry = Map<string, string>;
export interface RegistryResult {
    ok: boolean;
    error?: string;
}
export declare function loadRegistry(registryPath: string): Registry;
export declare function saveRegistry(registryPath: string, registry: Registry): void;
export declare function addEntry(registry: Registry, code: string, expansion: string): RegistryResult;
export declare function removeEntry(registry: Registry, code: string): RegistryResult;
export declare function findUnknownEntities(content: string, registry: Registry): string[];
