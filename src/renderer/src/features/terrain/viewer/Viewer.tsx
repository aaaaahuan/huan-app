import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Button } from '@renderer/components/Button';
import { assetReader, metadataSchema } from './assets';
import { featureNames, loadFeatures, type FeatureControl } from './features';
import './viewer.css';

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  scene.clear();
}
export function Viewer({ id, active }: { id: string; active: boolean }) {
  const animate = useRef<() => void>(() => {}), pause = useRef<() => void>(() => {});
  const visible = useRef(active);
  useEffect(() => { visible.current = active; if (active) animate.current(); else pause.current(); }, [active]);
  const host = useRef<HTMLDivElement>(null), toggle = useRef<(key: string) => void>(() => {}), reset = useRef<() => void>(() => {});
  const [controls, setControls] = useState<FeatureControl[]>([]), [status, setStatus] = useState('正在载入地形…'), [error, setError] = useState('');
  const [legend, setLegend] = useState<{ id: number; name: string; hex: string }[]>([]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let alive = true, frame = 0;
    let renderer: THREE.WebGLRenderer | undefined, orbit: OrbitControls | undefined, observer: ResizeObserver | undefined;
    let features: Awaited<ReturnType<typeof loadFeatures>> | undefined, source: THREE.BufferGeometry | undefined;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e4e9e5');
    const read = assetReader(id);
    void (async () => {
      const meta = metadataSchema.parse(JSON.parse(new TextDecoder().decode(await read('metadata.json'))));
      if (!alive) return;
      setLegend(meta.palette);
      renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '三维地形，拖动旋转，滚轮缩放'); renderer.domElement.tabIndex = 0; element.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(36, 1, .1, 3000); camera.up.set(0, 0, 1);
      const material = new THREE.MeshStandardMaterial({ color: '#C6CBB5', roughness: .85 });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material); scene.add(mesh);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x737c69, 2.4)); const sun = new THREE.DirectionalLight(0xfff1dc, 3.3); sun.position.set(-100, -100, 280); scene.add(sun);
      if (meta.native_core_only) {
        mesh.geometry.dispose(); mesh.geometry = new STLLoader().parse(await read('terrain.stl', 'models'));
        if (alive) setStatus('DEM 核心 · 路线、地表、房屋与刻度尚未构建');
      } else {
        const [v, f, m] = await Promise.all([read('vertices.bin'), read('faces.bin'), read('face_materials.bin')]);
        source = new THREE.BufferGeometry(); const positions = new Float32Array(v), indices = new Uint32Array(f), ids = new Uint8Array(m);
        if (positions.length % 3 || indices.length % 3 || ids.length !== indices.length / 3 || positions.some(n => !Number.isFinite(n)) || indices.some(n => n >= positions.length / 3)) throw new Error('预览网格数据无效');
        source.setAttribute('position', new THREE.BufferAttribute(positions, 3)); source.setIndex(new THREE.BufferAttribute(indices, 1)); source.computeVertexNormals();
        mesh.geometry.dispose(); mesh.geometry = source.toNonIndexed(); const colors = new Float32Array(indices.length * 3), palette = new Map(meta.palette.map(p => [p.id, new THREE.Color(p.hex)]));
        for (let i = 0; i < ids.length; i++) for (let j = 0; j < 3; j++) (palette.get(ids[i]) ?? new THREE.Color('#C6CBB5')).toArray(colors, i * 9 + j * 3);
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); material.color.set('white'); material.vertexColors = true;
        if (meta.preview_layers) features = await loadFeatures(meta, read, source, mesh, scene, element, setControls, () => alive);
        if (alive) setStatus(meta.preview_layers ? '原生预览 · 图层开关仅影响显示' : '原生网格 · 未保存可切换图层');
      }
      if (!alive) { features?.dispose(); source?.dispose(); disposeScene(scene); return; }
      mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox!, center = box.getCenter(new THREE.Vector3());
      orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(center); orbit.enableDamping = true; orbit.listenToKeyEvents(renderer.domElement); orbit.minDistance = 15; orbit.maxDistance = 1000; orbit.maxPolarAngle = Math.PI * .495;
      const resetView = () => { const factor = Math.max(1, .95 / camera.aspect) * 1.15; camera.position.set(center.x + 190 * factor, center.y - 245 * factor, center.z + 240 * factor); orbit?.target.copy(center); orbit?.update(); };
      reset.current = resetView; toggle.current = key => features?.toggle(key);
      const resize = () => { if (!renderer) return; const w = Math.max(1, element.clientWidth), h = Math.max(1, element.clientHeight); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
      observer = new ResizeObserver(resize); observer.observe(element); resize(); resetView();
      const render = () => { if (!alive || !renderer || !visible.current) return; orbit?.update(); features?.update(camera); renderer.render(scene, camera); frame = requestAnimationFrame(render); };
      pause.current = () => cancelAnimationFrame(frame);
      animate.current = () => { cancelAnimationFrame(frame); render(); };
      animate.current();
    })().catch(e => { if (alive) { setError(e instanceof Error ? e.message : '预览加载失败'); setStatus(''); } else { features?.dispose(); source?.dispose(); disposeScene(scene); } });
    return () => { alive = false; animate.current = () => {}; pause.current = () => {}; cancelAnimationFrame(frame); observer?.disconnect(); orbit?.dispose(); features?.dispose(); source?.dispose(); disposeScene(scene); renderer?.dispose(); renderer?.domElement.remove(); toggle.current = () => {}; reset.current = () => {}; };
  }, [id]);
  async function download(format: 'stl' | '3mf') {
    try {
      const content = await assetReader(id)(`terrain.${format}`, 'models');
      const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = `${id}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : '下载失败'); }
  }
  return <div className="terrain-native-viewer" data-job={id}>
    <div className="terrain-viewer-actions"><Button onClick={() => reset.current()}>重置视角</Button><Button onClick={() => void download('stl')}>下载 STL</Button><Button onClick={() => void download('3mf')}>下载 3MF</Button></div>
    <div className="terrain-feature-controls" aria-label="预览图层">{controls.map(c => <Button key={c.key} disabled={!c.available} aria-pressed={c.enabled} title={c.reason} onClick={() => toggle.current(c.key)}>{featureNames[c.key]}{!c.available ? `（${c.reason ? '加载失败' : '未构建'}）` : ''}</Button>)}</div>
    {controls.filter(c => c.reason).map(c => <p key={c.key} role="alert">{featureNames[c.key]}：{c.reason}</p>)}
    <div className="terrain-legend" aria-label="地表类别图例">{legend.filter(p => {
      const key: Record<number, string> = { 1: 'rivers', 2: 'forest', 3: 'snow', 5: 'grass', 6: 'houses', 7: 'houses', 8: 'elevation_scale' };
      return !key[p.id] || !controls.length || controls.some(c => c.key === key[p.id] && c.enabled);
    }).map(p => <span key={p.id}><i style={{ background: p.hex }} />{p.name.split(' / ').at(-1)}</span>)}</div>
    <p role={error ? 'alert' : 'status'}>{error || status}</p>
    <div className="terrain-canvas-host" ref={host} />
  </div>;
}
