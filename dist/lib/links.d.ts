export interface LinkMaintenanceResult {
    crossProject: string[];
}
export declare function ensureBidirectionalLinks(sourceMemory: string, targetLinks: string[], memoryDir: string): LinkMaintenanceResult;
