import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Button } from '@renderer/components/Button';

export function FileViewer({ project, path }: { project: string; path: string }) {
 const host = useRef<HTMLDivElement>(null);
 const [error, setError] = useState(''), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
 useEffect(() => {
  let cancelled = false, cleanup: (() => void) | undefined;
  setLoading(true); setError('');
  async function load() {
   const result = await window.huanApp.studio.read({ project, path });
   if (cancelled) return;
   if (!result.ok) throw new Error(result.message);
   const { content, format } = result.value;
   const buffer = new Uint8Array(content).buffer;
   let model: THREE.Object3D;
   if (format === 'stl') model = new THREE.Mesh(new STLLoader().parse(buffer), new THREE.MeshStandardMaterial({ color: '#b8c9bc', roughness: .65, side: THREE.DoubleSide }));
   else if (format === '3mf') model = new ThreeMFLoader().parse(buffer);
   else if (format === 'obj') model = new OBJLoader().parse(new TextDecoder().decode(buffer));
   else {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => { if (!url.startsWith('data:') && !url.startsWith('blob:')) throw new Error('请使用包含全部资源的 GLB 文件。'); return url; });
    model = new THREE.Group();
    model.add((await new GLTFLoader(manager).parseAsync(buffer, '')).scene);
    model.rotation.x = Math.PI / 2;
   }
   const disposeModel = () => model.traverse(object => {
    if (object instanceof THREE.Mesh) {
     object.geometry.dispose();
     for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
     }
    }
   });
   if (cancelled || !host.current) { disposeModel(); return; }
   const element = host.current, scene = new THREE.Scene();
   let renderer: THREE.WebGLRenderer;
   try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (error) { disposeModel(); throw error; }
   renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor('#f4f5f1'); renderer.toneMapping = THREE.ACESFilmicToneMapping;
   renderer.domElement.setAttribute('aria-label', `${path} 三维预览`); renderer.domElement.tabIndex = 0;
   element.append(renderer.domElement);
   scene.add(model, new THREE.HemisphereLight(0xffffff, 0x6e786d, 1.8));
   const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, -3, 5); scene.add(light);
   const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
   const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, .01);
   if (!Number.isFinite(radius) || bounds.isEmpty()) { disposeModel(); renderer.dispose(); renderer.domElement.remove(); throw new Error('模型中没有可显示的网格。'); }
   model.position.sub(center);
   const camera = new THREE.PerspectiveCamera(40, 1, radius / 1000, radius * 1000); camera.up.set(0, 0, 1);
   const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.listenToKeyEvents(renderer.domElement);
   const reset = () => { const distance = radius / Math.sin(THREE.MathUtils.degToRad(20)) * Math.max(1, 1 / camera.aspect) * 1.12; camera.position.set(.4, -1, .45).normalize().multiplyScalar(distance); controls.target.set(0, 0, 0); controls.update(); };
   const resize = () => { camera.aspect = Math.max(element.clientWidth, 1) / Math.max(element.clientHeight, 1); camera.updateProjectionMatrix(); renderer.setSize(element.clientWidth, element.clientHeight); reset(); };
   const observer = new ResizeObserver(resize); observer.observe(element); resize();
   let frame = 0;
   function render() { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); }
   const contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); setError('三维绘图连接已中断，请重试。'); };
   renderer.domElement.addEventListener('webglcontextlost', contextLost);
   render(); setLoading(false);
   cleanup = () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); disposeModel(); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }
  void load().catch(error => { if (!cancelled) { setError(error instanceof Error ? error.message : '模型读取失败'); setLoading(false); } });
  return () => { cancelled = true; cleanup?.(); };
 }, [project, path, attempt]);
 return <div className="studio-viewer"><div className="studio-canvas-host" ref={host} />
  {loading || error ? <div className="studio-viewer-message" role={error ? 'alert' : 'status'}>{error || '正在加载三维模型…'}{error ? <Button onClick={() => setAttempt(v => v + 1)}>重新加载</Button> : null}</div> : null}
  <footer className="studio-viewer-footer">拖动旋转 · 滚轮缩放 · 右键平移</footer></div>;
}
