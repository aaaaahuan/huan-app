import { z } from 'zod';

const style = z.object({ color: z.string(), label: z.string().optional() });
export const metadataSchema = z.object({
  native_core_only: z.boolean().optional(),
  size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  palette: z.array(z.object({ id: z.number(), name: z.string(), hex: z.string() })).default([]),
  preview_layers: z.object({
    grid: z.tuple([z.number().int().min(2), z.number().int().min(2)]), top_faces: z.number().int().nonnegative(),
    available: z.record(z.string(), z.boolean()), base: z.string(), classes: z.string(), distance: z.string(),
    forest: z.string().optional(), rivers: z.string().optional(), houses: z.string().optional(),
    face_route: z.string(), route_gap: z.string().optional(), face_gap: z.string().optional(),
    settlements: z.string().optional(), places: z.string().optional()
  }).optional(),
  roads: z.object({ count: z.number(), lift_mm: z.number().default(.07), groups: z.record(z.string(), style.extend({ vertices: z.string(), width_mm: z.number().optional(), max_mm: z.number().optional(), min_px: z.number().optional() })) }).optional(),
  settlements: z.object({ areas: z.object({ styles: z.record(z.string(), style) }).optional(), places: z.object({ lift_mm: z.number().optional() }).optional() }).optional(),
  houses: z.object({ model_glb: z.string(), scale: z.number(), sink_mm: z.number(), placed_points: z.array(z.object({ scene_origin_mm: z.tuple([z.number(), z.number(), z.number()]) })) }).optional(),
  elevation_scale: z.object({ preview_vertices: z.string().optional(), preview_faces: z.string().optional(), color: z.string().optional() }).optional(),
  configuration: z.object({ effective: z.object({ houses: z.object({ pin_color: z.string() }).optional() }).optional() }).optional()
});
export type Metadata = z.infer<typeof metadataSchema>;
export function assetReader(id: string) {
  return async (path: string, area: 'web' | 'models' = 'web'): Promise<ArrayBuffer> => {
    // 资产仅允许所属目录内相对路径；不追随 metadata 的绝对路径或 URL。
    const relative = path.startsWith('./') ? path.slice(2) : path;
    if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..' || /[\\%:\0]/.test(part))) throw new Error('预览资源路径无效');
    const result = await window.huanApp.terrain.readAsset({ id, area, path: relative });
    if (!result.ok) throw new Error(result.message);
    return new Uint8Array(result.content).buffer;
  };
}
export type ReadAsset = ReturnType<typeof assetReader>;
