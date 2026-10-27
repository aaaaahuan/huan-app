import { loadManifold } from './index';

export interface HeightGrid {
  width: number;
  height: number;
  size: [number, number];
  elevations: Float32Array;
  base: number;
  exaggeration: number;
  scale: number;
}
export interface PrintableMesh { vertices: Float32Array; triangles: Uint32Array; materials: Uint32Array; volume: number }

// 与 Python 相同的对角线、逆时针边界和底面扇形；实体必须经 Manifold 验收。
export async function buildTerrain(grid: HeightGrid): Promise<PrintableMesh> {
  const { width: nx, height: ny, size, elevations, base, exaggeration, scale } = grid;
  if (nx < 2 || ny < 2 || nx * ny !== elevations.length || nx * ny > 500_000 ||
      ![...size, base, exaggeration, scale].every(v => Number.isFinite(v) && v > 0)) throw new Error('地形网格参数无效');
  let minimum = Infinity;
  for (const h of elevations) { if (!Number.isFinite(h)) throw new Error('DEM 未完整覆盖模型；不填造高程'); minimum = Math.min(minimum, h); }
  const vertices: number[] = [], triangles: number[] = [], perimeter: number[] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) vertices.push(x * size[0] / (nx - 1), y * size[1] / (ny - 1), base + (elevations[y * nx + x] - minimum) * scale * exaggeration);
  for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const a = y * nx + x, b = a + 1, c = a + nx, d = c + 1;
    triangles.push(a, b, d, a, d, c);
  }
  for (let x = 0; x < nx; x++) perimeter.push(x);
  for (let y = 1; y < ny; y++) perimeter.push(y * nx + nx - 1);
  for (let x = nx - 2; x >= 0; x--) perimeter.push((ny - 1) * nx + x);
  for (let y = ny - 2; y > 0; y--) perimeter.push(y * nx);
  const bottom = vertices.length / 3;
  for (const i of perimeter) vertices.push(vertices[3 * i], vertices[3 * i + 1], 0);
  const center = vertices.length / 3; vertices.push(size[0] / 2, size[1] / 2, 0);
  for (let k = 0; k < perimeter.length; k++) {
    const next = (k + 1) % perimeter.length, i = perimeter[k], j = perimeter[next], u = bottom + k, v = bottom + next;
    triangles.push(i, u, v, i, v, j, center, v, u);
  }
  const { Mesh, Manifold } = await loadManifold();
  const solid = new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(vertices), triVerts: Uint32Array.from(triangles), faceID: new Uint32Array(triangles.length / 3) }));
  try {
    if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error(`地形实体校验失败：${solid.status()}`);
    const mesh = solid.getMesh();
    return { vertices: mesh.vertProperties.slice(), triangles: mesh.triVerts.slice(), materials: mesh.faceID.slice(), volume: solid.volume() };
  } finally { solid.delete(); }
}
