import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox, startServer, cleanup } from './helpers.mjs';

const TOOL_NAMES = [
  'read_file', 'read_text_file', 'read_media_file', 'read_multiple_files',
  'write_file', 'edit_file', 'create_directory', 'list_directory',
  'list_directory_with_sizes', 'directory_tree', 'move_file', 'search_files',
  'get_file_info', 'list_allowed_directories', 'help',
];

let ctx;
const p = (...parts) => path.join(ctx.root, ...parts);

before(async () => {
  const sandbox = makeSandbox();
  const server = await startServer(sandbox.root);
  ctx = { ...sandbox, ...server };
});

after(async () => {
  await ctx.client.close();
  cleanup(ctx.base);
});

// Each test starts from a known tree so ordering never matters.
beforeEach(() => {
  for (const e of fs.readdirSync(ctx.root)) {
    fs.rmSync(path.join(ctx.root, e), { recursive: true, force: true });
  }
  fs.writeFileSync(p('hello.txt'), 'line one\nline two\nline three\n');
  fs.mkdirSync(p('nested', 'deep'), { recursive: true });
  fs.writeFileSync(p('nested', 'inner.txt'), 'inner content\n');
  fs.writeFileSync(p('nested', 'deep', 'buried.md'), '# buried\n');
});

describe('tool registry', () => {
  test('advertises exactly the fifteen documented tools', async () => {
    const { tools } = await ctx.client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), [...TOOL_NAMES].sort());
  });

  test('every tool has a description', async () => {
    const { tools } = await ctx.client.listTools();
    for (const t of tools) assert.ok(t.description?.length > 5, `${t.name} needs a description`);
  });

  test('list_allowed_directories reports the sandbox and nothing else', async () => {
    const out = await ctx.call('list_allowed_directories');
    assert.equal(out.trim(), ctx.root);
  });
});

describe('the sandbox holds', () => {
  test('reading a file outside the allowed root is denied', async () => {
    const msg = await ctx.expectError('read_text_file', { path: path.join(ctx.outside, 'secret.txt') });
    assert.ok(msg, 'reading outside the root must not succeed');
    assert.match(msg, /Access denied/);
  });

  test('writing outside the allowed root is denied', async () => {
    const target = path.join(ctx.outside, 'planted.txt');
    const msg = await ctx.expectError('write_file', { path: target, content: 'should never land' });
    assert.ok(msg, 'writing outside the root must not succeed');
    assert.match(msg, /Access denied/);
    assert.equal(fs.existsSync(target), false, 'no file may be created outside the root');
  });

  test('a ../ traversal out of the root is denied', async () => {
    const msg = await ctx.expectError('read_text_file', { path: p('..', 'outside', 'secret.txt') });
    assert.ok(msg);
    assert.match(msg, /Access denied/);
  });

  test('a path that merely shares a prefix with the root is denied', async () => {
    // /tmp/xxx/sandbox-evil must not be accepted just because it starts with
    // the string /tmp/xxx/sandbox.
    const sibling = ctx.root + '-evil';
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'x.txt'), 'nope');
    const msg = await ctx.expectError('read_text_file', { path: path.join(sibling, 'x.txt') });
    fs.rmSync(sibling, { recursive: true, force: true });
    assert.ok(msg, 'prefix-sharing sibling directories must be denied');
    assert.match(msg, /Access denied/);
  });

  test('moving a file out of the root is denied', async () => {
    const msg = await ctx.expectError('move_file', {
      source: p('hello.txt'),
      destination: path.join(ctx.outside, 'stolen.txt'),
    });
    assert.ok(msg);
    assert.match(msg, /Access denied/);
    assert.equal(fs.existsSync(p('hello.txt')), true, 'the source must be left alone');
  });
});

describe('read_text_file / read_file', () => {
  test('returns the whole file', async () => {
    assert.equal(await ctx.call('read_text_file', { path: p('hello.txt') }), 'line one\nline two\nline three\n');
  });

  test('head returns the first n lines', async () => {
    assert.equal(await ctx.call('read_text_file', { path: p('hello.txt'), head: 2 }), 'line one\nline two');
  });

  test('tail returns the last n lines', async () => {
    assert.equal(await ctx.call('read_text_file', { path: p('hello.txt'), tail: 2 }), 'line three\n');
  });

  test('read_file behaves the same as read_text_file', async () => {
    const a = await ctx.call('read_file', { path: p('hello.txt') });
    const b = await ctx.call('read_text_file', { path: p('hello.txt') });
    assert.equal(a, b);
  });

  test('a missing file is an error, not empty content', async () => {
    const msg = await ctx.expectError('read_text_file', { path: p('does-not-exist.txt') });
    assert.ok(msg, 'reading a missing file must report an error');
    assert.match(msg, /ENOENT|no such file/i);
  });
});

describe('read_multiple_files', () => {
  test('reads several files at once', async () => {
    const out = await ctx.call('read_multiple_files', { paths: [p('hello.txt'), p('nested', 'inner.txt')] });
    assert.match(out, /line one/);
    assert.match(out, /inner content/);
  });

  test('one bad path does not sink the whole batch', async () => {
    const out = await ctx.call('read_multiple_files', {
      paths: [p('hello.txt'), path.join(ctx.outside, 'secret.txt')],
    });
    assert.match(out, /line one/, 'the readable file should still come back');
    assert.doesNotMatch(out, /TOP SECRET/, 'the denied file must not leak its contents');
  });
});

describe('write_file', () => {
  test('creates a new file', async () => {
    await ctx.call('write_file', { path: p('created.txt'), content: 'fresh\n' });
    assert.equal(fs.readFileSync(p('created.txt'), 'utf8'), 'fresh\n');
  });

  test('overwrites an existing file', async () => {
    await ctx.call('write_file', { path: p('hello.txt'), content: 'replaced\n' });
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), 'replaced\n');
  });

  test('reports the path it wrote', async () => {
    const out = await ctx.call('write_file', { path: p('reported.txt'), content: 'x' });
    assert.match(out, /Successfully wrote/);
    assert.match(out, /reported\.txt/);
  });
});

describe('edit_file', () => {
  test('applies an edit and persists it', async () => {
    await ctx.call('edit_file', { path: p('hello.txt'), edits: [{ oldText: 'line two', newText: 'LINE TWO' }] });
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), 'line one\nLINE TWO\nline three\n');
  });

  test('dryRun previews without touching the file', async () => {
    const before = fs.readFileSync(p('hello.txt'), 'utf8');
    const out = await ctx.call('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'line one', newText: 'CHANGED' }],
      dryRun: true,
    });
    assert.match(out, /^Preview:/);
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), before, 'dryRun must not write');
  });

  test('applies several edits in order', async () => {
    await ctx.call('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'line one', newText: 'A' }, { oldText: 'line three', newText: 'C' }],
    });
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), 'A\nline two\nC\n');
  });
});

describe('create_directory, list_directory, directory_tree', () => {
  test('creates nested directories in one call', async () => {
    await ctx.call('create_directory', { path: p('a', 'b', 'c') });
    assert.equal(fs.statSync(p('a', 'b', 'c')).isDirectory(), true);
  });

  test('creating a directory that already exists is not an error', async () => {
    const out = await ctx.call('create_directory', { path: p('nested') });
    assert.match(out, /Successfully created/);
  });

  test('list_directory tags entries as FILE or DIR', async () => {
    const out = await ctx.call('list_directory', { path: ctx.root });
    assert.match(out, /\[FILE\] hello\.txt/);
    assert.match(out, /\[DIR\] nested/);
  });

  test('list_directory_with_sizes shows a human size for files', async () => {
    const out = await ctx.call('list_directory_with_sizes', { path: ctx.root });
    assert.match(out, /\[FILE\] hello\.txt \(/);
  });

  test('list_directory_with_sizes can sort by size', async () => {
    fs.writeFileSync(p('big.txt'), 'x'.repeat(5000));
    const out = await ctx.call('list_directory_with_sizes', { path: ctx.root, sortBy: 'size' });
    const names = out.split('\n').map(l => l.replace(/^\[\w+\] /, '').split(' (')[0]);
    assert.equal(names[0], 'big.txt', 'the largest file should come first');
  });

  test('directory_tree returns nested JSON', async () => {
    const tree = await ctx.json('directory_tree', { path: ctx.root });
    const findNode = (node, name) => {
      if (node.name === name) return node;
      for (const c of node.children ?? []) { const f = findNode(c, name); if (f) return f; }
      return null;
    };
    const root = Array.isArray(tree) ? { children: tree } : tree;
    assert.ok(findNode(root, 'buried.md'), 'the tree must reach nested/deep/buried.md');
  });
});

describe('move_file', () => {
  test('renames a file inside the root', async () => {
    await ctx.call('move_file', { source: p('hello.txt'), destination: p('moved.txt') });
    assert.equal(fs.existsSync(p('hello.txt')), false);
    assert.equal(fs.readFileSync(p('moved.txt'), 'utf8'), 'line one\nline two\nline three\n');
  });

  test('moves a file into a subdirectory', async () => {
    await ctx.call('move_file', { source: p('hello.txt'), destination: p('nested', 'hello.txt') });
    assert.equal(fs.existsSync(p('nested', 'hello.txt')), true);
  });

  test('moving something that does not exist is an error', async () => {
    const msg = await ctx.expectError('move_file', { source: p('ghost.txt'), destination: p('x.txt') });
    assert.ok(msg);
  });
});

describe('search_files', () => {
  test('finds a file by pattern anywhere under the path', async () => {
    const out = await ctx.call('search_files', { path: ctx.root, pattern: 'buried' });
    assert.match(out, /buried\.md/);
  });

  test('honours excludePatterns', async () => {
    const out = await ctx.call('search_files', { path: ctx.root, pattern: 'txt', excludePatterns: ['nested'] });
    assert.doesNotMatch(out, /inner\.txt/, 'entries under an excluded directory must not appear');
  });

  test('a pattern that matches nothing returns empty, not an error', async () => {
    const out = await ctx.call('search_files', { path: ctx.root, pattern: 'zzzznotpresentzzz' });
    assert.equal(out.trim(), '');
  });
});

describe('get_file_info', () => {
  test('reports size and type for a file', async () => {
    const info = await ctx.json('get_file_info', { path: p('hello.txt') });
    assert.equal(info.type, 'file');
    assert.equal(info.size, fs.statSync(p('hello.txt')).size);
    assert.equal(info.name, 'hello.txt');
    assert.match(info.permissions, /^0[0-7]{3}$/);
  });

  test('reports directory for a directory', async () => {
    const info = await ctx.json('get_file_info', { path: p('nested') });
    assert.equal(info.type, 'directory');
  });

  test('timestamps are ISO strings', async () => {
    const info = await ctx.json('get_file_info', { path: p('hello.txt') });
    for (const k of ['created', 'modified', 'accessed']) {
      assert.ok(!Number.isNaN(Date.parse(info[k])), `${k} should parse as a date`);
    }
  });
});

describe('known issues', () => {
  // edit_file uses String.prototype.replace with a plain string, which replaces
  // only the FIRST occurrence and — worse — silently succeeds when the text is
  // not present at all. An agent that asks for an edit and gets "Applied
  // changes" back has no way to tell the edit did nothing.
  test('an edit whose oldText is absent should report a failure', { todo: true }, async () => {
    const before = fs.readFileSync(p('hello.txt'), 'utf8');
    const out = await ctx.call('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'THIS TEXT IS NOT IN THE FILE', newText: 'anything' }],
    });
    const after = fs.readFileSync(p('hello.txt'), 'utf8');
    assert.equal(after, before, 'nothing changed, as expected');
    assert.doesNotMatch(out, /Applied changes/,
      'a no-op edit reports success, so a failed edit is indistinguishable from a real one');
  });

  test('an edit should replace every occurrence, or say it did not', { todo: true }, async () => {
    fs.writeFileSync(p('dup.txt'), 'target\nmiddle\ntarget\n');
    await ctx.call('edit_file', { path: p('dup.txt'), edits: [{ oldText: 'target', newText: 'REPLACED' }] });
    assert.equal(fs.readFileSync(p('dup.txt'), 'utf8'), 'REPLACED\nmiddle\nREPLACED\n',
      'only the first occurrence is replaced, with no warning');
  });

  // isPathAllowed resolves and normalises the string but never calls realpath,
  // so a symlink living inside the sandbox and pointing outside it passes the
  // check, and the filesystem call then follows the link.
  test('a symlink inside the root must not reach outside it', { todo: true }, async () => {
    fs.symlinkSync(path.join(ctx.outside, 'secret.txt'), p('escape.txt'));
    const msg = await ctx.expectError('read_text_file', { path: p('escape.txt') });
    assert.ok(msg, 'following a symlink out of the sandbox should be denied');
  });

  // fs.rename overwrites silently.
  test('move_file should not clobber an existing destination', { todo: true }, async () => {
    fs.writeFileSync(p('victim.txt'), 'important\n');
    const msg = await ctx.expectError('move_file', { source: p('hello.txt'), destination: p('victim.txt') });
    assert.ok(msg, 'overwriting an existing file via move should require an explicit flag');
  });
});
