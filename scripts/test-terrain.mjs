import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await mkdtemp(join(tmpdir(), 'huan-terrain-tests-'));

function remapPlugin(rules) {
  return {
    name: 'remap-imports',
    setup(api) {
      api.onResolve({ filter: /.*/ }, args => {
        for (const rule of rules) {
          if (rule.test(args.path, args.resolveDir || '')) return { path: rule.to };
        }
      });
    }
  };
}

const shared = {
  platform: 'node', format: 'esm', target: 'node22', bundle: true,
  alias: {
    '@shared': join(root, 'src/shared'),
    '@main': join(root, 'src/main')
  },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: 'silent'
};

async function bundle(entry, outfile, rules = []) {
  await build({
    ...shared,
    entryPoints: [join(root, entry)],
    outfile,
    plugins: rules.length ? [remapPlugin(rules)] : []
  });
}

const overpassHighway = join(root, 'src/main/terrain/__tests__/overpass-highway-stub.ts');
const overpassEmpty = join(root, 'src/main/terrain/__tests__/overpass-empty-stub.ts');
const hang = join(root, 'src/main/terrain/__tests__/worker-hang-stub.ts');
const roadsThrow = join(root, 'src/main/terrain/__tests__/roads-throw-stub.ts');

const isOverpass = (p) => p === '../datasets/overpass' || p.endsWith('/overpass') || p.endsWith('/overpass.ts') || p.endsWith('datasets/overpass');
const isWorker = (p, dir) => (p === './worker' || p.endsWith('/worker') || p.endsWith('/worker.ts')) && String(dir).includes('pipeline');
const isRoads = (p) => p === '../overlays/roads' || p.endsWith('/roads') || p.endsWith('/roads.ts') || p.endsWith('overlays/roads');

await bundle('src/main/terrain/__tests__/assets.test.ts', join(out, 'assets.test.js'));
await bundle('src/main/terrain/__tests__/roads-overflow.test.ts', join(out, 'roads-overflow.test.js'), [
  { test: isOverpass, to: overpassHighway }
]);
await bundle('src/main/terrain/__tests__/cancel.test.ts', join(out, 'cancel.test.js'), [
  { test: isWorker, to: hang }
]);
await bundle('src/main/terrain/__tests__/export-overlay.test.ts', join(out, 'export-overlay.test.js'), [
  { test: isRoads, to: roadsThrow },
  { test: isOverpass, to: overpassEmpty }
]);

const args = ['--test', join(out, 'assets.test.js'), join(out, 'roads-overflow.test.js'), join(out, 'cancel.test.js'), join(out, 'export-overlay.test.js')];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
child.on('exit', async code => { await rm(out, { recursive: true, force: true }); process.exit(code ?? 1); });
