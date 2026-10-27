import type { Manifold, Mat4, Vec2 } from 'manifold-3d';
import type { FeatureConfig } from '../config';
import type { HeightGrid, PrintableMesh } from './terrain';
import { loadManifold } from './index';

type Side = FeatureConfig['elevation_scale']['side'];
interface Tick { role: string; elevation_m: number; label: string; nominal_z_mm: number; display_z_mm: number; relocated: boolean; local_u_mm: number }
export interface ScaleResult { mesh?: PrintableMesh; report: Record<string, unknown> }
// Python 的 .0f 是 ties-to-even；JS 的 Math.round 在半整数处不同。
function evenRound(n: number) { const lo = Math.floor(n), f = n - lo; return f === .5 ? lo % 2 === 0 ? lo : lo + 1 : Math.round(n); }
export async function elevationScale(cfg: FeatureConfig['elevation_scale'], grid: HeightGrid, baseGrid: Float32Array, routeElevations: number[]): Promise<ScaleResult> {
  const { width: nx, height: ny, size, base, scale, exaggeration } = grid;
  const profiles: Record<Side, number[]> = {
    south: Array.from(baseGrid.subarray(0, nx)), north: Array.from(baseGrid.subarray((ny - 1) * nx)).reverse(),
    east: Array.from({ length: ny }, (_, y) => baseGrid[y * nx + nx - 1]), west: Array.from({ length: ny }, (_, y) => baseGrid[(ny - 1 - y) * nx])
  };
  let low = Infinity, high = -Infinity, routeLow = Infinity, routeHigh = -Infinity;
  for (const h of grid.elevations) { low = Math.min(low, h); high = Math.max(high, h); }
  for (const h of routeElevations) { routeLow = Math.min(routeLow, h); routeHigh = Math.max(routeHigh, h); }
  const endpoints = cfg.source === 'terrain_min_max' ? [low, high] : [routeElevations[0], routeElevations[routeElevations.length - 1]];
  const statistics = Object.fromEntries(Object.entries(profiles).map(([side, p]) => [side, { area_mm2: p.reduce((sum, v, i) => sum + (i ? (v + p[i - 1]) / 2 : 0), 0) * size[side === 'south' || side === 'north' ? 0 : 1] / (p.length - 1), max_z_mm: Math.max(...p) }]));
  const report: Record<string, unknown> = { source: cfg.source, source_endpoints_m: endpoints, dem_mapping_range_m: [low, high], route_recorded_min_max_m: [routeLow, routeHigh], enabled: cfg.enabled, side: cfg.side, side_statistics: statistics, ticks: [], mode: 'emboss', color: cfg.color, material_id: 8, preview_vertices: './layers/elevation_scale_vertices.bin', preview_faces: './layers/elevation_scale_faces.bin' };
  if (!cfg.enabled) return { report };
  const h = cfg.text_height_mm, w = h * .54, t = cfg.stroke_mm, space = t * .8, gap = 1.5, depth = cfg.depth_mm, embed = .15;
  function layout(intervals: number, side: Side): Tick[] | undefined {
    const p = profiles[side].map(v => v - .6), length = size[side === 'south' || side === 'north' ? 0 : 1], ticks: Tick[] = [], occupied: { x: number; z: number; width: number }[] = [];
    function interp(x: number) { const f = x / length * (p.length - 1), i = Math.min(p.length - 2, Math.floor(f)); return p[i] + (p[i + 1] - p[i]) * (f - i); }
    function ceiling(x: number, width: number) {
      let top = Math.min(interp(x), interp(x + width));
      for (let i = Math.floor(x / length * (p.length - 1)) + 1; i < p.length && i * length / (p.length - 1) < x + width; i++) top = Math.min(top, p[i]);
      return top;
    }
    const free = (x: number, z: number, width: number) => occupied.every(o => Math.abs(z - o.z) >= h + 1 || x >= o.x + o.width + 1 || x + width <= o.x - 1);
    for (let i = 0; i <= intervals; i++) {
      const alt = endpoints[0] + (endpoints[1] - endpoints[0]) * i / intervals, nominal = base + (alt - low) * scale * exaggeration;
      const role = i === 0 ? 'start' : i === intervals ? 'end' : 'intermediate';
      let label = (cfg.source === 'route_start_end' ? role === 'start' ? 'S ' : role === 'end' ? 'E ' : '' : '') + `${evenRound(alt)} m`;
      let total = cfg.tick_length_mm + gap + label.length * (w + space), x: number | undefined, display = nominal;
      for (let u = 3; u < length - total - 3; u += .25) if (ceiling(u, total) >= nominal + h / 2 + .6 && free(u, nominal, total)) { x = u; break; }
      const moved = x === undefined;
      if (moved) {
        label += '*'; total += w + space; let best = -Infinity;
        for (let u = 3; u < length - total - 3; u += .25) {
          const z = Math.min(nominal, ceiling(u, total) - h / 2 - .6);
          if (z > h / 2 + 1 && free(u, z, total) && z > best) { best = z; display = z; x = u; }
        }
      }
      if (x === undefined || display - h / 2 <= 1 || display <= 0) return;
      occupied.push({ x, z: display, width: total });
      ticks.push({ role, elevation_m: alt, label, nominal_z_mm: nominal, display_z_mm: display, relocated: moved, local_u_mm: x });
    }
    return ticks;
  }
  let side = cfg.side, ticks: Tick[] | undefined, intervals = cfg.intervals;
  const attempts: { side: Side; intervals: number; ok: boolean }[] = [];
  const sides: Side[] = [cfg.side, ...(['south', 'east', 'north', 'west'] as const).filter(s => s !== cfg.side)];
  for (const candidate of sides) {
    for (let n = cfg.intervals; n >= 1; n--) {
      ticks = layout(n, candidate); attempts.push({ side: candidate, intervals: n, ok: !!ticks });
      if (ticks) { side = candidate; intervals = n; break; }
    }
    if (ticks) break;
  }
  if (!ticks) return { report: { ...report, enabled: false, autofit_failed: true, autofit_attempts: attempts, note: '侧壁无法容纳刻度，本任务已关闭海拔刻度' } };
  const module = await loadManifold(), { Manifold, CrossSection, Mesh } = module;
  const owned: Manifold[] = [];
  const own = (s: Manifold) => { owned.push(s); return s; };
  const box = (x: number, z: number, width: number, height: number) => own(own(Manifold.cube([width, height, depth + embed])).translate([x, z, 0]));
  const segments: Record<string, [number, number, number, number]> = { a: [0, h - t, w, t], g: [0, (h - t) / 2, w, t], d: [0, 0, w, t], f: [0, h / 2, t, h / 2], b: [w - t, h / 2, t, h / 2], e: [0, 0, t, h / 2], c: [w - t, 0, t, h / 2] };
  const digits: Record<string, string> = { '0': 'abcedf', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd', S: 'afgcd', E: 'afged' };
  const pieces: Manifold[] = [];
  try {
    for (const tick of ticks) {
      const x = tick.local_u_mm, z = tick.display_z_mm;
      pieces.push(box(x, z - cfg.line_width_mm / 2, cfg.tick_length_mm, cfg.line_width_mm));
      for (const [j, ch] of Array.from(tick.label).entries()) {
        const gx = x + cfg.tick_length_mm + gap + j * (w + space), gz = z - h / 2;
        if (digits[ch]) for (const k of digits[ch]) { const [a, b, c, d] = segments[k]; pieces.push(box(gx + a, gz + b, c, d)); }
        else if (ch === 'm') pieces.push(box(gx, gz, t, h * .75), box(gx + w / 2 - t / 2, gz, t, h * .75), box(gx + w - t, gz, t, h * .75), box(gx, gz + h * .75 - t, w, t));
        else if (ch === '*') pieces.push(box(gx, gz + h * .4, w, t), box(gx + w / 2 - t / 2, gz + h * .2, t, h * .6));
      }
    }
    const profile = profiles[side].map(v => v - .6), length = size[side === 'south' || side === 'north' ? 0 : 1];
    const poly: Vec2[] = profile.map((z, i) => [i * length / (profile.length - 1), z]);
    poly.push([length, .8], [0, .8]); poly.reverse();
    const section = new CrossSection([poly]);
    let slab: Manifold;
    try { slab = own(section.extrude(depth + embed)); } finally { section.delete(); }
    const clipped = own(own(Manifold.union(pieces)).intersect(slab));
    // Manifold JS 使用 column-major 4×4；局部坐标 (u,z,depth) 的外侧朝向与 Python 相同。
    const matrices: Record<Side, Mat4> = {
      south: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -depth, 0, 1],
      north: [-1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, size[0], size[1] + depth, 0, 1],
      east: [0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, size[0] + depth, 0, 0, 1],
      west: [0, -1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -depth, size[1], 0, 1]
    };
    const transformed = own(clipped.transform(matrices[side]));
    if (transformed.status() !== 'NoError' || transformed.volume() <= 0) throw new Error('海拔刻度实体无效');
    const mesh = transformed.getMesh(), materials = new Uint32Array(mesh.triVerts.length / 3).fill(8);
    const tagged = own(new Manifold(new Mesh({ numProp: 3, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, faceID: materials })));
    if (tagged.status() !== 'NoError' || mesh.vertProperties.some((v, i) => i % 3 === 2 && v <= 0)) throw new Error('刻度触及底面或拓扑无效');
    return { mesh: { vertices: mesh.vertProperties.slice(), triangles: mesh.triVerts.slice(), materials, volume: tagged.volume() }, report: { ...report, side, intervals, ticks, autofit_attempts: attempts, depth_mm: depth, embed_mm: embed, text_height_mm: h, stroke_mm: t, line_width_mm: cfg.line_width_mm, vertices: mesh.vertProperties.length / 3, faces: mesh.triVerts.length / 3 } };
  } finally { for (const solid of owned.reverse()) solid.delete(); }
}

export async function mergePrint(terrain: PrintableMesh, additions: PrintableMesh[]): Promise<PrintableMesh> {
  const { Mesh, Manifold } = await loadManifold();
  const solids = [terrain, ...additions].map(m => new Manifold(new Mesh({ numProp: 3, vertProperties: m.vertices, triVerts: m.triangles, faceID: m.materials })));
  const owned = [...solids];
  try {
    for (const addition of solids.slice(1)) {
      const intersection = solids[0].intersect(addition);
      try { if (!intersection || intersection.volume() <= 0) throw new Error('独立实体未与地形相交'); } finally { intersection?.delete(); }
    }
    const merged = Manifold.union(solids); owned.push(merged);
    if (merged.status() !== 'NoError') throw new Error(`布尔合并失败：${merged.status()}`);
    const components = merged.decompose(); owned.push(...components);
    const positive = components.filter(s => s.volume() > 0);
    if (positive.length !== 1) throw new Error('打印模型存在分离的正体积实体');
    const result = positive[0], mesh = result.getMesh();
    if (mesh.numProp !== 3) throw new Error('打印实体属性布局无效');
    return { vertices: mesh.vertProperties.slice(), triangles: mesh.triVerts.slice(), materials: mesh.faceID.slice(), volume: result.volume() };
  } finally { for (const solid of owned.reverse()) solid.delete(); }
}
