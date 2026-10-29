import { createRequire } from 'node:module';
// 主进程和未来 CJS worker 共享加载器；动态 import 保留 ESM 包入口，WASM 不经 Vite 内联。
export async function loadManifold() {
  const { default: Module } = await import('manifold-3d');
  const wasm = createRequire(__filename).resolve('manifold-3d/manifold.wasm').replace('app.asar/', 'app.asar.unpacked/');
  const module = await Module({ locateFile: () => wasm });
  module.setup();
  return module;
}
