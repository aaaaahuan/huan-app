import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { prepareRoads } from '../overlays/roads';

test('prepareRoads warns and skips layer instead of throwing on overflow', async () => {
  process.env.HUAN_TERRAIN_ROADS_FLOAT_LIMIT = '1000';
  const root = join(tmpdir(), `terrain-roads-${Date.now()}`);
  const job = join(root, 'jobs', '20261027-120000-abcdef0123');
  await mkdir(join(job, 'web', 'layers'), { recursive: true });
  await mkdir(join(job, 'data'), { recursive: true });
  const warnings: string[] = [];
  const geographic: [number, number, number, number] = [119, 29, 122, 32];
  const projected: [number, number, number, number] = [210000, 3320000, 310000, 3330000];
  const result = await prepareRoads(root, job, geographic, projected, 51, false, 1, warnings);
  assert.equal(result.count, 0);
  assert.deepEqual(result.groups, {});
  assert.ok(warnings.some(w => w.includes('道路预览超过安全上限')), warnings.join(' | '));
  delete process.env.HUAN_TERRAIN_ROADS_FLOAT_LIMIT;
  await rm(root, { recursive: true, force: true });
});
