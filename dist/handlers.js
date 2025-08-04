"use strict";
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
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
            // Enhanced: Check if content might benefit from bullshit detection
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
// Start server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Enhanced filesystem server running on stdio");
}
runServer().catch(console.error);
//# sourceMappingURL=handlers.js.map