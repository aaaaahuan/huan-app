// 开发与编译配置：分别构建主进程、preload 和 React 页面，产物进入 out。
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// 别名需与两个 tsconfig 的 paths 对齐；它们只用于模块导入，不用于运行时文件路径。
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main'), 'web-worker': resolve('src/workers/geotiff-no-pool.ts') } },
    // 固定主进程文件名，和 package.json 的 main 字段保持一致。
    build: {
      // Readability 处理 ?raw；GeoTIFF 纳入 bundle，替换不兼容普通 Node worker 的可选 Pool 后端。
      externalizeDeps: {
        exclude: ['@mozilla/readability', 'geotiff', 'web-worker'],
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'terrain-worker': resolve('src/workers/terrain.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // 沙箱 preload 使用独立 CommonJS 文件，不依赖页面的模块加载环境。
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  // 仅页面侧启用 React 插件；它不参与 Electron 窗口或文件系统管理。
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
    // 图片保留为同源文件，兼容生产页面仅允许 img-src 'self' 的安全策略。
    build: { assetsInlineLimit: 0 },
    plugins: [react()]
  }
});
