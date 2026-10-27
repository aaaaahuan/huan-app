import { z } from 'zod';

// ensure 仅保留旧调用方兼容响应，不再启动服务；预览通过固定只读资产 API。
export type TerrainStatus = { ok: true; url: string } | { ok: false; message: string };
export type TerrainAssetResult = { ok: true; content: Uint8Array } | { ok: false; message: string };
export interface TerrainAPI { readAsset(input: {id: string; area: 'web' | 'models'; path: string}): Promise<TerrainAssetResult>; autoRoot(): Promise<string>; ensure(): Promise<TerrainStatus>; listJobs(): Promise<TerrainListResult>; getJob(input: TerrainJobRequest): Promise<TerrainGetResult>; upload(input: TerrainUpload): Promise<TerrainWriteResult>; cancel(input: TerrainJobRequest): Promise<TerrainWriteResult>; retry(input: TerrainJobRequest): Promise<TerrainWriteResult> }

export const terrainJobIdSchema = z.string().regex(/^\d{8}-\d{6}-[a-f0-9]{10}$/);
export const terrainStageKeySchema = z.enum(['parse', 'dem', 'terrain', 'features', 'photos', 'scale', 'export', 'preview']);
const secondsSchema = z.number().nonnegative();

// 持久化字段沿用 app/state.py 的 snake_case 和 Unix 秒；保留未知字段以兼容已有作品。
export const terrainStageSchema = z.object({
  key: terrainStageKeySchema,
  name: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  elapsed_seconds: secondsSchema.nullable().optional(),
  detail: z.string(),
  started_at: secondsSchema.optional(),
  finished_at: secondsSchema.optional()
}).passthrough();
export const terrainJobStatusSchema = z.object({
  id: terrainJobIdSchema,
  filename: z.string(),
  input_file: z.enum(['input.kml', 'input.kmz']),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  started_at: secondsSchema,
  stages: z.array(terrainStageSchema),
  preview_url: z.string(),
  error: z.string().nullable(),
  name: z.string().optional(),
  origin: z.string().optional(),
  track_file: z.string().optional(),
  worker_pid: z.number().int().positive().optional(),
  updated_at: secondsSchema.optional(),
  finished_at: secondsSchema.nullable().optional(),
  total_seconds: secondsSchema.nullable().optional()
}).passthrough();
// app/library.py summary：metadata 与 photo_houses 缺失时由 library 提供默认值，不在 schema 中伪造。
export const terrainJobSummarySchema = terrainJobStatusSchema.extend({
  name: z.string(),
  date: z.string(),
  photo_count: z.number().int().nonnegative(),
  house_count: z.number().int().nonnegative(),
  uncertain_houses: z.number().int().nonnegative(),
  house_method: z.string().nullable().optional()
});
export type TerrainStage = z.infer<typeof terrainStageSchema>;
export type TerrainJobStatus = z.infer<typeof terrainJobStatusSchema>;
export type TerrainJobSummary = z.infer<typeof terrainJobSummarySchema>;

// 仅定义后续原生 IPC 的输入边界，不开放尚未实现的能力；路径由主进程按 ID 决定。
export const terrainJobRequestSchema = z.object({ id: terrainJobIdSchema }).strict();
export const terrainUploadSchema = z.object({
  filename: z.string().min(1).regex(/\.(kml|kmz)$/i),
  content: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= 150_000_000,
    '文件不能为空，最大 150 MB'),
  defer: z.boolean().optional()
}).strict();
export const terrainExportModelSchema = terrainJobRequestSchema.extend({ format: z.enum(['stl', '3mf']) });
export type TerrainJobRequest = z.infer<typeof terrainJobRequestSchema>;
export type TerrainUpload = z.infer<typeof terrainUploadSchema>;
export type TerrainExportModel = z.infer<typeof terrainExportModelSchema>;

// 只验证 summary 所需字段；其余历史元数据原样接受。
export const terrainMetadataSchema = z.object({
  route_info: z.object({ name: z.string().optional(), date: z.string().optional() }).passthrough().optional(),
  photos: z.object({ total: z.number().int().nonnegative().optional() }).passthrough().optional(),
  houses: z.object({ placed_points: z.array(z.unknown()).optional() }).passthrough().optional()
}).passthrough();
export const terrainPhotoHousesSchema = z.object({
  method: z.string().nullable().optional(),
  points: z.array(z.object({ has_house: z.union([z.boolean(), z.literal('uncertain')]).optional() }).passthrough()).optional()
}).passthrough();
export interface TerrainJobList {
  jobs: TerrainJobSummary[];
  diagnostics: { id: string; message: string }[];
}
export type TerrainListResult = ({ ok: true } & TerrainJobList) | { ok: false; message: string };
export type TerrainGetResult = { ok: true; job: TerrainJobSummary } | { ok: false; message: string };

export type TerrainWriteResult = { ok: true; job: TerrainJobStatus } | { ok: false; message: string };

export const terrainAssetRequestSchema = terrainJobRequestSchema.extend({ area: z.enum(['web', 'models']), path: z.string().min(1).max(240) });
