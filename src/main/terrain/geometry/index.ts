import { createRequire } from 'node:module';
// 主进程和未来 CJS worker 共享加载器；动态 import 保留 ESM 包入口，WASM 不经 Vite 内联。
export async function loadManifold() {
  const { default: Module } = await import('manifold-3d');
  const wasm = createRequire(__filename).resolve('manifold-3d/manifold.wasm').replace('app.asar/', 'app.asar.unpacked/');
  const module = await Module({ locateFile: () => wasm });
  module.setup();
  return module;
}
export async function boxSmoke() {
  const { Manifold } = await loadManifold();
  const box = Manifold.cube([2, 3, 4]);
  try {
    const volume = box.volume();
    if (box.status() !== 'NoError' || volume <= 0) throw new Error('Manifold 实体构建失败');
    const mesh = box.getMesh(), triangles = mesh.triVerts.length / 3;
    const bytes = new Uint8Array(84 + 50 * triangles), view = new DataView(bytes.buffer);
    view.setUint32(80, triangles, true);
    for (let i = 0; i < triangles; i++) {
      const vertices = Array.from({ length: 3 }, (_, k) => {
        const offset = mesh.triVerts[3 * i + k] * mesh.numProp;
        return [mesh.vertProperties[offset], mesh.vertProperties[offset + 1], mesh.vertProperties[offset + 2]];
      });
      const [a, b, c] = vertices, u = b.map((v, j) => v - a[j]), v = c.map((value, j) => value - a[j]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...normal);
      if (!length) throw new Error('Manifold 输出退化三角形');
      [...normal.map(n => n / length), ...vertices.flat()].forEach((value, j) => view.setFloat32(84 + i * 50 + j * 4, value, true));
    }
    return { bytes, volume, triangles };
  } finally { box.delete(); }
}
