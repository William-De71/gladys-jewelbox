// The files of /data: written atomically, readable by the container user only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '../src/storage.js';

test('read, write (mode 600, no temporary file left), delete, unreadable = null', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jewelbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = createStorage(join(dir, 'data'));
  assert.equal(await storage.read('usage.json'), null);
  await storage.write('usage.json', { day: '2026-10-24', count: 3 });
  assert.deepEqual(await storage.read('usage.json'), { day: '2026-10-24', count: 3 });
  assert.deepEqual(await readdir(join(dir, 'data')), ['usage.json']);
  assert.equal((await stat(join(dir, 'data', 'usage.json'))).mode & 0o777, 0o600);
  await writeFile(join(dir, 'data', 'broken.json'), '{nope');
  assert.equal(await storage.read('broken.json'), null);
  await storage.write('usage.json', null);
  assert.equal(await storage.read('usage.json'), null);
});
