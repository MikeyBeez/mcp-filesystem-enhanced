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

describe('edit_file correctness (regressions fixed 2026-08-17)', () => {
  test('an edit whose oldText is absent is an error, not a silent no-op', async () => {
    const before = fs.readFileSync(p('hello.txt'), 'utf8');
    const msg = await ctx.expectError('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'THIS TEXT IS NOT IN THE FILE', newText: 'anything' }],
    });
    assert.ok(msg, 'a missing oldText must surface as an error');
    assert.match(msg, /text not found/i);
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), before, 'the file must be left alone');
  });

  test('the error names the file and shows the text it looked for', async () => {
    const msg = await ctx.expectError('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'ABSENT MARKER', newText: 'x' }],
    });
    assert.match(msg, /hello\.txt/);
    assert.match(msg, /ABSENT MARKER/);
  });

  test('a long missing oldText is truncated in the error rather than dumped', async () => {
    const long = 'Z'.repeat(300);
    const msg = await ctx.expectError('edit_file', { path: p('hello.txt'), edits: [{ oldText: long, newText: 'x' }] });
    assert.ok(msg.length < 300, 'the error should not echo the whole search string');
    assert.match(msg, /\.\.\./);
  });

  test('an empty oldText is rejected instead of shredding the file', async () => {
    const before = fs.readFileSync(p('hello.txt'), 'utf8');
    const msg = await ctx.expectError('edit_file', { path: p('hello.txt'), edits: [{ oldText: '', newText: 'X' }] });
    assert.ok(msg, 'an empty oldText must be rejected');
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), before);
  });

  test('every occurrence is replaced, not just the first', async () => {
    fs.writeFileSync(p('dup.txt'), 'target\nmiddle\ntarget\nend\ntarget\n');
    await ctx.call('edit_file', { path: p('dup.txt'), edits: [{ oldText: 'target', newText: 'REPLACED' }] });
    assert.equal(fs.readFileSync(p('dup.txt'), 'utf8'), 'REPLACED\nmiddle\nREPLACED\nend\nREPLACED\n');
  });

  test('replacement text is inserted literally, not as a regex template', async () => {
    // '$&' and '$1' are substitution patterns to String.replace. Using
    // split/join means they land as plain characters.
    fs.writeFileSync(p('tpl.txt'), 'AAA\n');
    await ctx.call('edit_file', { path: p('tpl.txt'), edits: [{ oldText: 'AAA', newText: '$& and $1' }] });
    assert.equal(fs.readFileSync(p('tpl.txt'), 'utf8'), '$& and $1\n');
  });

  test('a failing edit aborts the batch and leaves earlier edits unwritten', async () => {
    const before = fs.readFileSync(p('hello.txt'), 'utf8');
    const msg = await ctx.expectError('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'line one', newText: 'GOOD' }, { oldText: 'NOT THERE', newText: 'bad' }],
    });
    assert.ok(msg);
    assert.equal(fs.readFileSync(p('hello.txt'), 'utf8'), before,
      'a partial write would be worse than no write');
  });

  test('dryRun still validates, so a preview of a bad edit fails too', async () => {
    const msg = await ctx.expectError('edit_file', {
      path: p('hello.txt'),
      edits: [{ oldText: 'NOT THERE', newText: 'x' }],
      dryRun: true,
    });
    assert.ok(msg, 'dryRun should report the same problem a real run would');
  });
});

describe('symlink containment (regression fixed 2026-08-17)', () => {
  test('a symlink inside the root cannot read a file outside it', async () => {
    fs.symlinkSync(path.join(ctx.outside, 'secret.txt'), p('escape.txt'));
    const msg = await ctx.expectError('read_text_file', { path: p('escape.txt') });
    assert.ok(msg, 'following a symlink out of the sandbox must be denied');
    assert.match(msg, /Access denied/);
  });

  test('a symlinked directory inside the root cannot be listed', async () => {
    fs.symlinkSync(ctx.outside, p('escape_dir'));
    const msg = await ctx.expectError('list_directory', { path: p('escape_dir') });
    assert.ok(msg);
    assert.match(msg, /Access denied/);
  });

  test('writing through a symlink that points outside is denied', async () => {
    const target = path.join(ctx.outside, 'planted-via-link.txt');
    fs.symlinkSync(target, p('write_escape.txt'));
    const msg = await ctx.expectError('write_file', { path: p('write_escape.txt'), content: 'nope' });
    assert.ok(msg);
    assert.equal(fs.existsSync(target), false, 'nothing may be created outside the root');
  });

  test('a symlink that stays inside the root still works', async () => {
    fs.symlinkSync(p('nested', 'inner.txt'), p('friendly.txt'));
    assert.equal(await ctx.call('read_text_file', { path: p('friendly.txt') }), 'inner content\n');
  });

  test('creating a new file in a real directory still works', async () => {
    // The allow-check has to handle paths that do not exist yet by resolving
    // the nearest existing ancestor. This is the guard on that logic.
    await ctx.call('write_file', { path: p('nested', 'deep', 'brand-new.txt'), content: 'ok\n' });
    assert.equal(fs.readFileSync(p('nested', 'deep', 'brand-new.txt'), 'utf8'), 'ok\n');
  });

  test('creating a file under a not-yet-existing directory chain is still allowed', async () => {
    await ctx.call('create_directory', { path: p('brand', 'new', 'chain') });
    await ctx.call('write_file', { path: p('brand', 'new', 'chain', 'f.txt'), content: 'deep\n' });
    assert.equal(fs.readFileSync(p('brand', 'new', 'chain', 'f.txt'), 'utf8'), 'deep\n');
  });
});

describe('move_file safety (regression fixed 2026-08-17)', () => {
  test('refuses to overwrite an existing destination', async () => {
    fs.writeFileSync(p('victim.txt'), 'important\n');
    const msg = await ctx.expectError('move_file', { source: p('hello.txt'), destination: p('victim.txt') });
    assert.ok(msg, 'an overwriting move must be refused');
    assert.match(msg, /already exists/i);
    assert.equal(fs.readFileSync(p('victim.txt'), 'utf8'), 'important\n', 'the victim must survive');
    assert.equal(fs.existsSync(p('hello.txt')), true, 'the source must survive too');
  });

  test('refuses to overwrite an existing directory', async () => {
    const msg = await ctx.expectError('move_file', { source: p('hello.txt'), destination: p('nested') });
    assert.ok(msg);
    assert.match(msg, /already exists/i);
  });
});
