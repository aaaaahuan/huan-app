import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  renderer: { plugins: [react()] }
});
