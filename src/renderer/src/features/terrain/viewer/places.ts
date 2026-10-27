import * as THREE from 'three';
import { z } from 'zod';
import type { Metadata, ReadAsset } from './assets';
const placesSchema = z.object({ labels: z.array(z.object({ name: z.string(), rank: z.number(), population: z.number().nullable().optional(), kind: z.string(), x_mm: z.number(), y_mm: z.number() })), styles: z.record(z.string(), z.object({ font_px: z.number().optional() })).optional() });

// 与旧预览相同：沿 anchor→camera 射线逐半网格采样，越出模型或超过最高点即停止。
export function makeOcclusion(size: number[], grid: number[], surfaceAt: (x: number, y: number) => number, maxZ: number) {
  const cell = Math.min(size[0] / (grid[0] - 1), size[1] / (grid[1] - 1));
  return (a: THREE.Vector3, c: THREE.Vector3) => {
    const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, horizontal = Math.hypot(dx, dy);
    if (horizontal < 1e-9) return false;
    let end = 1;
    if (dx > 0) end = Math.min(end, (size[0] - a.x) / dx); else if (dx < 0) end = Math.min(end, -a.x / dx);
    if (dy > 0) end = Math.min(end, (size[1] - a.y) / dy); else if (dy < 0) end = Math.min(end, -a.y / dy);
    if (dz > 0) end = Math.min(end, (maxZ + .3 - a.z) / dz);
    for (let t = 1.5 * cell / horizontal; t <= end; t += .5 * cell / horizontal) {
      const z = a.z + dz * t;
      if (dz <= 0 && z < -1) break;
      if (z < surfaceAt(a.x + dx * t, a.y + dy * t) - .3) return true;
    }
    return false;
  };
}
export async function loadPlaces(meta: Metadata, read: ReadAsset, host: HTMLElement, surface: (x: number, y: number) => number, maxZ: () => number) {
  const spec = meta.preview_layers;
  if (!spec?.places || !meta.size) throw new Error('缺少地名资源');
  const size = meta.size, grid = spec.grid;
  const doc = placesSchema.parse(JSON.parse(new TextDecoder().decode(await read(spec.places))));
  const layer = document.createElement('div'); layer.className = 'terrain-place-labels'; layer.setAttribute('aria-hidden', 'true'); host.append(layer);
  const items = doc.labels.sort((a, b) => a.rank - b.rank || (b.population ?? 0) - (a.population ?? 0)).slice(0, 400).map(row => {
    const el = document.createElement('span'); el.className = 'terrain-place-label'; el.textContent = `• ${row.name}`;
    const font = doc.styles?.[row.kind]?.font_px ?? 12; el.style.fontSize = `${font}px`; el.hidden = true; layer.append(el);
    return { row, el, world: new THREE.Vector3(), hidden: false, width: [...row.name].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : .6), 0) * font + 10, height: font + 4 };
  });
  let dirty = true, stale = true, last: number[] = [], lastOcclusion = -Infinity, visible = true;
  let occluded = makeOcclusion(size, grid, surface, maxZ());
  function invalidate() {
    for (const item of items) item.world.set(item.row.x_mm, item.row.y_mm, surface(item.row.x_mm, item.row.y_mm) + (meta.settlements?.places?.lift_mm ?? .6));
    occluded = makeOcclusion(size, grid, surface, maxZ()); dirty = true; stale = true;
  }
  invalidate();
  return {
    invalidate,
    setVisible(on: boolean) { visible = on; layer.hidden = !on; dirty = true; },
    dispose() { layer.remove(); },
    update(camera: THREE.PerspectiveCamera) {
      if (!visible) return;
      camera.updateMatrixWorld();
      const key = [...camera.matrixWorld.elements, camera.zoom, camera.fov, host.clientWidth, host.clientHeight];
      const moved = dirty || key.some((n, i) => Math.abs(n - (last[i] ?? Infinity)) > 1e-4);
      if (moved) stale = true;
      const recalc = stale && (!moved || performance.now() - lastOcclusion >= 120);
      if (!moved && !recalc) return;
      last = key; dirty = false;
      if (recalc) { for (const item of items) item.hidden = occluded(item.world, camera.position); stale = false; lastOcclusion = performance.now(); }
      const taken: number[][] = [];
      for (const item of items) {
        const v = item.world.clone().project(camera), x = (v.x + 1) / 2 * host.clientWidth, y = (1 - v.y) / 2 * host.clientHeight;
        const box = [x - 3, y - item.height / 2 - 1, x + item.width, y + item.height / 2 + 1];
        const show = !item.hidden && v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 && !taken.some(t => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        item.el.hidden = !show;
        if (show) { taken.push(box); item.el.style.transform = `translate(${x - 3}px,${y - item.height / 2}px)`; }
      }
    }
  };
}
