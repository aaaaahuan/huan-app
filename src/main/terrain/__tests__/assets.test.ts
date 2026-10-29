import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { resolveJobAsset, resolveJobFile, resolveJobPath } from '../assets';
import { terrainJobIdSchema } from '@shared/contracts/terrain';

const id = '20261027-120000-abcdef0123';

async function fixture() {
  const root = join(tmpdir(), `terrain-assets-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(root, 'jobs', id, 'models'), { recursive: true });
  await mkdir(join(root, 'jobs', id, 'web'), { recursive: true });
  await writeFile(join(root, 'jobs', id, 'status.json'), JSON.stringify({
    id, filename: 't.kml', input_file: 'input.kml', status: 'completed', started_at: 1,
    stages: [], preview_url: `/jobs/${id}/web/`, error: null, origin: 'native'
  }));
  await writeFile(join(root, 'jobs', id, 'models', 'terrain.stl'), Buffer.alloc(84));
  await writeFile(join(root, 'outside.txt'), 'nope');
  return root;
}

test('job id Zod rejects invalid ids', () => {
  assert.throws(() => terrainJobIdSchema.parse('bad'));
  assert.throws(() => terrainJobIdSchema.parse('../escape'));
  assert.equal(terrainJobIdSchema.parse(id), id);
});

test('resolveJobPath rejects traversal and missing jobs', async () => {
  const root = await fixture();
  try {
    await assert.rejects(() => resolveJobPath(root, '../' + id));
    await assert.rejects(() => resolveJobPath(root, 'not-a-valid-id'));
    const job = await resolveJobPath(root, id);
    assert.ok(job.endsWith(id));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resolveJobFile / resolveJobAsset reject path escape and symlink escape', async () => {
  const root = await fixture();
  try {
    await assert.rejects(() => resolveJobFile(root, id, ['..', 'outside.txt']));
    await assert.rejects(() => resolveJobFile(root, id, ['models', '..', '..', 'outside.txt']));
    await symlink(join(root, 'outside.txt'), join(root, 'jobs', id, 'models', 'escape.stl'));
    await assert.rejects(() => resolveJobFile(root, id, ['models', 'escape.stl']));
    const stl = await resolveJobAsset(root, id, 'models', 'terrain.stl');
    assert.ok(stl.endsWith('terrain.stl'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resolveJobAsset requires completed status', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'jobs', id, 'status.json'), JSON.stringify({
      id, filename: 't.kml', input_file: 'input.kml', status: 'failed', started_at: 1,
      stages: [], preview_url: `/jobs/${id}/web/`, error: 'x', origin: 'native'
    }));
    await assert.rejects(() => resolveJobAsset(root, id, 'models', 'terrain.stl'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
