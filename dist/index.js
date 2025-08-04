#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
// Get allowed directories from command line
const allowedDirectories = process.argv.slice(2);
if (allowedDirectories.length === 0) {
    console.error("Usage: mcp-filesystem-enhanced [allowed-directory] [additional-directories...]");
    process.exit(1);
}
// Validate and resolve directories
const validDirectories = [];
for (const dir of allowedDirectories) {
    try {
        const resolved = path.resolve(dir);
        const stats = await fs.stat(resolved);
        if (stats.isDirectory()) {
            validDirectories.push(resolved);
        }
    }
    catch (error) {
        console.error(`Warning: Cannot access ${dir}, skipping`);
    }
}
if (validDirectories.length === 0) {
    console.error("No valid directories provided");
    process.exit(1);
}
console.error("Allowed directories:", validDirectories);
// Helper to validate paths
function isPathAllowed(requestPath) {
    const absolute = path.resolve(requestPath);
    const normalized = path.normalize(absolute);
    return validDirectories.some(dir => normalized.startsWith(dir + path.sep) || normalized === dir);
}
// Bullshit detector integration
const evidenceMarkers = [
    /\b(\d+:\d+|\d+\.\d+\s+vs\s+\d+\.\d+|\d+%\s+\w+\s+savings|\d+%\s+improvement)\b/gi,
    /\b(experimental results|test results|validation results|research data|benchmark data|peer.reviewed)\b/gi,
    /\b(according to|based on|from study|source:|citation|paper shows|research shows|study found)\b/gi,
    /\b(github\.com|repository|implementation|codebase|algorithm|peer.reviewed|published in)\b/gi,
    /\b(experiment|validation|test|measurement|benchmark)\s+(achieved|showed|demonstrated|found)\b/gi
];
const qualificationMarkers = [
    /\b(appears?|seems?|likely|potentially|may|might|could|possibly|probably|suggests?|indicates?)\b/gi,
    /\b(preliminary|initial|experimental|prototype|alpha|beta|draft|working|tentative)\b/gi,
    /\b(in our tests|in this experiment|our results suggest|evidence suggests|data indicates)\b/gi
];
function shouldSuggestBullshitDetection(content) {
    const hasKeywords = /\b(breakthrough|revolutionary|guaranteed|definitely|absolutely|best|perfect|amazing|incredible|phenomenal|outstanding|remarkable|extraordinary|unparalleled|world-class|cutting-edge|game-changing)\b/i.test(content);
    const isLong = content.length > 200;
    return hasKeywords || isLong;
}
function hasNearbyEvidence(text, position, radius) {
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    const contextText = text.substring(start, end);
    return evidenceMarkers.some(marker => {
        marker.lastIndex = 0;
        return marker.test(contextText);
    });
}
// Helper functions
function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}
function generateDiff(original, modified) {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    // Simple diff - just show changes
    let diff = '';
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLines; i++) {
        const originalLine = originalLines[i] || '';
        const modifiedLine = modifiedLines[i] || '';
        if (originalLine !== modifiedLine) {
            if (originalLine)
                diff += `- ${originalLine}\n`;
            if (modifiedLine)
                diff += `+ ${modifiedLine}\n`;
        }
    }
    return diff || 'No changes detected';
}
async function buildDirectoryTree(dirPath) {
    const stats = await fs.stat(dirPath);
    const name = path.basename(dirPath);
    if (!stats.isDirectory()) {
        return {
            name,
            type: 'file'
        };
    }
    const children = [];
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const childPath = path.join(dirPath, entry.name);
            if (isPathAllowed(childPath)) {
                const child = await buildDirectoryTree(childPath);
                children.push(child);
            }
        }
    }
    catch (error) {
        // Directory not readable
    }
    return {
        name,
        type: 'directory',
        children
    };
}
async function searchFiles(searchPath, pattern, excludePatterns) {
    const results = [];
    const searchPattern = new RegExp(pattern, 'i');
    const excludeRegexes = excludePatterns.map(p => new RegExp(p, 'i'));
    // Try locate first (much faster), fall back to manual search
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        // Use locate for faster searching if available
        const locateCommand = `locate -i "*${pattern}*" 2>/dev/null | head -1000`;
        const { stdout } = await execAsync(locateCommand);
        if (stdout.trim()) {
            const locateResults = stdout.trim().split('\n');
            for (const result of locateResults) {
                // Check if path is within allowed directories
                if (!isPathAllowed(result))
                    continue;
                // Check if path starts with our search path
                if (!result.startsWith(searchPath))
                    continue;
                // Check exclude patterns
                const fileName = path.basename(result);
                if (excludeRegexes.some(regex => regex.test(fileName)))
                    continue;
                results.push(result);
            }
            // If locate found results, return them
            if (results.length > 0) {
                return results;
            }
        }
    }
    catch (error) {
        // locate not available or failed, fall back to manual search
    }
    // Fallback: Manual recursive search
    async function search(currentPath) {
        try {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (!isPathAllowed(fullPath))
                    continue;
                // Check exclude patterns
                if (excludeRegexes.some(regex => regex.test(entry.name)))
                    continue;
                if (searchPattern.test(entry.name)) {
                    results.push(fullPath);
                }
                if (entry.isDirectory()) {
                    await search(fullPath);
                }
            }
        }
        catch (error) {
            // Directory not readable, skip
        }
    }
    await search(searchPath);
    return results;
}
// Create server
const server = new Server({
    name: "filesystem-enhanced",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Define schemas
const ReadFileArgsSchema = z.object({
    path: z.string(),
    head: z.number().optional(),
    tail: z.number().optional(),
});
const ReadTextFileArgsSchema = z.object({
    path: z.string(),
    head: z.number().optional(),
    tail: z.number().optional(),
});
const ReadMediaFileArgsSchema = z.object({
    path: z.string(),
});
const ReadMultipleFilesArgsSchema = z.object({
    paths: z.array(z.string()),
});
const WriteFileArgsSchema = z.object({
    path: z.string(),
    content: z.string(),
});
const EditFileArgsSchema = z.object({
    path: z.string(),
    edits: z.array(z.object({
        oldText: z.string(),
        newText: z.string(),
    })),
    dryRun: z.boolean().default(false),
});
const CreateDirectoryArgsSchema = z.object({
    path: z.string(),
});
const ListDirectoryArgsSchema = z.object({
    path: z.string(),
});
const ListDirectoryWithSizesArgsSchema = z.object({
    path: z.string(),
    sortBy: z.enum(["name", "size"]).default("name"),
});
const DirectoryTreeArgsSchema = z.object({
    path: z.string(),
});
const MoveFileArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
});
const SearchFilesArgsSchema = z.object({
    path: z.string(),
    pattern: z.string(),
    excludePatterns: z.array(z.string()).default([]),
});
const GetFileInfoArgsSchema = z.object({
    path: z.string(),
});
// Register tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_file",
                description: "Read the contents of a file",
                inputSchema: zodToJsonSchema(ReadFileArgsSchema),
            },
            {
                name: "read_text_file",
                description: "Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ReadTextFileArgsSchema),
            },
            {
                name: "read_media_file",
                description: "Read an image or audio file. Returns the base64 encoded data and MIME type. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ReadMediaFileArgsSchema),
            },
            {
                name: "read_multiple_files",
                description: "Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file's content is returned with its path as a reference. Failed reads for individual files won't stop the entire operation. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema),
            },
            {
                name: "write_file",
                description: "Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories. ✨ ENHANCED: Automatically provides gentle bullshit detector suggestions for marketing language, long content, or potentially problematic text to improve content quality and credibility.",
                inputSchema: zodToJsonSchema(WriteFileArgsSchema),
            },
            {
                name: "edit_file",
                description: "Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(EditFileArgsSchema),
            },
            {
                name: "create_directory",
                description: "Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema),
            },
            {
                name: "list_directory",
                description: "Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ListDirectoryArgsSchema),
            },
            {
                name: "list_directory_with_sizes",
                description: "Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ListDirectoryWithSizesArgsSchema),
            },
            {
                name: "directory_tree",
                description: "Get a recursive tree view of files and directories as a JSON structure. Each entry includes 'name', 'type' (file/directory), and 'children' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema),
            },
            {
                name: "move_file",
                description: "Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.",
                inputSchema: zodToJsonSchema(MoveFileArgsSchema),
            },
            {
                name: "search_files",
                description: "Recursively search for files and directories matching a pattern. Searches through all subdirectories from the starting path. The search is case-insensitive and matches partial names. Returns full paths to all matching items. Great for finding files when you don't know their exact location. Only searches within allowed directories. ✨ ENHANCED: Uses 'locate' command when available for dramatically faster search performance (up to 1000x faster than recursive directory traversal).",
                inputSchema: zodToJsonSchema(SearchFilesArgsSchema),
            },
            {
                name: "get_file_info",
                description: "Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(GetFileInfoArgsSchema),
            },
            {
                name: "list_allowed_directories",
                description: "Returns the list of root directories that this server is allowed to access. Use this to understand which directories are available before trying to access files.",
                inputSchema: zodToJsonSchema(z.object({})),
            },
        ],
    };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case "read_file": {
            const { path: filePath, head, tail } = ReadFileArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            let content = await fs.readFile(filePath, "utf-8");
            if (head !== undefined) {
                const lines = content.split('\n');
                content = lines.slice(0, head).join('\n');
            }
            else if (tail !== undefined) {
                const lines = content.split('\n');
                content = lines.slice(-tail).join('\n');
            }
            return {
                content: [{ type: "text", text: content }],
            };
        }
        case "read_text_file": {
            const { path: filePath, head, tail } = ReadTextFileArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            let content = await fs.readFile(filePath, "utf-8");
            if (head !== undefined) {
                const lines = content.split('\n');
                content = lines.slice(0, head).join('\n');
            }
            else if (tail !== undefined) {
                const lines = content.split('\n');
                content = lines.slice(-tail).join('\n');
            }
            return {
                content: [{ type: "text", text: content }],
            };
        }
        case "read_media_file": {
            const { path: filePath } = ReadMediaFileArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            const buffer = await fs.readFile(filePath);
            const base64Data = buffer.toString('base64');
            // Determine MIME type based on extension
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.ogg': 'audio/ogg',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
            };
            const mimeType = mimeTypes[ext] || 'application/octet-stream';
            return {
                content: [{
                        type: "text",
                        text: `Data: ${base64Data}\nMIME Type: ${mimeType}`
                    }],
            };
        }
        case "read_multiple_files": {
            const { paths } = ReadMultipleFilesArgsSchema.parse(args);
            const results = [];
            for (const filePath of paths) {
                try {
                    if (!isPathAllowed(filePath)) {
                        results.push({
                            path: filePath,
                            error: "Access denied",
                            content: null
                        });
                        continue;
                    }
                    const content = await fs.readFile(filePath, "utf-8");
                    results.push({
                        path: filePath,
                        content: content,
                        error: null
                    });
                }
                catch (error) {
                    results.push({
                        path: filePath,
                        error: error instanceof Error ? error.message : String(error),
                        content: null
                    });
                }
            }
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            };
        }
        case "write_file": {
            const { path: filePath, content } = WriteFileArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            await fs.writeFile(filePath, content, "utf-8");
            // 🎯 ENHANCED: Check if content might benefit from bullshit detection
            let message = `Successfully wrote to ${filePath}`;
            if (shouldSuggestBullshitDetection(content)) {
                message += "\n\n💡 Consider running the bullshit detector on this content to ensure clarity and credibility:\n   bullshit-detector:detect_bullshit";
            }
            return {
                content: [{ type: "text", text: message }],
            };
        }
        case "edit_file": {
            const { path: filePath, edits, dryRun } = EditFileArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            let content = await fs.readFile(filePath, "utf-8");
            const originalContent = content;
            // Apply edits
            for (const edit of edits) {
                content = content.replace(edit.oldText, edit.newText);
            }
            if (!dryRun) {
                await fs.writeFile(filePath, content, "utf-8");
            }
            // Generate diff-style output
            const diff = generateDiff(originalContent, content);
            return {
                content: [{ type: "text", text: dryRun ? `Preview:\n${diff}` : `Applied changes:\n${diff}` }],
            };
        }
        case "create_directory": {
            const { path: dirPath } = CreateDirectoryArgsSchema.parse(args);
            if (!isPathAllowed(dirPath)) {
                throw new Error(`Access denied: ${dirPath}`);
            }
            await fs.mkdir(dirPath, { recursive: true });
            return {
                content: [{ type: "text", text: `Successfully created directory: ${dirPath}` }],
            };
        }
        case "list_directory": {
            const { path: dirPath } = ListDirectoryArgsSchema.parse(args);
            if (!isPathAllowed(dirPath)) {
                throw new Error(`Access denied: ${dirPath}`);
            }
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const formatted = entries
                .map(entry => `[${entry.isDirectory() ? 'DIR' : 'FILE'}] ${entry.name}`)
                .join('\n');
            return {
                content: [{ type: "text", text: formatted }],
            };
        }
        case "list_directory_with_sizes": {
            const { path: dirPath, sortBy } = ListDirectoryWithSizesArgsSchema.parse(args);
            if (!isPathAllowed(dirPath)) {
                throw new Error(`Access denied: ${dirPath}`);
            }
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const entriesWithSizes = [];
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                try {
                    const stats = await fs.stat(fullPath);
                    entriesWithSizes.push({
                        name: entry.name,
                        type: entry.isDirectory() ? 'DIR' : 'FILE',
                        size: entry.isDirectory() ? 0 : stats.size,
                    });
                }
                catch (error) {
                    entriesWithSizes.push({
                        name: entry.name,
                        type: entry.isDirectory() ? 'DIR' : 'FILE',
                        size: 0,
                    });
                }
            }
            // Sort entries
            if (sortBy === 'size') {
                entriesWithSizes.sort((a, b) => b.size - a.size);
            }
            else {
                entriesWithSizes.sort((a, b) => a.name.localeCompare(b.name));
            }
            const formatted = entriesWithSizes
                .map(entry => `[${entry.type}] ${entry.name}${entry.type === 'FILE' ? ` (${formatFileSize(entry.size)})` : ''}`)
                .join('\n');
            return {
                content: [{ type: "text", text: formatted }],
            };
        }
        case "directory_tree": {
            const { path: dirPath } = DirectoryTreeArgsSchema.parse(args);
            if (!isPathAllowed(dirPath)) {
                throw new Error(`Access denied: ${dirPath}`);
            }
            const tree = await buildDirectoryTree(dirPath);
            return {
                content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
            };
        }
        case "move_file": {
            const { source, destination } = MoveFileArgsSchema.parse(args);
            if (!isPathAllowed(source) || !isPathAllowed(destination)) {
                throw new Error(`Access denied: ${source} -> ${destination}`);
            }
            await fs.rename(source, destination);
            return {
                content: [{ type: "text", text: `Successfully moved ${source} to ${destination}` }],
            };
        }
        case "search_files": {
            const { path: searchPath, pattern, excludePatterns } = SearchFilesArgsSchema.parse(args);
            if (!isPathAllowed(searchPath)) {
                throw new Error(`Access denied: ${searchPath}`);
            }
            const results = await searchFiles(searchPath, pattern, excludePatterns);
            return {
                content: [{ type: "text", text: results.join('\n') }],
            };
        }
        case "get_file_info": {
            const { path: filePath } = GetFileInfoArgsSchema.parse(args);
            if (!isPathAllowed(filePath)) {
                throw new Error(`Access denied: ${filePath}`);
            }
            const stats = await fs.stat(filePath);
            const info = {
                path: filePath,
                name: path.basename(filePath),
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                accessed: stats.atime.toISOString(),
                permissions: '0' + (stats.mode & parseInt('777', 8)).toString(8),
            };
            return {
                content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
            };
        }
        case "list_allowed_directories": {
            return {
                content: [{ type: "text", text: validDirectories.join('\n') }],
            };
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});
// Start server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Enhanced filesystem server running on stdio");
}
runServer().catch(console.error);
//# sourceMappingURL=index.js.map