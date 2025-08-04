declare function formatFileSize(bytes: number): string;
declare function generateDiff(original: string, modified: string): string;
declare function buildDirectoryTree(dirPath: string): Promise<any>;
declare function searchFiles(searchPath: string, pattern: string, excludePatterns: string[]): Promise<string[]>;
declare function runServer(): Promise<void>;
//# sourceMappingURL=handlers.d.ts.map