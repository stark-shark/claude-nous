export interface RegistryInput {
    action: "list" | "add" | "update" | "remove";
    code?: string;
    expansion?: string;
}
export interface RegistryResult {
    text: string;
    isError?: boolean;
}
export declare function handleRegistry(input: RegistryInput, memoryDir: string, registryFile: string): RegistryResult;
