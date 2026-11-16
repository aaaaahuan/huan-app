import * as THREE from 'three';
import data from './assets/palm-organizer.json';

export const devices = [
  { id: 'phone', name: 'iPhone 14', placement: '掌心左侧 · 裸机', dimensions: '146.7 × 71.5 × 7.8 mm' },
  { id: 'case', name: 'AirPods 2', placement: '掌心右侧 · 浅凹窝', dimensions: '53.5 × 44.3 × 21.3 mm' },
  { id: 'band', name: '小米手环 10', placement: '弯曲小指 · 解扣悬挂', dimensions: '46.57 × 22.54 × 11.8 mm（含传感器）' },
  { id: 'headphones', name: '旋风黑鲨 V2 极速版', placement: '上方手指 · 头梁承托', dimensions: '外廓为示意，待实测' },
] as const;
export type DeviceId = typeof devices[number]['id'];
export type DeviceVisibility = Record<DeviceId, boolean>;
export const initialVisibility: DeviceVisibility = { phone: true, case: true, band: true, headphones: true };
export const modelMetadata = data.metadata;

function decode(value: string): ArrayBuffer {
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function createModel() {
  const root = new THREE.Group();
  root.name = '掌心管家';
  const hand = new THREE.Group(), groups: Record<DeviceId, THREE.Group> = {
    phone: new THREE.Group(), case: new THREE.Group(), band: new THREE.Group(), headphones: new THREE.Group(),
  };
  root.add(hand, ...Object.values(groups));
  for (const part of data.meshes) {
    const positions = new Float32Array(decode(part.positions));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(decode(part.indices)), 1));
    geometry.computeVertexNormals();
    const color = new THREE.Color().setRGB(part.color[0] / 255, part.color[1] / 255, part.color[2] / 255, THREE.SRGBColorSpace);
    const material = new THREE.MeshStandardMaterial({ color, roughness: part.group === 'hand' ? .72 : .48, metalness: .02 });
    if (part.name === 'iPhone 屏幕') {
      const palette = ['#ffb85f', '#ef698e', '#784cae', '#253f92'].map(value => new THREE.Color(value));
      const colors = new Float32Array(positions.length);
      geometry.computeBoundingBox();
      const min = geometry.boundingBox!.min.z, height = geometry.boundingBox!.max.z - min;
      for (let i = 0; i < positions.length; i += 3) {
        const t = THREE.MathUtils.clamp((positions[i + 2] - min) / height * 3, 0, 3), index = Math.min(2, Math.floor(t));
        palette[index].clone().lerp(palette[index + 1], t - index).toArray(colors, i);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material.color.set('white'); material.vertexColors = true; material.roughness = .3;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.name; mesh.castShadow = true; mesh.receiveShadow = false;
    if (part.group === 'hand') hand.add(mesh);
    else {
      const device = devices.find(d => d.id === part.group);
      if (device) groups[device.id].add(mesh);
    }
  }
  return { root, hand, groups };
}
