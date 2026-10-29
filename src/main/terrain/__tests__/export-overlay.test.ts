import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { exportTerrain } from '../pipeline/export';
import { Progress, pendingStages, directory, writeJson, writeBytes } from '../pipeline/state';
import { packagePreview } from '../pipeline/preview';
import { resolveJobAsset } from '../assets';
import { readFile } from 'node:fs/promises';
import type { HeightGrid } from '../geometry/terrain';
import type { SurfaceLayers } from '../geometry/features';

// Closed triangular prism (two triangles top/bottom + quads as tris) with consistent CCW outward winding when viewed from outside is tricky;
// use a unit tetrahedron which is always watertight with consistent winding.
function tetMesh() {
  const vertices = new Float32Array([
    0, 0, 0,
    10, 0, 0,
    5, 10, 0,
    5, 3, 10
  ]);
  // outward winding for tetrahedron
  const triangles = new Uint32Array([
    0, 2, 1,
    0, 1, 3,
    1, 2, 3,
    2, 0, 3
  ]);
  return { vertices, triangles, materials: new Uint32Array(triangles.length / 3), volume: 1 };
}

test('export then overlay failure still completes and STL resolves', async () => {
  const id = '20261027-130000-abcdef0123';
  const root = join(tmpdir(), `terrain-export-ov-${Date.now()}`);
  const job = join(root, 'jobs', id);
  await directory(join(root, 'jobs'));
  await directory(job);
  await directory(join(job, 'data'));
  await directory(join(job, 'web'));
  const state = {
    id, filename: 't.kml', input_file: 'input.kml' as const, status: 'running' as const,
    started_at: Date.now() / 1000, stages: pendingStages(), preview_url: `/jobs/${id}/web/`,
    error: null, origin: 'native'
  };
  const progress = new Progress(job, state);
  await progress.save();
  const mesh = tetMesh();
  const validation = await exportTerrain(job, mesh);
  assert.equal(validation.watertight, true);
  const warnings: string[] = [];
  const width = 3, height = 3;
  const grid = {
    width, height, size: [10, 10] as [number, number], scale: 1, base: 2, exaggeration: 1,
    elevations: new Float32Array(width * height)
  } satisfies HeightGrid;
  const layers = {
    base: new Float32Array(width * height).fill(2),
    z: new Float32Array(width * height).fill(2),
    distance: new Float32Array(width * height).fill(10),
    classes: new Uint8Array(width * height),
    water: new Float32Array(width * height),
    forest: new Float32Array(width * height),
    routeGap: new Uint8Array(width * height),
    report: {},
    distanceAt: () => 10
  } as unknown as SurfaceLayers;
  try {
    await packagePreview(job, grid, mesh, layers, { route_info: { name: 't' }, warnings, validation }, {
      root, geographic: [120, 30, 120.1, 30.1], projected: [0, 0, 10, 10], zone: 51, south: false, warnings
    });
  } catch (error) {
    warnings.push(`预览封装失败：${error instanceof Error ? error.message : String(error)}`);
  }
  await writeBytes(join(job, 'web/index.html'), '<html></html>');
  await writeJson(join(job, 'spec.json'), { warnings });
  state.warnings = warnings;
  await progress.finish();
  assert.equal(state.status, 'completed');
  assert.ok(warnings.some(w => /道路预览失败|forced roads|预览封装失败/.test(w)), warnings.join(' | '));
  const stl = await resolveJobAsset(root, id, 'models', 'terrain.stl');
  assert.ok((await readFile(stl)).byteLength > 80);
  await rm(root, { recursive: true, force: true });
});
