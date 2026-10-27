import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const enabled = z.object({ enabled: z.boolean() }).strict();
export const featureSchema = z.object({
  version: z.literal(1),
  rivers: enabled.extend({ depth_mm: number(.3, .6), river_width_mm: number(.7, 6), stream_width_mm: number(.7, 6) }),
  forest: enabled.extend({ raise_mm: number(.21, .5), texture_mm: number(0, .29) }).refine(v => v.raise_mm + v.texture_mm <= .5, 'Forest maximum relief must be <= 0.5 mm'),
  grass: enabled, snow: enabled,
  houses: enabled.extend({ include_uncertain: z.boolean(), list_file: z.string(), route_gap_mm: number(0, 20), model_stl: z.string(), model_glb: z.string(), sink_mm: number(.1, 2), scale: number(.2, 3), min_route_clearance_mm: number(0, 10), pin_color: color, preview_color: color.default('#FFAE58') }).refine(v => v.route_gap_mm >= 1.7 * v.scale + 1.5, 'route_gap_mm must exceed scaled house half width + 1.5 mm'),
  photos: enabled,
  elevation_scale: enabled.extend({ side: z.enum(['south', 'east', 'north', 'west']), intervals: number(1, 10).int(), depth_mm: number(.3, .6), line_width_mm: number(.5, 2), tick_length_mm: number(3, 20), text_height_mm: number(4, 10), stroke_mm: number(.5, 1.2), color, source: z.enum(['route_start_end', 'terrain_min_max']) }),
  network: z.object({ proxy: z.string().nullable() }).strict()
}).strict();
export type FeatureConfig = z.infer<typeof featureSchema>;
// 来自只读 huan-path 4e7f285 config/features.json；产品常数不随迁移调整。
export const defaultFeatures: FeatureConfig = featureSchema.parse({
  version: 1, rivers: { enabled: true, depth_mm: .45, river_width_mm: 1.4, stream_width_mm: 1.1 },
  forest: { enabled: true, raise_mm: .32, texture_mm: .12 }, grass: { enabled: true }, snow: { enabled: true },
  houses: { enabled: true, include_uncertain: false, list_file: 'data/photo_houses.json', route_gap_mm: 4, model_stl: 'data/house_designs/5_pin_house.stl', model_glb: 'data/house_designs/5_pin_house.glb', sink_mm: .4, scale: 1, min_route_clearance_mm: 0, pin_color: '#F4A7B9' },
  photos: { enabled: true }, elevation_scale: { enabled: true, side: 'south', intervals: 3, depth_mm: .35, line_width_mm: .6, tick_length_mm: 7, text_height_mm: 4.5, stroke_mm: .6, color: '#39434B', source: 'route_start_end' }, network: { proxy: null }
});
export async function loadFeatures(job: string): Promise<FeatureConfig> {
  const path = join(job, 'features.json');
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size > 100_000) throw new Error('features.json 必须是小于 100KB 的普通文件');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return structuredClone(defaultFeatures);
    throw error;
  }
  return featureSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function preservedModel(job: string) {
  let raw: unknown;
  const path = join(job, 'spec.json');
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size > 2_000_000) throw new Error('spec.json 必须是小于 2MB 的普通文件');
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const spec = z.object({ preserve_imported_assets: z.boolean().optional(), model: z.unknown().optional() }).parse(raw);
  if (!spec.preserve_imported_assets) return;
  return z.object({ base_mm: z.number().finite().positive(), vertical_exaggeration: z.number().finite().positive() }).parse(spec.model);
}
