import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readdir, readFile, realpath, stat, mkdir } from 'node:fs/promises';
import { join, resolve, relative, extname, dirname, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { StudioProject } from '@shared/contracts/studio';

import type { createSettingsStore } from '@main/settings/store';
const formats = new Set(['.stl', '.3mf', '.obj', '.glb', '.gltf', '.blend']);
const request = z.object({ project: z.string().min(1).refine(s => !s.includes('/') && !s.includes('\\') && s !== '.' && s !== '..'), path: z.string().min(1) }).strict();
async function contained(base: string, path: string) {
  const actual = await realpath(resolve(base, path)), boundary = await realpath(base);
  if (!actual.startsWith(boundary + sep)) throw new Error('文件不在模型目录内');
  return actual;
}
export function registerStudio(assertTrusted: (event: IpcMainInvokeEvent) => void, settings: ReturnType<typeof createSettingsStore>) {
  async function modelRoot() {
    const result = await settings.load();
    if (!result.ok) throw new Error(result.message);
    return result.settings.studio.dataDir || join(app.getPath('userData'), '3d-model');
  }
  ipcMain.handle(IPC_CHANNELS.studio.list, async event => {
    assertTrusted(event);
    try {
      const root = await modelRoot();
      const projects: StudioProject[] = [];
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const base = join(root, entry.name), project: StudioProject = { name: entry.name, size: 0, files: [] };
        async function walk(folder: string) {
          for (const item of await readdir(folder, { withFileTypes: true })) {
            if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
            const path = join(folder, item.name);
            if (item.isDirectory()) await walk(path);
            else if (item.isFile()) {
              const info = await stat(path); project.size += info.size;
              if (formats.has(extname(path).toLowerCase())) project.files.push({ path: relative(base, path), size: info.size });
            }
          }
        }
        await walk(base); project.files.sort((a, b) => a.path.localeCompare(b.path)); projects.push(project);
      }
      return { ok: true, value: projects.sort((a, b) => a.name.localeCompare(b.name)) };
    } catch { return { ok: false, message: '无法读取 3d-model 模型目录。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.studio.read, async (event, input: unknown) => {
    assertTrusted(event);
    try {
      const value = request.parse(input), base = await contained(await modelRoot(), value.project);
      let path = await contained(base, value.path), format = extname(path).toLowerCase().slice(1);
      if (!formats.has('.' + format)) throw new Error('不支持的模型格式');
      if ((await stat(path)).size > 150_000_000) throw new Error('模型资源超过 150 MB');
      if (format === 'blend') {
        const info = await stat(path);
        const key = createHash('sha256').update(`visible-v2:${path}:${info.mtimeMs}:${info.size}`).digest('hex');
        const cache = join(app.getPath('userData'), 'huan-studio'); await mkdir(cache, { recursive: true });
        const output = join(cache, key + '.glb');
        try { await stat(output); } catch {
          // 禁用 blend 内嵌脚本；只在缓存目录生成预览，不修改源模型。
          const script = "import bpy,sys; bpy.ops.object.select_all(action='DESELECT'); [o.select_set(True) for o in bpy.context.scene.objects if o.type == 'MESH' and o.visible_get()]; bpy.ops.export_scene.gltf(filepath=sys.argv[-1],export_format='GLB',use_selection=True)";
          await promisify(execFile)('/Applications/Blender.app/Contents/MacOS/Blender', ['--background', '--disable-autoexec', path, '--python-expr', script, '--', output], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        }
        path = output; format = 'glb';
      }
      if ((await stat(path)).size > 150_000_000) throw new Error('模型资源超过 150 MB');
      return { ok: true, value: { content: new Uint8Array(await readFile(path)), format } };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '无法加载模型，请确认文件完整及 Blender 已安装。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.studio.photos, async (event, input: unknown) => {
    assertTrusted(event);
    try {
      const value = request.parse(input), base = await contained(await modelRoot(), value.project);
      const model = await contained(base, value.path);
      const folder = await contained(base, relative(base, join(dirname(model), 'pic'))).catch(() => null);
      if (!folder) return { ok: true, value: [] };
      const photos = [];
      let totalBytes = 0;
      const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const type = mime[extname(entry.name).toLowerCase()];
        if (!entry.isFile() || !type) continue;
        const path = await contained(base, relative(base, join(folder, entry.name)));
        totalBytes += (await stat(path)).size;
        if (totalBytes > 150_000_000) throw new Error('实物图片总量超过 150 MB');
        photos.push({ name: entry.name, url: `data:${type};base64,${(await readFile(path)).toString('base64')}` });
      }
      return { ok: true, value: photos };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '实物图片读取失败。' }; }
  });
}
