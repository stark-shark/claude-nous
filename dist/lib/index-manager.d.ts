export interface IndexEntry {
    name: string;
    filename: string;
    description: string;
}
export declare function readIndex(indexPath: string): IndexEntry[];
export declare function upsertIndexEntry(indexPath: string, filename: string, name: string, description: string, maxLines: number): void;
export declare function removeIndexEntry(indexPath: string, filename: string): void;
