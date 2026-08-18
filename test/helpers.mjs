// Test harness for mcp-filesystem-enhanced.
//
// The server takes its allowed directories from argv, so every test run gets a
// throwaway sandbox directory as its ONLY allowed root. Nothing under
// /Users/bard is reachable from a test, which matters here more than anywhere
// else — this is the server that writes to the real filesystem.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');

// Two directories: the sandbox the server is allowed to touch, and an
// "outside" directory it must never reach. macOS puts temp dirs under a
// symlinked /var, so realpath both — otherwise the allow-check compares
// /var/... against /private/var/... and every test looks denied.
export function makeSandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-enh-test-')));
  const root = path.join(base, 'sandbox');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET — must never be readable\n');
  return { base, root, outside };
}

export async function startServer(root) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, 'dist', 'index.js'), root],
    cwd: REPO,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'fs-enhanced-tests', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Text of a successful call.
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`tool ${name} errored: ${r.content?.[0]?.text}`);
    return r.content[0].text;
  };
  const json = async (name, args = {}) => JSON.parse(await call(name, args));

  // The handlers throw on a denied path. Depending on SDK version that surfaces
  // either as a rejected promise or as an isError result, so normalise both
  // into a single string a test can match against.
  const expectError = async (name, args = {}) => {
    try {
      const r = await client.callTool({ name, arguments: args });
      if (r.isError) return r.content?.[0]?.text ?? '';
      return null; // no error at all — the caller asserts on this
    } catch (e) {
      return e.message;
    }
  };

  return { client, call, json, expectError };
}

export function cleanup(base) {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
}
