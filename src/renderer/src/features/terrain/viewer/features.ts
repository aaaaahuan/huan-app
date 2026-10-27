import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Metadata, ReadAsset } from './assets';
import { loadPlaces } from './places';

export const featureNames: Record<string, string> = { rivers: '河流/湖泊', forest: '林区', grass: '草地', snow: '冰雪', roads: '道路', houses: '房屋', elevation_scale: '海拔刻度', places: '地名', settlements: '居民区' };
export interface FeatureControl { key: string; enabled: boolean; available: boolean; reason?: string }
interface Layers { base: Float32Array; classes: Uint8Array; distance: Float32Array; forest?: Float32Array; rivers?: Float32Array; houses?: Float32Array; routeGap?: Uint8Array }
export function composePreview(layers: Layers, state: Record<string, boolean>) {
  const { base, classes, distance, forest, rivers, houses, routeGap } = layers;
  const z = new Float32Array(base.length), preClass = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    let surface = base[i], id = 0;
    if (state.forest) { surface += forest?.[i] || 0; if (classes[i] === 2) id = 2; }
    if (state.rivers && classes[i] === 1) { surface = base[i] + (rivers?.[i] || 0); id = 1; }
    if (state.grass && classes[i] === 5) id = 5;
    if (state.snow && classes[i] === 3) id = 3;
    if (state.houses && (houses?.[i] ?? 0) > 0) { surface = Math.max(surface, houses![i]); id = 6; }
    const weight = state.houses && routeGap?.[i] ? 0 : Math.max(0, Math.min(1, (.85 - distance[i]) / .13));
    z[i] = surface + weight * (Math.max(base[i], surface) - surface + .8); preClass[i] = id;
  }
  return { z, preClass };
}
export async function loadFeatures(meta: Metadata, read: ReadAsset, geo: THREE.BufferGeometry, mesh: THREE.Mesh, scene: THREE.Scene, host: HTMLElement, onControls: (controls: FeatureControl[]) => void, alive: () => boolean) {
  const spec = meta.preview_layers, size = meta.size;
  if (!spec || !size || !geo.index) throw new Error('缺少预览高度场');
  const [nx, ny] = spec.grid, count = nx * ny;
  const state = { ...spec.available }, failed: Record<string, string> = {};
  const f32 = async (path: string, length?: number) => {
    const arr = new Float32Array(await read(path));
    if ((length !== undefined && arr.length !== length) || arr.some(n => !Number.isFinite(n))) throw new Error('浮点图层尺寸或数值无效');
    return arr;
  };
  const u8 = async (path: string, length: number) => { const arr = new Uint8Array(await read(path)); if (arr.length !== length) throw new Error('分类图层尺寸无效'); return arr; };
  async function optional<T>(key: string, load: () => Promise<T>): Promise<T | undefined> {
    if (!state[key]) return;
    try { return await load(); } catch (e) { state[key] = false; failed[key] = e instanceof Error ? e.message : '加载失败'; }
  }
  const [base, classes, distance, faceRoute] = await Promise.all([f32(spec.base, count), u8(spec.classes, count), f32(spec.distance, count), u8(spec.face_route, spec.top_faces)]);
  const [forest, rivers, houses, routeGap, faceGap, settlements] = await Promise.all([
    optional('forest', () => f32(spec.forest ?? '', count)), optional('rivers', () => f32(spec.rivers ?? '', count)),
    optional('houses', () => f32(spec.houses ?? '', count)), spec.route_gap ? u8(spec.route_gap, count) : undefined,
    spec.face_gap ? u8(spec.face_gap, spec.top_faces) : undefined, optional('settlements', () => u8(spec.settlements ?? '', count))
  ]);
  const positions = geo.getAttribute('position'), indices = geo.index.array;
  if (positions.count < count || spec.top_faces * 3 > indices.length) throw new Error('网格与预览图层不匹配');
  const samples = new Uint32Array(spec.top_faces);
  for (let i = 0; i < samples.length; i++) {
    const a = indices[i * 3], b = indices[i * 3 + 1], c = indices[i * 3 + 2];
    const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3, y = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
    samples[i] = Math.min(ny - 1, Math.max(0, Math.round(y / size[1] * (ny - 1)))) * nx + Math.min(nx - 1, Math.max(0, Math.round(x / size[0] * (nx - 1))));
  }
  function surfaceAt(x: number, y: number) {
    const ix = THREE.MathUtils.clamp(x / size![0] * (nx - 1), 0, nx - 1), iy = THREE.MathUtils.clamp(y / size![1] * (ny - 1), 0, ny - 1);
    const i = Math.min(Math.floor(ix), nx - 2), j = Math.min(Math.floor(iy), ny - 2), fx = ix - i, fy = iy - j;
    const a = positions.getZ(j * nx + i), b = positions.getZ(j * nx + i + 1), c = positions.getZ((j + 1) * nx + i), d = positions.getZ((j + 1) * nx + i + 1);
    return fx >= fy ? (1 - fx) * a + (fx - fy) * b + fy * d : (1 - fy) * a + fx * d + (fy - fx) * c;
  }
  const pins = new THREE.Group(), scale = new THREE.Group(), roads = new THREE.Group();
  scene.add(pins, scale, roads);
  const roadItems: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; original: Float32Array; style: NonNullable<Metadata['roads']>['groups'][string] }[] = [];
  await optional('houses', async () => {
    if (!meta.houses?.placed_points.length) return;
    const data = await read(meta.houses.model_glb);
    // 独立 GLB 不允许请求外部纹理/缓冲区，全部资源必须自包含。
    const manager = new THREE.LoadingManager(); manager.setURLModifier(() => { throw new Error('房屋 GLB 不允许外部资源'); });
    const gltf = await new GLTFLoader(manager).parseAsync(data, '');
    gltf.scene.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.name === 'accent') o.material.color.set(meta.configuration?.effective?.houses?.pin_color ?? '#F4A7B9'); });
    for (const point of meta.houses.placed_points) { const pin = gltf.scene.clone(true); pin.scale.setScalar(meta.houses.scale); pin.position.fromArray(point.scene_origin_mm); pins.add(pin); }
  });
  await optional('elevation_scale', async () => {
    const [v, f] = await Promise.all([f32(meta.elevation_scale?.preview_vertices ?? ''), read(meta.elevation_scale?.preview_faces ?? '')]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(f), 1)); g.computeVertexNormals();
    scale.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: meta.elevation_scale?.color ?? '#39434B', roughness: .85 })));
  });
  await optional('roads', async () => {
    for (const style of Object.values(meta.roads?.groups ?? {})) {
      const vertices = await f32(style.vertices), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(vertices.slice(), 3));
      const road = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: style.color, side: THREE.DoubleSide })); roads.add(road); roadItems.push({ mesh: road, original: vertices, style });
    }
  });
  const palette = new Map(meta.palette.map(p => [p.id, new THREE.Color(p.hex)]));
  const settlementPalette = new Map(Object.entries(meta.settlements?.areas?.styles ?? {}).map(([id, style]) => [Number(id), new THREE.Color(style.color)]));
  const overlays: { places?: Awaited<ReturnType<typeof loadPlaces>> } = {};
  let lastUnits = 0;
  function refresh() {
    const { z, preClass } = composePreview({ base, classes, distance, forest, rivers, houses, routeGap }, state);
    for (let i = 0; i < z.length; i++) positions.setZ(i, z[i]);
    positions.needsUpdate = true; geo.computeVertexNormals();
    const next = geo.toNonIndexed(), rgb = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length / 3; i++) {
      const id = i < spec!.top_faces ? (faceRoute[i] && !(state.houses && faceGap?.[i]) ? 4 : preClass[samples[i]]) : 0;
      let color = palette.get(id) ?? new THREE.Color('#C6CBB5');
      if (state.settlements && settlements && i < spec!.top_faces && ![1, 4, 6].includes(id)) color = settlementPalette.get(settlements[samples[i]]) ?? color;
      for (let j = 0; j < 3; j++) color.toArray(rgb, i * 9 + j * 3);
    }
    next.setAttribute('color', new THREE.BufferAttribute(rgb, 3)); next.computeBoundingBox(); next.computeBoundingSphere(); mesh.geometry.dispose(); mesh.geometry = next;
    for (const pin of pins.children) pin.position.z = surfaceAt(pin.position.x, pin.position.y) - (meta.houses?.sink_mm ?? .4);
    pins.visible = !!state.houses; scale.visible = !!state.elevation_scale; roads.visible = !!state.roads;
    lastUnits = 0; overlays.places?.setVisible(!!state.places); overlays.places?.invalidate();
    if (alive()) onControls(Object.keys(featureNames).map(key => ({ key, enabled: !!state[key], available: !!spec!.available[key] && !failed[key], reason: failed[key] })));
  }
  refresh();
  overlays.places = await optional('places', () => loadPlaces(meta, read, host, surfaceAt, () => mesh.geometry.boundingBox?.max.z ?? 100));
  refresh();
  if (!alive()) overlays.places?.dispose();
  return {
    toggle(key: string) { if (spec.available[key] && !failed[key]) { state[key] = !state[key]; refresh(); } },
    dispose() {
      overlays.places?.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      for (const group of [pins, scale, roads]) {
        group.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
        group.removeFromParent(); group.clear();
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    update(camera: THREE.PerspectiveCamera) {
      const center = new THREE.Vector3(size[0] / 2, size[1] / 2, 0);
      const units = 2 * camera.position.distanceTo(center) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom / Math.max(1, host.clientHeight);
      if (roads.visible && (!lastUnits || Math.abs(units / lastUnits - 1) > .05)) {
        lastUnits = units;
        for (const { mesh: road, original, style } of roadItems) {
          const p = road.geometry.getAttribute('position'), width = style.width_mm ?? 1;
          const ratio = Math.min(style.max_mm ?? width * 7, Math.max(width, (style.min_px ?? 1.5) * units)) / width;
          for (let i = 0; i + 5 < p.count; i += 6) {
            const ax = (original[i * 3] + original[(i + 5) * 3]) / 2, ay = (original[i * 3 + 1] + original[(i + 5) * 3 + 1]) / 2;
            const bx = (original[(i + 1) * 3] + original[(i + 2) * 3]) / 2, by = (original[(i + 1) * 3 + 1] + original[(i + 2) * 3 + 1]) / 2;
            for (let j = 0; j < 6; j++) {
              const a = [0, 3, 5].includes(j), cx = a ? ax : bx, cy = a ? ay : by, k = (i + j) * 3;
              const x = THREE.MathUtils.clamp(cx + (original[k] - cx) * ratio, 0, size[0]), y = THREE.MathUtils.clamp(cy + (original[k + 1] - cy) * ratio, 0, size[1]);
              p.setXYZ(i + j, x, y, surfaceAt(x, y) + (meta.roads?.lift_mm ?? .07));
            }
          }
          p.needsUpdate = true; road.geometry.computeBoundingSphere();
        }
      }
      overlays.places?.update(camera);
    }
  };
}
