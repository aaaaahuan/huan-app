import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { createModel, type DeviceVisibility } from './model';

export type StudioView = 'perspective' | 'front' | 'side' | 'back';

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); scene.clear();
}

export function createStudioScene(host: HTMLDivElement, onError: (message: string) => void) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let frame = 0, disposed = false;
  let orbit: OrbitControls | undefined, observer: ResizeObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); orbit?.dispose();
    document.removeEventListener('visibilitychange', visibilityChanged);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    disposeScene(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
  function contextLost(event: Event) {
    event.preventDefault(); cancelAnimationFrame(frame);
    onError('三维绘图连接已中断，请重新加载模型。');
  }
  function visibilityChanged() { cancelAnimationFrame(frame); if (!document.hidden && !disposed) render(); }
  const camera = new THREE.PerspectiveCamera(36, 1, .5, 5000);
  camera.up.set(0, 0, 1);
  function render() {
    if (disposed || document.hidden) return;
    orbit?.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render);
  }
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '掌心管家三维模型，拖动旋转、滚轮缩放，方向键平移');
    canvas.addEventListener('webglcontextlost', contextLost); host.append(canvas);
    scene.add(new THREE.HemisphereLight(0xfff8ed, 0x747d70, 2.2));
    const key = new THREE.DirectionalLight(0xfff3de, 3.1);
    key.position.set(-260, -380, 650); key.target.position.set(0, 0, 150); scene.add(key, key.target);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 20, far: 1400 });
    key.shadow.normalBias = 1; key.shadow.bias = -.0001;
    const fill = new THREE.DirectionalLight(0xffffff, 1.8); fill.position.set(230, 180, 400); scene.add(fill);
    const { root, hand, groups } = createModel(); scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.ShadowMaterial({ opacity: .12 }));
    floor.position.z = -.6; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(700, 28, 0xb5c6b8, 0xd3dfd6);
    grid.rotation.x = Math.PI / 2; grid.position.z = -.4; grid.visible = false; scene.add(grid);
    orbit = new OrbitControls(camera, canvas); orbit.target.copy(center); orbit.enableDamping = true;
    orbit.minDistance = 220; orbit.maxDistance = 1600; orbit.maxPolarAngle = Math.PI * .88;
    orbit.listenToKeyEvents(canvas);
    function setView(view: StudioView) {
      if (!orbit) return;
      // 视角按容器实际长宽比适配，缩窄窗口仍完整展示手掌和设备。
      const distance = Math.max(size.z, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.2;
      const direction = view === 'front' ? new THREE.Vector3(0, -1, .08)
        : view === 'side' ? new THREE.Vector3(1, 0, .08)
        : view === 'back' ? new THREE.Vector3(0, 1, .08) : new THREE.Vector3(-.28, -1, .14);
      camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
      orbit.target.copy(center); orbit.update();
    }
    function resize() {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    }
    observer = new ResizeObserver(resize); observer.observe(host); resize(); setView('perspective');
    document.addEventListener('visibilitychange', visibilityChanged); render();
    return {
      setView,
      setVisibility(value: DeviceVisibility) { for (const id of Object.keys(groups) as (keyof DeviceVisibility)[]) groups[id].visible = value[id]; },
      setGrid(value: boolean) { grid.visible = value; },
      setWireframe(value: boolean) { hand.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.wireframe = value; }); },
      exportSTL() {
        // 导出只包含手部实体，设备始终是摆放示意，不随预览开关混入打印网格。
        const output = new STLExporter().parse(hand, { binary: true });
        return new Uint8Array(output.buffer, output.byteOffset, output.byteLength).slice().buffer;
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
export type StudioScene = ReturnType<typeof createStudioScene>;
